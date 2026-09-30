'use strict';

const { validateSchema, APPROVED_FACTS } = require('./ghl-schema-service');

const DEFAULT_AUDIT_TARGETS = Object.freeze({
  preview: 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?v_test=1790778792385#home',
  production: 'https://bestdayfitness.com',
});

const APPROVED_AUDIT_DOMAINS = Object.freeze([
  'link.bestdayfitness.com',
  'bestdayfitness.com',
  'bestdayfitnessreviews.com',
  'my.bestdayfitness.com',
  'localhost',
  '127.0.0.1',
]);

const MAX_RESPONSE_BYTES = 26214400; // 25 MB

/**
 * Validates whether a target URL is in the approved domain whitelist for SSRF safety.
 */
function isApprovedAuditTarget(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    const isApproved = APPROVED_AUDIT_DOMAINS.some(allowed =>
      host === allowed || host.endsWith('.' + allowed)
    );
    return { ok: isApproved, host, error: isApproved ? null : `Disallowed target host "${host}". Audits are restricted to approved Best Day domains to prevent SSRF.` };
  } catch (e) {
    return { ok: false, host: null, error: `Invalid URL: ${e.message}` };
  }
}

/**
 * Parses HTML metadata with strict <head> extraction, script/style stripping
 * before visible content analysis, and explicit malformed JSON-LD error tracking.
 */
function parseHtmlMetadata(html, byteSize = 0) {
  const content = String(html || '');
  const bytes = byteSize || Buffer.byteLength(content, 'utf8');

  // 1. Strict <head> extraction
  const headMatch = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';

  // Title: strictly from <head>
  const titleMatch = headContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Meta description: strictly from <head>
  const descMatch = headContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || headContent.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const description = descMatch ? descMatch[1].trim() : '';

  // Canonical: strictly from <head>
  const canonMatch = headContent.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i)
    || headContent.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i);
  const canonical = canonMatch ? canonMatch[1].trim() : '';

  // Robots: strictly from <head>
  const robotsMatch = headContent.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || headContent.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']robots["'][^>]*>/i);
  const robots = robotsMatch ? robotsMatch[1].trim().toLowerCase() : '';

  // Open Graph: strictly from <head>
  const ogTitleMatch = headContent.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const ogDescMatch = headContent.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const ogImageMatch = headContent.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i);

  // JSON-LD blocks: search in head and full document, recording parse failures explicitly
  const schemaBlocks = [];
  const malformedJsonLd = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
  let sMatch;
  while ((sMatch = scriptRegex.exec(content)) !== null) {
    const rawJson = sMatch[1].trim();
    try {
      const parsed = JSON.parse(rawJson);
      schemaBlocks.push(parsed);
    } catch (e) {
      const errorEntry = {
        valid: false,
        parseError: e.message,
        rawSnippet: rawJson.slice(0, 150),
      };
      schemaBlocks.push(errorEntry);
      malformedJsonLd.push(errorEntry);
    }
  }

  // 2. Visible Content Extraction: strip <script>, <style>, <template> tags before analysis
  const visibleContent = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[^>]*>[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Headings from visible content only
  const h1Matches = visibleContent.match(/<h1[^>]*>([\s\S]*?)<\/h1>/ig) || [];
  const h1Texts = h1Matches.map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  const h2Count = (visibleContent.match(/<h2[^>]*>/ig) || []).length;
  const h3Count = (visibleContent.match(/<h3[^>]*>/ig) || []).length;

  // Phone and Address found in visible text
  const phoneFound = visibleContent.includes('727') &&
    (visibleContent.includes('334-1472') || visibleContent.includes('3341472') || visibleContent.includes('(727) 334-1472'));
  const addressFound = visibleContent.includes('6619 1st Ave') || visibleContent.includes('6619 1st Avenue');

  // Asset bloat & inlining analysis
  const scripts = content.match(/<script[^>]*>([\s\S]*?)<\/script>/ig) || [];
  let scriptBytes = 0;
  scripts.forEach(s => { scriptBytes += s.length; });

  const base64Matches = content.match(/data:[^;]+;base64,[a-zA-Z0-9+/=]+/ig) || [];

  return {
    bytes,
    title,
    description,
    canonical,
    robots,
    og: {
      title: ogTitleMatch ? ogTitleMatch[1].trim() : '',
      description: ogDescMatch ? ogDescMatch[1].trim() : '',
      image: ogImageMatch ? ogImageMatch[1].trim() : '',
    },
    schemaBlocks,
    malformedJsonLd,
    headings: {
      h1Count: h1Texts.length,
      h1Texts,
      h2Count,
      h3Count,
    },
    assets: {
      scriptTagCount: scripts.length,
      scriptBytes,
      base64Count: base64Matches.length,
    },
    phoneFound,
    addressFound,
  };
}

/**
 * Normalizes URL for target matching (lowercases host, strips trailing slash).
 */
function normalizeUrlForMatch(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`;
  } catch (e) {
    return String(urlStr || '').trim().replace(/\/$/, '');
  }
}

/**
 * Evaluates audit findings on parsed metadata.
 * GEO Optimizer results must NEVER be invented:
 * - If no verified run/import is provided: status="not_run", score=null.
 * - If imported evidence target does not match targetUrl: status="evidence_target_mismatch", score=null.
 * - If run failed: status="unavailable", score=null, error recorded.
 * - If run succeeded: status="completed", score=evidence.score.
 */
function evaluateWebsiteAudit(targetUrl, meta, options = {}) {
  const url = String(targetUrl || '');
  const isPreview = url.includes('preview') || url.includes('link.bestdayfitness.com');
  const isStaging = url.includes('staging') || isPreview;
  const geoEvidence = options.geoEvidence || options.geoBaseline || null;

  const checks = {
    url,
    isStaging,
    environmentLabel: isPreview ? 'Hosted GHL Preview Funnel' : isStaging ? 'Local Staging' : 'Live Production',
    timestamp: options.timestamp || new Date().toISOString(),
    toolRevision: 'geo-optimizer v4.18.3 & seo-buddy audit engine v1.3',
  };

  // 1. Metadata check
  const metaCheck = {
    hasTitle: Boolean(meta.title),
    titleText: meta.title,
    titleLength: meta.title.length,
    titleValid: meta.title.length > 10 && meta.title.length <= 65,
    hasDescription: Boolean(meta.description),
    descriptionText: meta.description,
    descriptionLength: meta.description.length,
    descriptionValid: meta.description.length >= 50 && meta.description.length <= 160,
    hasCanonical: Boolean(meta.canonical),
    canonicalUrl: meta.canonical,
    hasOpenGraph: Boolean(meta.og.title && meta.og.description),
  };
  checks.metadata = metaCheck;

  // 2. Crawlability & Indexing check (Separates observed directive from indexability conclusion)
  const isNoindex = meta.robots.includes('noindex');
  const crawlability = {
    observedRobots: meta.robots || 'none declared (indexable by default)',
    isNoindex,
    isStagingProtected: isStaging && isNoindex,
    status: isStaging
      ? (isNoindex ? 'PROTECTED_STAGING' : 'EXPOSED_STAGING_WARNING')
      : (isNoindex ? 'PRODUCTION_NOINDEX_WARNING' : 'PRODUCTION_INDEXABLE'),
    explanation: isStaging
      ? (isNoindex
          ? 'Staging/preview serves noindex as intentional pre-launch protection. This is an expected staging security control, not a defect.'
          : 'Warning: Staging/preview page does not declare noindex and risks premature search indexing before authorized launch.')
      : (isNoindex
          ? 'Warning: Production website serves noindex, which prevents search engines from indexing live pages.'
          : 'Production website is indexable by search engines.'),
  };
  checks.crawlability = crawlability;

  // 3. Schema & Structured Data check
  const allSchemas = meta.schemaBlocks || [];
  const graphEntities = [];
  for (const block of allSchemas) {
    if (block && typeof block === 'object' && !block.parseError) {
      if (Array.isArray(block['@graph'])) {
        graphEntities.push(...block['@graph']);
      } else if (block['@type']) {
        graphEntities.push(block);
      }
    }
  }

  const businessEntity = graphEntities.find(e => {
    const types = Array.isArray(e['@type']) ? e['@type'] : [e['@type']];
    return types.some(t => ['HealthClub', 'ExerciseGym', 'SportsActivityLocation', 'SportsClub', 'LocalBusiness'].includes(t));
  });

  // Evaluate schema against substantive 4-tier validator if present
  let schemaValidationResult = null;
  if (allSchemas.length > 0 && !meta.malformedJsonLd.length) {
    try {
      const rootSchema = allSchemas.find(s => s['@context'] === 'https://schema.org') || {
        '@context': 'https://schema.org',
        '@graph': graphEntities,
      };
      schemaValidationResult = validateSchema(rootSchema);
    } catch (e) {
      schemaValidationResult = { valid: false, allIssues: [e.message] };
    }
  }

  const schemaCheck = {
    blockCount: allSchemas.length,
    malformedCount: (meta.malformedJsonLd || []).length,
    malformedErrors: (meta.malformedJsonLd || []).map(m => m.parseError),
    entityCount: graphEntities.length,
    hasBusinessEntity: Boolean(businessEntity),
    businessName: businessEntity ? businessEntity.name : null,
    hasOpeningHours: Boolean(businessEntity && Array.isArray(businessEntity.openingHoursSpecification) && businessEntity.openingHoursSpecification.length > 0),
    hoursCompliant: schemaValidationResult ? schemaValidationResult.categories.approvedFacts.verifiedFacts.some(f => f.includes('Opening hours verified')) : false,
    servicesFound: graphEntities.filter(e => e['@type'] === 'Service').map(s => s.name || s.serviceType),
    validation: schemaValidationResult,
  };
  checks.structuredData = schemaCheck;

  // 4. Content & Headings check
  checks.content = {
    h1Count: meta.headings.h1Count,
    h1Texts: meta.headings.h1Texts,
    h1Valid: meta.headings.h1Count === 1,
    h2Count: meta.headings.h2Count,
    h3Count: meta.headings.h3Count,
    phoneFound: meta.phoneFound,
    addressFound: meta.addressFound,
  };

  // 5. Performance & Asset Bloat check
  const isOversized = meta.bytes > 10485760; // >10MB CLI parser limit
  checks.performance = {
    byteSize: meta.bytes,
    sizeMegabytes: (meta.bytes / (1024 * 1024)).toFixed(2),
    isOversized,
    scriptCount: meta.assets.scriptTagCount,
    scriptBytes: meta.assets.scriptBytes,
    base64Count: meta.assets.base64Count,
    warning: isOversized
      ? `Payload exceeds 10MB parser limit (${(meta.bytes / (1024 * 1024)).toFixed(2)} MB) due to inlined LeadConnector bundles and base64 assets.`
      : null,
  };

  // 6. External GEO Optimizer Integration — STRICTLY TRUTHFUL, NO FALLBACK INVENTED SCORES
  if (geoEvidence) {
    const evidenceTarget = geoEvidence.url || geoEvidence.targetUrl || '';
    const normTarget = normalizeUrlForMatch(url);
    const normEvidenceTarget = normalizeUrlForMatch(evidenceTarget);

    const isMatch = normTarget && normEvidenceTarget &&
      (normTarget === normEvidenceTarget ||
       normTarget.startsWith(normEvidenceTarget) ||
       normEvidenceTarget.startsWith(normTarget));

    if (!isMatch) {
      // Evidence target does not match audit target
      checks.geoOptimizer = {
        tool: geoEvidence.tool || 'geo-optimizer v4.18.3',
        status: 'evidence_target_mismatch',
        score: null,
        band: null,
        targetUrl: url,
        evidenceTargetUrl: evidenceTarget,
        error: `Imported GEO Optimizer evidence target ("${evidenceTarget}") does not match current audit target ("${url}"). Mismatched evidence rejected.`,
        rawSummary: null,
      };
    } else if (geoEvidence.error) {
      // Failed run or blocked measurement
      checks.geoOptimizer = {
        tool: geoEvidence.tool || 'geo-optimizer v4.18.3',
        status: 'unavailable',
        score: null,
        band: geoEvidence.band || 'unavailable',
        targetUrl: evidenceTarget,
        runTimestamp: geoEvidence.timestamp || null,
        exitStatus: geoEvidence.exitStatus || 'failed',
        error: geoEvidence.error,
        rawSummary: null,
      };
    } else {
      // Successful verified run or import
      checks.geoOptimizer = {
        tool: geoEvidence.tool || 'geo-optimizer v4.18.3',
        status: 'completed',
        score: typeof geoEvidence.score === 'number' ? geoEvidence.score : null,
        band: geoEvidence.band || null,
        targetUrl: evidenceTarget,
        runTimestamp: geoEvidence.timestamp || null,
        exitStatus: geoEvidence.exitStatus || 'success',
        error: null,
        rawSummary: geoEvidence.checks ? {
          robots: geoEvidence.checks.robots_txt?.score,
          schema: geoEvidence.checks.schema_jsonld?.score,
          meta: geoEvidence.checks.meta_tags?.score,
          content: geoEvidence.checks.content?.score,
        } : null,
      };
    }
  } else {
    // No verified run or import provided: REPORT not_run WITH score=null. DO NOT INVENT A SCORE!
    checks.geoOptimizer = {
      tool: 'geo-optimizer v4.18.3',
      status: 'not_run',
      score: null,
      band: null,
      error: null,
      note: 'GEO Optimizer CLI has not been executed or imported for this specific target URL. Fallback scores are prohibited.',
      rawSummary: null,
    };
  }

  // 7. Actionable Recommendations
  const recommendations = [];

  // Malformed JSON-LD
  if (schemaCheck.malformedCount > 0) {
    recommendations.push({
      priority: 'CRITICAL',
      area: 'Structured Data Syntax',
      action: 'Fix malformed JSON-LD script block syntax in page head',
      evidence: `Found ${schemaCheck.malformedCount} unparseable JSON-LD block(s): ${schemaCheck.malformedErrors.join('; ')}`,
      reason: 'Search engines discard entire JSON-LD blocks that contain JSON syntax errors.',
    });
  }

  // Missing or non-compliant Schema
  if (schemaCheck.blockCount === 0) {
    recommendations.push({
      priority: 'CRITICAL',
      area: 'Structured Data',
      action: 'Inject GHL Header Tracking Code containing JSON-LD schema graph',
      evidence: 'Hosted GHL preview contains 0 JSON-LD schema blocks (<script type="application/ld+json">).',
      reason: 'AI search engines (Google SGE/Gemini, ChatGPT, Perplexity) rely on authoritative LocalBusiness and Service schema for entity extraction and citation.',
      remediationAsset: 'website/ghl-assets/ghl-header-tracking-schema.html',
    });
  } else if (!schemaCheck.hoursCompliant) {
    recommendations.push({
      priority: 'HIGH',
      area: 'Business Hours',
      action: 'Align Schema openingHoursSpecification with approved business hours across all 7 days',
      evidence: 'Schema opening hours do not cover all 7 days with approved hours: Mon–Sat 04:00–22:00, Sun 09:00–17:00 America/New_York (Appointment Only).',
      reason: 'Conflicting or partial hours cause local search misalignment and hallucinations in LLM answers.',
    });
  }

  // Metadata
  if (!metaCheck.hasTitle || !metaCheck.hasDescription) {
    recommendations.push({
      priority: 'HIGH',
      area: 'Metadata',
      action: 'Inject explicit <title> and <meta name="description"> in GHL Page Header',
      evidence: `Title: ${metaCheck.hasTitle ? 'Found' : 'MISSING'}, Description: ${metaCheck.hasDescription ? 'Found' : 'MISSING'}.`,
      reason: 'Search engines display fallback URLs or synthesized blurbs without explicit title and description tags.',
      remediationAsset: 'website/ghl-assets/ghl-header-tracking-schema.html',
    });
  }

  // Canonical
  if (!metaCheck.hasCanonical) {
    recommendations.push({
      priority: 'HIGH',
      area: 'Canonicals',
      action: 'Inject <link rel="canonical" href="https://bestdayfitness.com/">',
      evidence: 'No canonical link found in page head.',
      reason: 'Prevents preview/staging URLs and URL parameters from being indexed as duplicate content.',
    });
  }

  // Asset bloat
  if (checks.performance.isOversized) {
    recommendations.push({
      priority: 'MEDIUM',
      area: 'Performance & Crawlability',
      action: 'Externalize base64 data URIs and optimize GHL builder script bundles',
      evidence: `Page size is ${checks.performance.sizeMegabytes} MB with ${meta.assets.base64Count} base64 images and ${checks.performance.scriptCount} inlined scripts.`,
      reason: 'Oversized payloads trigger parser truncation (e.g. 10MB limit in GEO Optimizer) and degrade mobile page experience.',
    });
  }

  // Staging protection warning
  if (isStaging && !isNoindex) {
    recommendations.push({
      priority: 'CRITICAL',
      area: 'Staging Protection',
      action: 'Ensure <meta name="robots" content="noindex, nofollow"> remains active on preview',
      evidence: 'Staging preview must not be indexed before production launch authorization.',
      reason: 'Prevents pre-launch drafts from colliding with live brand search results.',
    });
  }

  return {
    success: true,
    targetUrl: url,
    score: checks.geoOptimizer.score,
    checks,
    recommendations,
  };
}

/**
 * Creates the repeatable website audit service.
 * Supports running audits against allowed targets, storing history,
 * and importing verified GEO Optimizer evidence.
 */
function createWebsiteAuditService(options = {}) {
  const {
    state,
    save,
    providerRuntime,
    getSiteUrl = () => DEFAULT_AUDIT_TARGETS.preview,
    geoEvidenceStore = new Map(),
    nowIso = () => new Date().toISOString(),
    logger = console,
  } = options;

  if (!state || typeof state !== 'object') throw new TypeError('Website audit state is required.');
  if (typeof save !== 'function') throw new TypeError('Website audit save callback is required.');
  if (!providerRuntime || typeof providerRuntime.fetch !== 'function') throw new TypeError('providerRuntime.fetch is required.');

  let running = false;

  /**
   * Imports verified GEO Optimizer evidence for a target URL.
   */
  function importGeoEvidence(targetUrl, evidence) {
    if (!targetUrl || typeof targetUrl !== 'string') throw new TypeError('targetUrl string is required.');
    if (!evidence || typeof evidence !== 'object') throw new TypeError('evidence object is required.');

    const norm = normalizeUrlForMatch(targetUrl);
    geoEvidenceStore.set(norm, evidence);

    // If current latest audit targets this URL, re-evaluate with verified evidence
    if (state.latest && state.latest.targetUrl && normalizeUrlForMatch(state.latest.targetUrl) === norm) {
      const meta = state.latest._rawMeta || null;
      if (meta) {
        state.latest = evaluateWebsiteAudit(state.latest.targetUrl, meta, {
          timestamp: state.latest.checks?.timestamp || nowIso(),
          geoEvidence: evidence,
        });
        state.latest._rawMeta = meta;
        save();
      }
    }

    return { ok: true, targetUrl: norm, evidenceStored: true };
  }

  /**
   * Executes a website audit against a target URL.
   */
  async function run(overrideUrl = null) {
    if (running) return { ok: false, busy: true };
    running = true;

    const url = overrideUrl || getSiteUrl() || DEFAULT_AUDIT_TARGETS.preview;

    // SSRF Safety Check
    const targetCheck = isApprovedAuditTarget(url);
    if (!targetCheck.ok) {
      running = false;
      const ssrfError = {
        success: false,
        targetUrl: url,
        status: 'rejected',
        error: targetCheck.error,
        timestamp: nowIso(),
        checks: {
          url,
          error: targetCheck.error,
          geoOptimizer: {
            tool: 'geo-optimizer v4.18.3',
            status: 'unavailable',
            score: null,
            error: targetCheck.error,
          },
        },
        recommendations: [
          {
            priority: 'HIGH',
            area: 'Security',
            action: 'Target must belong to approved Best Day domains',
            evidence: targetCheck.error,
            reason: 'Audit runner strictly enforces domain boundary to prevent Server-Side Request Forgery (SSRF).',
          },
        ],
      };
      state.latest = ssrfError;
      state.updatedAt = nowIso();
      save();
      return { ok: false, error: targetCheck.error, snapshot: ssrfError };
    }

    try {
      const response = await providerRuntime.fetch('website', url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BestDay-SEOBuddy-Audit/1.3',
        },
      }, { retries: 1 });

      let html = '';
      let byteSize = 0;
      if (response && typeof response.text === 'function') {
        html = await response.text();
        byteSize = Buffer.byteLength(html, 'utf8');
      } else if (response && typeof response.body === 'string') {
        html = response.body;
        byteSize = Buffer.byteLength(html, 'utf8');
      }

      if (byteSize > MAX_RESPONSE_BYTES) {
        throw new Error(`Response payload exceeded maximum allowed response limit of ${MAX_RESPONSE_BYTES} bytes.`);
      }

      const meta = parseHtmlMetadata(html, byteSize);

      // Check if verified GEO evidence exists for this normalized URL
      const norm = normalizeUrlForMatch(url);
      const geoEvidence = geoEvidenceStore.get(norm) || null;

      const auditResult = evaluateWebsiteAudit(url, meta, {
        timestamp: nowIso(),
        geoEvidence,
      });

      // Retain raw meta internally for re-evaluation on evidence import
      auditResult._rawMeta = meta;

      state.latest = auditResult;
      state.updatedAt = nowIso();
      if (!Array.isArray(state.history)) state.history = [];
      state.history.unshift({
        url,
        timestamp: state.updatedAt,
        score: auditResult.score,
        recommendationCount: auditResult.recommendations.length,
        geoStatus: auditResult.checks.geoOptimizer.status,
      });
      if (state.history.length > 50) state.history.pop();

      save();
      return { ok: true, snapshot: auditResult };
    } catch (err) {
      logger.error('[Website Audit] Run failed:', err.message);
      const failureResult = {
        success: false,
        targetUrl: url,
        status: 'unavailable',
        error: err.message,
        timestamp: nowIso(),
        checks: {
          url,
          error: err.message,
          geoOptimizer: {
            tool: 'geo-optimizer v4.18.3',
            status: 'unavailable',
            score: null,
            error: err.message,
          },
        },
        recommendations: [
          {
            priority: 'HIGH',
            area: 'Connectivity',
            action: 'Verify endpoint connectivity and host reachability',
            evidence: err.message,
            reason: 'Audit runner could not complete HTTP fetch to target URL.',
          },
        ],
      };
      state.latest = failureResult;
      state.updatedAt = nowIso();
      save();
      return { ok: false, error: err.message, snapshot: failureResult };
    } finally {
      running = false;
    }
  }

  return {
    run,
    importGeoEvidence,
    isRunning: () => running,
    getLatest: () => state.latest,
    getHistory: () => state.history || [],
  };
}

module.exports = {
  DEFAULT_AUDIT_TARGETS,
  APPROVED_AUDIT_DOMAINS,
  isApprovedAuditTarget,
  normalizeUrlForMatch,
  parseHtmlMetadata,
  evaluateWebsiteAudit,
  createWebsiteAuditService,
};
