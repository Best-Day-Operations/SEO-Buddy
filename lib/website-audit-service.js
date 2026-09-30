'use strict';

const { validateSchema, APPROVED_FACTS } = require('./ghl-schema-service');
const { parseHeadElements } = require('./html-head-parser');

const DEFAULT_AUDIT_TARGETS = Object.freeze({
  preview: 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?v_test=1790778792385#home',
  production: 'https://bestdayfitness.com',
});

const APPROVED_PUBLIC_DOMAINS = Object.freeze([
  'link.bestdayfitness.com',
  'bestdayfitness.com',
  'bestdayfitnessreviews.com',
  'my.bestdayfitness.com',
]);

const TEST_LOCAL_DOMAINS = Object.freeze([
  'localhost',
  '127.0.0.1',
]);

const MAX_RESPONSE_BYTES = 26214400; // 25 MB
const MAX_REDIRECTS = 5;

/**
 * Normalizes URL for strict target matching under a documented normalization policy:
 * 1. Lowercases protocol and hostname.
 * 2. Strips standard ports (:80, :443).
 * 3. Strips trailing slash on pathname unless path is '/'.
 * 4. Preserves and deterministically sorts query parameters (identifies variants/content).
 * 5. Strips client-side hash fragments for server-side HTTP target identity.
 */
function normalizeUrlForMatch(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const u = new URL(urlStr);
    const protocol = u.protocol.toLowerCase();
    const hostname = u.hostname.toLowerCase();
    let port = u.port;
    if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
      port = '';
    }
    const hostWithPort = port ? `${hostname}:${port}` : hostname;
    let pathname = u.pathname;
    const cleanPath = pathname === '/' ? '' : pathname.replace(/\/+$/, '');

    // Sort query parameters deterministically without dropping any
    const searchParams = new URLSearchParams(u.search);
    const sortedEntries = Array.from(searchParams.entries()).sort((a, b) => {
      const kComp = a[0].localeCompare(b[0]);
      return kComp !== 0 ? kComp : a[1].localeCompare(b[1]);
    });
    const sortedSearch = new URLSearchParams(sortedEntries).toString();
    const searchStr = sortedSearch ? `?${sortedSearch}` : '';

    return `${protocol}//${hostWithPort}${cleanPath}${searchStr}`;
  } catch (e) {
    return String(urlStr || '').trim().replace(/\/$/, '');
  }
}

/**
 * Validates whether a target URL is within the approved domain boundary.
 * Local targets (localhost, 127.0.0.1) are permitted ONLY when explicitly allowed
 * (e.g. allowLocalTargets: true or NODE_ENV === 'test').
 */
function isApprovedAuditTarget(targetUrl, options = {}) {
  const allowLocal = options.allowLocalTargets || process.env.NODE_ENV === 'test';
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();

    // Check public approved domains
    const isPublic = APPROVED_PUBLIC_DOMAINS.some(allowed =>
      host === allowed || host.endsWith('.' + allowed)
    );
    if (isPublic) return { ok: true, host, error: null };

    // Check test local domains
    if (allowLocal) {
      const isLocal = TEST_LOCAL_DOMAINS.some(allowed => host === allowed);
      if (isLocal) return { ok: true, host, error: null };
    }

    const errorMsg = allowLocal
      ? `Disallowed target host "${host}". Audits are restricted to approved Best Day domains to prevent SSRF.`
      : `Disallowed target host "${host}". Localhost targets are restricted to isolated test environments. Audits are restricted to approved public Best Day domains.`;

    return { ok: false, host, error: errorMsg };
  } catch (e) {
    return { ok: false, host: null, error: `Invalid URL: ${e.message}` };
  }
}

/**
 * Validates raw GEO Optimizer evidence before storing or accepting it.
 * Rejects incomplete evidence, out-of-range scores, and mismatched targets.
 */
function validateGeoEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return { valid: false, error: 'Evidence must be a non-null object.' };
  }

  const target = evidence.url || evidence.targetUrl;
  if (!target || typeof target !== 'string') {
    return { valid: false, error: 'Evidence is missing required target URL.' };
  }

  // Check timestamp
  const ts = evidence.timestamp || evidence.runTimestamp;
  if (!ts || isNaN(new Date(ts).getTime())) {
    return { valid: false, error: 'Evidence is missing valid ISO run timestamp.' };
  }

  // Check score if present
  if (evidence.score !== null && evidence.score !== undefined) {
    if (typeof evidence.score !== 'number' || !Number.isFinite(evidence.score) || evidence.score < 0 || evidence.score > 100) {
      return { valid: false, error: `Evidence contains out-of-range score: ${evidence.score}. Score must be a finite number between 0 and 100.` };
    }
  }

  // Check exit code and status
  const exitCode = evidence.exitCode !== undefined ? evidence.exitCode : (evidence.exitStatus === 'failed' || evidence.exitStatus === 1 ? 1 : (evidence.exitStatus === 'success' ? 0 : null));
  const isFailedExit = exitCode !== null && exitCode !== 0;

  return {
    valid: true,
    normalizedTarget: normalizeUrlForMatch(target),
    exitCode,
    isFailedExit,
  };
}

/**
 * Parses HTML metadata using the token-based head parser.
 */
function parseHtmlMetadata(html, byteSize = 0, headers = {}) {
  const bytes = byteSize || Buffer.byteLength(String(html || ''), 'utf8');
  const parsedHead = parseHeadElements(html, headers);

  return {
    bytes,
    title: parsedHead.title,
    description: parsedHead.description,
    canonical: parsedHead.canonical,
    robots: parsedHead.robots,
    isNoindex: parsedHead.isNoindex,
    og: parsedHead.og,
    schemaBlocks: parsedHead.schemaBlocks,
    malformedJsonLd: parsedHead.malformedJsonLd,
    headings: parsedHead.headings,
    assets: parsedHead.assets,
    phoneFound: parsedHead.phoneFound,
    addressFound: parsedHead.addressFound,
    hasExplicitHead: parsedHead.hasExplicitHead,
  };
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
    toolRevision: 'geo-optimizer v4.18.3 & seo-buddy audit engine v1.4',
  };

  const safeMeta = meta || {};
  const headings = safeMeta.headings || {};
  const assets = safeMeta.assets || {};
  const ogObj = safeMeta.og || {};
  const titleStr = String(safeMeta.title || '');
  const descStr = String(safeMeta.description || '');
  const bytes = Number(safeMeta.bytes) || 0;

  // 1. Metadata check
  const metaCheck = {
    hasTitle: Boolean(titleStr),
    titleText: titleStr,
    titleLength: titleStr.length,
    titleValid: titleStr.length > 10 && titleStr.length <= 65,
    hasDescription: Boolean(descStr),
    descriptionText: descStr,
    descriptionLength: descStr.length,
    descriptionValid: descStr.length >= 50 && descStr.length <= 160,
    hasCanonical: Boolean(safeMeta.canonical),
    canonicalUrl: safeMeta.canonical || '',
    hasOpenGraph: Boolean(ogObj.title && ogObj.description),
  };
  checks.metadata = metaCheck;

  // 2. Crawlability & Indexing check
  const isNoindex = Boolean(safeMeta.isNoindex || (safeMeta.robots && safeMeta.robots.includes('noindex')));
  const crawlability = {
    observedRobots: safeMeta.robots || 'none declared (indexable by default)',
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
  const allSchemas = safeMeta.schemaBlocks || [];
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
  if (allSchemas.length > 0 && !(safeMeta.malformedJsonLd || []).length) {
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
    malformedCount: (safeMeta.malformedJsonLd || []).length,
    malformedErrors: (safeMeta.malformedJsonLd || []).map(m => m.parseError),
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
    h1Count: headings.h1Count || (headings.h1Texts ? headings.h1Texts.length : 0),
    h1Texts: headings.h1Texts || [],
    h1Valid: (headings.h1Count || (headings.h1Texts ? headings.h1Texts.length : 0)) === 1,
    h2Count: headings.h2Count || 0,
    h3Count: headings.h3Count || 0,
    phoneFound: Boolean(safeMeta.phoneFound),
    addressFound: Boolean(safeMeta.addressFound),
  };

  // 5. Performance & Asset Bloat check
  const isOversized = bytes > 10485760; // >10MB CLI parser limit
  checks.performance = {
    byteSize: bytes,
    sizeMegabytes: (bytes / (1024 * 1024)).toFixed(2),
    isOversized,
    scriptCount: assets.scriptTagCount || 0,
    scriptBytes: assets.scriptBytes || 0,
    base64Count: assets.base64Count || 0,
    warning: isOversized
      ? `Payload exceeds 10MB parser limit (${(bytes / (1024 * 1024)).toFixed(2)} MB) due to inlined LeadConnector bundles and base64 assets.`
      : null,
  };

  // 6. External GEO Optimizer Integration — EXACT TARGET MATCHING & VALIDATED EVIDENCE
  if (geoEvidence) {
    const valRes = validateGeoEvidence(geoEvidence);
    const normTarget = normalizeUrlForMatch(url);
    const normEvidenceTarget = valRes.normalizedTarget || normalizeUrlForMatch(geoEvidence.url || geoEvidence.targetUrl || '');

    // EXACT TARGET MATCHING (No startsWith prefix matching!)
    const isExactMatch = normTarget === normEvidenceTarget;

    if (!isExactMatch) {
      checks.geoOptimizer = {
        tool: geoEvidence.tool || 'geo-optimizer v4.18.3',
        status: 'evidence_target_mismatch',
        score: null,
        band: null,
        targetUrl: url,
        evidenceTargetUrl: geoEvidence.url || geoEvidence.targetUrl,
        error: `Imported GEO Optimizer evidence target ("${geoEvidence.url || geoEvidence.targetUrl}") does not match current audit target ("${url}"). Mismatched evidence rejected.`,
        rawSummary: null,
      };
    } else if (!valRes.valid) {
      // Evidence itself is malformed or invalid
      checks.geoOptimizer = {
        tool: geoEvidence.tool || 'geo-optimizer v4.18.3',
        status: 'unavailable',
        score: null,
        band: 'unavailable',
        targetUrl: normEvidenceTarget,
        error: `Invalid GEO Optimizer evidence: ${valRes.error}`,
        rawSummary: null,
      };
    } else if (geoEvidence.error || valRes.isFailedExit) {
      // Unsuccessful run, blocked measurement, or tool failure
      const errorMsg = geoEvidence.error || `Process exited with non-zero exit status: ${geoEvidence.exitStatus !== undefined ? geoEvidence.exitStatus : valRes.exitCode}`;
      checks.geoOptimizer = {
        tool: geoEvidence.tool || 'geo-optimizer v4.18.3',
        status: 'unavailable',
        score: null,
        band: geoEvidence.band || 'unavailable',
        targetUrl: normEvidenceTarget,
        runTimestamp: geoEvidence.timestamp || null,
        exitStatus: geoEvidence.exitStatus !== undefined ? geoEvidence.exitStatus : (valRes.exitCode !== null ? valRes.exitCode : 'failed'),
        exitCode: valRes.exitCode !== null ? valRes.exitCode : undefined,
        error: errorMsg,
        rawSummary: null,
      };
    } else {
      // Successful verified run or import with score in range [0, 100]
      const finalScore = typeof geoEvidence.score === 'number' ? geoEvidence.score : null;
      checks.geoOptimizer = {
        tool: geoEvidence.tool || 'geo-optimizer v4.18.3',
        status: 'completed',
        score: finalScore,
        band: geoEvidence.band || null,
        targetUrl: normEvidenceTarget,
        runTimestamp: geoEvidence.timestamp || null,
        exitStatus: geoEvidence.exitStatus !== undefined ? geoEvidence.exitStatus : (valRes.exitCode !== null ? valRes.exitCode : 'success'),
        exitCode: valRes.exitCode !== null ? valRes.exitCode : 0,
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
 * Supports running audits against allowed targets, streaming byte bounding,
 * redirect destination revalidation, persisting evidence, and restoring on restart.
 */
function createWebsiteAuditService(options = {}) {
  const {
    state,
    save,
    providerRuntime,
    getSiteUrl = () => DEFAULT_AUDIT_TARGETS.preview,
    allowLocalTargets = false,
    nowIso = () => new Date().toISOString(),
    logger = console,
  } = options;

  if (!state || typeof state !== 'object') throw new TypeError('Website audit state is required.');
  if (typeof save !== 'function') throw new TypeError('Website audit save callback is required.');
  if (!providerRuntime || typeof providerRuntime.fetch !== 'function') throw new TypeError('providerRuntime.fetch is required.');

  // Persist evidence across restarts inside state.evidence object
  if (!state.evidence || typeof state.evidence !== 'object') {
    state.evidence = {};
  }

  let running = false;

  /**
   * Imports verified GEO Optimizer evidence for a target URL and persists it to state.
   */
  function importGeoEvidence(targetUrl, evidence) {
    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new TypeError('targetUrl string is required.');
    }
    const valRes = validateGeoEvidence(evidence);
    if (!valRes.valid) {
      throw new Error(`Invalid GEO Optimizer evidence: ${valRes.error}`);
    }

    const normTarget = normalizeUrlForMatch(targetUrl);
    if (valRes.normalizedTarget !== normTarget) {
      throw new Error(`Imported evidence target ("${evidence.url || evidence.targetUrl}") does not match specified targetUrl ("${targetUrl}").`);
    }

    // Persist verified evidence in state.evidence (restored across restarts)
    state.evidence[normTarget] = {
      ...evidence,
      importedAt: nowIso(),
    };

    // If current latest audit targets this URL, re-evaluate with verified evidence
    if (state.latest && state.latest.targetUrl && normalizeUrlForMatch(state.latest.targetUrl) === normTarget) {
      const meta = state.latest._rawMeta || null;
      if (meta) {
        state.latest = evaluateWebsiteAudit(state.latest.targetUrl, meta, {
          timestamp: state.latest.checks?.timestamp || nowIso(),
          geoEvidence: state.evidence[normTarget],
        });
        state.latest._rawMeta = meta;
      }
    }

    save();
    return { ok: true, targetUrl: normTarget, evidenceStored: true };
  }

  /**
   * Executes a website audit against a target URL with redirect safety and streaming byte bounds.
   */
  async function run(overrideUrl = null) {
    if (running) return { ok: false, busy: true };
    running = true;

    const initialUrl = overrideUrl || getSiteUrl() || DEFAULT_AUDIT_TARGETS.preview;

    // SSRF Safety Check on initial URL
    const targetCheck = isApprovedAuditTarget(initialUrl, { allowLocalTargets });
    if (!targetCheck.ok) {
      running = false;
      const ssrfError = {
        success: false,
        targetUrl: initialUrl,
        status: 'unavailable',
        error: targetCheck.error,
        timestamp: nowIso(),
        checks: {
          url: initialUrl,
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
      let currentUrl = initialUrl;
      let redirectHops = 0;
      let response = null;

      // Handle redirects with revalidation
      while (redirectHops <= MAX_REDIRECTS) {
        response = await providerRuntime.fetch('website', currentUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BestDay-SEOBuddy-Audit/1.4',
          },
        }, { retries: 1 });

        // Check if redirect
        if (response && [301, 302, 307, 308].includes(response.status)) {
          const locHeader = (response.headers && typeof response.headers.get === 'function')
            ? response.headers.get('location')
            : (response.headers?.location || '');

          if (locHeader) {
            redirectHops++;
            if (redirectHops > MAX_REDIRECTS) {
              throw new Error(`Too many redirects (limit: ${MAX_REDIRECTS}).`);
            }
            const resolvedRedirect = new URL(locHeader, currentUrl).toString();
            // Re-validate redirect target to prevent open redirect SSRF
            const redirectCheck = isApprovedAuditTarget(resolvedRedirect, { allowLocalTargets });
            if (!redirectCheck.ok) {
              throw new Error(`Redirect blocked: ${redirectCheck.error}`);
            }
            currentUrl = resolvedRedirect;
            continue;
          }
        }
        break;
      }

      // Stream / chunk size limit reading
      let html = '';
      let byteSize = 0;

      if (response && response.body && typeof response.body.on === 'function') {
        // Node Readable stream with chunk-level byte counting
        html = await new Promise((resolve, reject) => {
          let accumulated = '';
          let count = 0;
          response.body.on('data', chunk => {
            count += chunk.length;
            if (count > MAX_RESPONSE_BYTES) {
              response.body.destroy();
              reject(new Error(`Response exceeded maximum allowed response limit of ${MAX_RESPONSE_BYTES} bytes while streaming.`));
            } else {
              accumulated += chunk.toString('utf8');
            }
          });
          response.body.on('end', () => {
            byteSize = count;
            resolve(accumulated);
          });
          response.body.on('error', reject);
        });
      } else if (response && typeof response.text === 'function') {
        html = await response.text();
        byteSize = Buffer.byteLength(html, 'utf8');
        if (byteSize > MAX_RESPONSE_BYTES) {
          throw new Error(`Response exceeded maximum allowed response limit of ${MAX_RESPONSE_BYTES} bytes.`);
        }
      } else if (response && typeof response.body === 'string') {
        html = response.body;
        byteSize = Buffer.byteLength(html, 'utf8');
        if (byteSize > MAX_RESPONSE_BYTES) {
          throw new Error(`Response exceeded maximum allowed response limit of ${MAX_RESPONSE_BYTES} bytes.`);
        }
      }

      // Extract response headers
      const respHeaders = {};
      if (response && response.headers) {
        if (typeof response.headers.get === 'function') {
          const xRobots = response.headers.get('x-robots-tag');
          if (xRobots) respHeaders['x-robots-tag'] = xRobots;
        } else if (typeof response.headers === 'object') {
          Object.assign(respHeaders, response.headers);
        }
      }

      const meta = parseHtmlMetadata(html, byteSize, respHeaders);

      // Check if verified GEO evidence exists in persistent state
      const norm = normalizeUrlForMatch(currentUrl);
      const geoEvidence = state.evidence[norm] || null;

      const auditResult = evaluateWebsiteAudit(currentUrl, meta, {
        timestamp: nowIso(),
        geoEvidence,
      });

      auditResult._rawMeta = meta;

      state.latest = auditResult;
      state.updatedAt = nowIso();

      // Meaningful, immutable historical record
      if (!Array.isArray(state.history)) state.history = [];
      const historyEntry = {
        targetUrl: currentUrl,
        timestamp: state.updatedAt,
        score: auditResult.score,
        crawlStatus: auditResult.checks.crawlability.status,
        geoStatus: auditResult.checks.geoOptimizer.status,
        geoScore: auditResult.checks.geoOptimizer.score,
        byteSize: auditResult.checks.performance.byteSize,
        schemaBlockCount: auditResult.checks.structuredData.blockCount,
        recommendationCount: auditResult.recommendations.length,
        recommendations: auditResult.recommendations.map(r => ({
          priority: r.priority,
          area: r.area,
          action: r.action,
        })),
        provenance: {
          toolRevision: auditResult.checks.toolRevision,
          isStaging: auditResult.checks.isStaging,
        },
      };
      state.history.unshift(historyEntry);
      if (state.history.length > 50) state.history.pop();

      save();
      return { ok: true, snapshot: auditResult };
    } catch (err) {
      logger.error('[Website Audit] Run failed:', err.message);
      // Failed audit MUST be reported as unavailable, NOT missing metadata or zero-size pages
      const failureResult = {
        success: false,
        targetUrl: initialUrl,
        status: 'unavailable',
        error: err.message,
        timestamp: nowIso(),
        checks: {
          url: initialUrl,
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
    getEvidence: (targetUrl) => state.evidence[normalizeUrlForMatch(targetUrl)] || null,
  };
}

module.exports = {
  DEFAULT_AUDIT_TARGETS,
  APPROVED_PUBLIC_DOMAINS,
  TEST_LOCAL_DOMAINS,
  isApprovedAuditTarget,
  normalizeUrlForMatch,
  validateGeoEvidence,
  parseHtmlMetadata,
  evaluateWebsiteAudit,
  createWebsiteAuditService,
};
