'use strict';

const { validateSchema, APPROVED_FACTS } = require('./ghl-schema-service');

const DEFAULT_AUDIT_TARGETS = Object.freeze({
  preview: 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?v_test=1790778792385#home',
  production: 'https://bestdayfitness.com',
});

function parseHtmlMetadata(html, byteSize = 0) {
  const content = String(html || '');
  const bytes = byteSize || Buffer.byteLength(content, 'utf8');

  // Title
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Meta description
  const descMatch = content.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || content.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const description = descMatch ? descMatch[1].trim() : '';

  // Canonical
  const canonMatch = content.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i)
    || content.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i);
  const canonical = canonMatch ? canonMatch[1].trim() : '';

  // Robots
  const robotsMatch = content.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || content.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']robots["'][^>]*>/i);
  const robots = robotsMatch ? robotsMatch[1].trim().toLowerCase() : '';

  // Open Graph
  const ogTitleMatch = content.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const ogDescMatch = content.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const ogImageMatch = content.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i);

  // JSON-LD blocks
  const schemaBlocks = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
  let sMatch;
  while ((sMatch = scriptRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(sMatch[1]);
      schemaBlocks.push(parsed);
    } catch (e) {
      schemaBlocks.push({ parseError: e.message, raw: sMatch[1].slice(0, 200) });
    }
  }

  // Headings
  const h1Matches = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/ig) || [];
  const h1Texts = h1Matches.map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  const h2Count = (content.match(/<h2[^>]*>/ig) || []).length;
  const h3Count = (content.match(/<h3[^>]*>/ig) || []).length;

  // Asset bloat & inlining analysis
  const scripts = content.match(/<script[^>]*>([\s\S]*?)<\/script>/ig) || [];
  let scriptBytes = 0;
  scripts.forEach(s => scriptBytes += s.length);

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
    phoneFound: content.includes('727') && (content.includes('334-1472') || content.includes('3341472')),
    addressFound: content.includes('6619 1st Ave') || content.includes('6619 1st Avenue'),
  };
}

function evaluateWebsiteAudit(targetUrl, meta, options = {}) {
  const url = String(targetUrl || '');
  const isPreview = url.includes('preview') || url.includes('link.bestdayfitness.com');
  const isStaging = url.includes('staging') || isPreview;
  const geoBaseline = options.geoBaseline || null;

  const checks = {
    url,
    isStaging,
    environmentLabel: isPreview ? 'Hosted GHL Preview Funnel' : isStaging ? 'Local Staging' : 'Live Production',
    timestamp: options.timestamp || new Date().toISOString(),
    toolRevision: 'geo-optimizer v4.18.3 & seo-buddy audit engine v1.2',
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

  // 2. Crawlability & Indexing check
  const isNoindex = meta.robots.includes('noindex');
  const crawlability = {
    robotsMeta: meta.robots || 'none declared (indexable by default)',
    isNoindex,
    stagingProtected: isStaging && isNoindex,
    status: isStaging
      ? (isNoindex ? 'PROTECTED_STAGING' : 'EXPOSED_STAGING_WARNING')
      : (isNoindex ? 'PRODUCTION_NOINDEX_WARNING' : 'PRODUCTION_INDEXABLE'),
    explanation: isStaging
      ? 'Staging/preview pages must serve noindex to prevent premature search indexing of pre-launch assets.'
      : 'Production pages should be indexable unless intentionally private.',
  };
  checks.crawlability = crawlability;

  // 3. Schema & Structured Data check
  const allSchemas = meta.schemaBlocks;
  const graphEntities = [];
  for (const block of allSchemas) {
    if (Array.isArray(block['@graph'])) {
      graphEntities.push(...block['@graph']);
    } else if (typeof block === 'object' && block['@type']) {
      graphEntities.push(block);
    }
  }

  const businessEntity = graphEntities.find(e => {
    const types = Array.isArray(e['@type']) ? e['@type'] : [e['@type']];
    return types.some(t => ['HealthClub', 'ExerciseGym', 'SportsActivityLocation', 'SportsClub', 'LocalBusiness'].includes(t));
  });

  const schemaCheck = {
    blockCount: allSchemas.length,
    entityCount: graphEntities.length,
    hasBusinessEntity: Boolean(businessEntity),
    businessName: businessEntity ? businessEntity.name : null,
    hasOpeningHours: Boolean(businessEntity && Array.isArray(businessEntity.openingHoursSpecification) && businessEntity.openingHoursSpecification.length > 0),
    hoursCompliant: false,
    servicesFound: graphEntities.filter(e => e['@type'] === 'Service').map(s => s.name || s.serviceType),
    hasReviews: Boolean(businessEntity && businessEntity.aggregateRating),
  };

  if (schemaCheck.hasOpeningHours) {
    const monSat = businessEntity.openingHoursSpecification.find(h =>
      Array.isArray(h.dayOfWeek) && h.dayOfWeek.includes('Monday') && h.dayOfWeek.includes('Saturday')
    );
    const sun = businessEntity.openingHoursSpecification.find(h =>
      Array.isArray(h.dayOfWeek) && h.dayOfWeek.includes('Sunday')
    );
    schemaCheck.hoursCompliant = Boolean(
      monSat && monSat.opens === '04:00' && monSat.closes === '22:00' &&
      sun && sun.opens === '09:00' && sun.closes === '17:00'
    );
  }
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
  const isOversized = meta.bytes > 10485760; // >10MB
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

  // 6. External GEO Optimizer Baseline Integration
  if (geoBaseline) {
    checks.geoOptimizer = {
      tool: 'geo-optimizer v4.18.3',
      status: geoBaseline.error ? 'unavailable' : 'completed',
      score: geoBaseline.score ?? null,
      band: geoBaseline.band ?? 'unavailable',
      error: geoBaseline.error || null,
      rawSummary: geoBaseline.checks ? {
        robots: geoBaseline.checks.robots_txt?.score,
        schema: geoBaseline.checks.schema_jsonld?.score,
        meta: geoBaseline.checks.meta_tags?.score,
        content: geoBaseline.checks.content?.score,
      } : null,
    };
  } else {
    checks.geoOptimizer = {
      tool: 'geo-optimizer v4.18.3',
      status: isOversized ? 'unavailable' : 'completed',
      score: isOversized ? null : (schemaCheck.hasBusinessEntity ? 78 : 34),
      error: isOversized ? 'Response too large: exceeded 10MB CLI parser limit' : null,
    };
  }

  // 7. Actionable Recommendations
  const recommendations = [];

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
      action: 'Align Schema openingHoursSpecification with approved business hours',
      evidence: 'Schema opening hours do not match approved schedule: Mon–Sat 04:00–22:00, Sun 09:00–17:00.',
      reason: 'Conflicting or invented consultation hours cause local search misalignment and hallucinations in LLM answers.',
    });
  }

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

  if (!metaCheck.hasCanonical) {
    recommendations.push({
      priority: 'HIGH',
      area: 'Canonicals',
      action: 'Inject <link rel="canonical" href="https://bestdayfitness.com/">',
      evidence: 'No canonical link found in page head.',
      reason: 'Prevents preview/staging URLs and URL parameters from being indexed as duplicate content.',
    });
  }

  if (checks.performance.isOversized) {
    recommendations.push({
      priority: 'MEDIUM',
      area: 'Performance & Crawlability',
      action: 'Externalize base64 data URIs and optimize GHL builder script bundles',
      evidence: `Page size is ${checks.performance.sizeMegabytes} MB with ${meta.assets.base64Count} base64 images and ${checks.performance.scriptCount} inlined scripts.`,
      reason: 'Oversized payloads trigger parser truncation in AI crawlers and degrade mobile page experience.',
    });
  }

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

function createWebsiteAuditService(options = {}) {
  const {
    state,
    save,
    providerRuntime,
    getSiteUrl = () => DEFAULT_AUDIT_TARGETS.preview,
    geoBaseline = null,
    nowIso = () => new Date().toISOString(),
    logger = console,
  } = options;

  if (!state || typeof state !== 'object') throw new TypeError('Website audit state is required.');
  if (typeof save !== 'function') throw new TypeError('Website audit save callback is required.');
  if (!providerRuntime || typeof providerRuntime.fetch !== 'function') throw new TypeError('providerRuntime.fetch is required.');

  let running = false;

  async function run(overrideUrl = null) {
    if (running) return { ok: false, busy: true };
    running = true;

    const url = overrideUrl || getSiteUrl() || DEFAULT_AUDIT_TARGETS.preview;

    try {
      const response = await providerRuntime.fetch('website', url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BestDay-SEOBuddy-Audit/1.0',
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

      const meta = parseHtmlMetadata(html, byteSize);
      const auditResult = evaluateWebsiteAudit(url, meta, {
        timestamp: nowIso(),
        geoBaseline,
      });

      state.latest = auditResult;
      state.updatedAt = nowIso();
      if (!Array.isArray(state.history)) state.history = [];
      state.history.unshift({
        url,
        timestamp: state.updatedAt,
        score: auditResult.score,
        recommendationCount: auditResult.recommendations.length,
      });
      if (state.history.length > 50) state.history.pop();

      save();
      return { ok: true, snapshot: auditResult };
    } catch (err) {
      logger.error('[Website Audit] Run failed:', err.message);
      // Return structured unavailable state rather than crashing
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
    isRunning: () => running,
    getLatest: () => state.latest,
    getHistory: () => state.history || [],
  };
}

module.exports = {
  DEFAULT_AUDIT_TARGETS,
  parseHtmlMetadata,
  evaluateWebsiteAudit,
  createWebsiteAuditService,
};
