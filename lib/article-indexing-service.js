'use strict';

const { publicProviderError } = require('./public-provider-error');

const LEGACY_BLOG_PATH = '/blog/posts';

function normalizeBlogPathPrefix(value) {
  let prefix = String(value || '/post').trim();
  if (!prefix.startsWith('/')) prefix = '/' + prefix;
  return prefix.replace(/\/+$/, '');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasType(obj, expectedType) {
  if (!obj || typeof obj !== 'object') return false;
  const type = obj['@type'];
  if (Array.isArray(type)) return type.includes(expectedType);
  return type === expectedType;
}

function isGenuineJobPosting(obj) {
  if (!hasType(obj, 'JobPosting')) return false;
  const hasTitle = isNonEmptyString(obj.title) || isNonEmptyString(obj.jobTitle);
  const hasDescription = isNonEmptyString(obj.description);
  const hasDatePosted = isNonEmptyString(obj.datePosted);
  const hasHiringOrg = (obj.hiringOrganization && (isNonEmptyString(obj.hiringOrganization.name) || isNonEmptyString(obj.hiringOrganization)))
    || (obj.jobLocation && (typeof obj.jobLocation === 'object' || isNonEmptyString(obj.jobLocation)));
  return Boolean(hasTitle && hasDescription && hasDatePosted && hasHiringOrg);
}

function isGenuineBroadcastInVideo(obj) {
  if (hasType(obj, 'VideoObject')) {
    const event = obj.publication || obj.broadcastEvent || obj.hasPart;
    if (event) {
      const events = Array.isArray(event) ? event : [event];
      return events.some(e => hasType(e, 'BroadcastEvent') && isNonEmptyString(e.startDate));
    }
    return false;
  }
  if (hasType(obj, 'BroadcastEvent')) {
    const video = obj.video || obj.publication;
    return Boolean(video && hasType(video, 'VideoObject') && isNonEmptyString(obj.startDate));
  }
  return false;
}

function extractStructuredData(options) {
  if (!options || typeof options !== 'object') return [];
  const candidates = [];
  if (options.structuredData) candidates.push(options.structuredData);
  if (options.schema) candidates.push(options.schema);
  if (options.schemaGraph) candidates.push(options.schemaGraph);
  if (options.content && typeof options.content === 'object') candidates.push(options.content);

  const rawHtml = options.pageContent || options.html || (typeof options.content === 'string' ? options.content : null);
  if (typeof rawHtml === 'string') {
    const scriptMatches = rawHtml.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const tag of scriptMatches) {
      const jsonText = tag.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      try {
        candidates.push(JSON.parse(jsonText));
      } catch {
        // ignore malformed json tags
      }
    }
  }

  const flattened = [];
  function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(collect);
    } else {
      flattened.push(node);
      if (Array.isArray(node['@graph'])) {
        node['@graph'].forEach(collect);
      }
    }
  }
  candidates.forEach(collect);
  return flattened;
}

function validateIndexingEligibility(options = {}) {
  const nodes = extractStructuredData(options);
  if (!nodes.length) {
    return {
      eligible: false,
      reason: 'Google Indexing API only accepts pages with verified JobPosting or BroadcastEvent embedded in VideoObject structured data; ordinary articles and service pages are ineligible.',
    };
  }

  for (const node of nodes) {
    if (isGenuineJobPosting(node)) {
      return { eligible: true, type: 'JobPosting' };
    }
    if (isGenuineBroadcastInVideo(node)) {
      return { eligible: true, type: 'BroadcastEvent' };
    }
  }

  return {
    eligible: false,
    reason: 'Google Indexing API only accepts pages with verified JobPosting or BroadcastEvent embedded in VideoObject; ordinary articles and service pages are ineligible.',
  };
}

function createArticleIndexingService(options) {
  const {
    getGoogleAuth,
    createIndexingClient,
    publishIndexNotification,
    getSearchConsoleProperty,
    getBlogPathPrefix,
    getHistory,
    saveHistory,
    allowMockIntegrations = false,
    integrationUnavailable,
    formatProviderError = publicProviderError,
    logger = console,
  } = options || {};

  if (typeof getGoogleAuth !== 'function') throw new TypeError('getGoogleAuth is required.');
  if (typeof createIndexingClient !== 'function') throw new TypeError('createIndexingClient is required.');
  if (typeof publishIndexNotification !== 'function') throw new TypeError('publishIndexNotification is required.');
  if (typeof getSearchConsoleProperty !== 'function') throw new TypeError('getSearchConsoleProperty is required.');
  if (typeof getBlogPathPrefix !== 'function') throw new TypeError('getBlogPathPrefix is required.');
  if (typeof getHistory !== 'function') throw new TypeError('getHistory is required.');
  if (typeof saveHistory !== 'function') throw new TypeError('saveHistory is required.');
  if (typeof integrationUnavailable !== 'function') throw new TypeError('integrationUnavailable is required.');
  if (typeof formatProviderError !== 'function') throw new TypeError('formatProviderError is required.');

  function explainError(message) {
    const text = String(message || '');
    if (/ineligible|NOT_ELIGIBLE_FOR_INDEXING_API|JobPosting/i.test(text)) {
      return 'Google Indexing API only accepts JobPosting or BroadcastEvent pages. Ordinary articles and service pages are discovered via XML sitemap.';
    }
    if (/ownership|Permission denied|Failed to verify|does not have .*permission/i.test(text)) {
      return `Google refused the indexing request: the service account is not a verified OWNER of the site in Search Console. `
        + `Fix: Search Console → Settings → Users and permissions → add the service-account email (the "client_email" in your Google service-account JSON) with permission = Owner. `
        + `Note: "Full" access — which is enough for the GSC data tabs — is NOT enough for the Indexing API. `
        + `Also confirm the published URL is on the same verified domain (${getSearchConsoleProperty() || 'your property'}).`;
    }
    return formatProviderError({ message: text }, {
      provider: 'Google Indexing',
      operation: 'The indexing request',
      setupPath: 'Settings → Your connections → Google Search Console',
    }).error;
  }

  async function submit(url, options = {}) {
    const auth = getGoogleAuth();
    if (!auth && !allowMockIntegrations) {
      throw integrationUnavailable(
        'google_indexing',
        'Google Indexing is not configured. Add valid service-account credentials before requesting production indexing.',
      );
    }

    // Mandatory eligibility check at the shared submission boundary before any provider calls
    const eligibility = validateIndexingEligibility(options);
    if (!eligibility.eligible) {
      const error = new Error(eligibility.reason || 'Google Indexing API only accepts JobPosting or BroadcastEvent pages; ordinary articles and service pages are ineligible.');
      error.code = 'NOT_ELIGIBLE_FOR_INDEXING_API';
      throw error;
    }

    if (auth) {
      const response = await publishIndexNotification(createIndexingClient(auth), {
        requestBody: { url, type: 'URL_UPDATED' },
      });
      return {
        success: true,
        source: 'live_indexing',
        message: 'URL submitted to Google Indexing API successfully!',
        data: response.data,
        qualifyingSchema: true,
        schemaType: eligibility.type,
      };
    }

    return {
      success: true,
      source: 'mock_indexing',
      message: 'Submission simulated in Mock Mode.',
      qualifyingSchema: true,
      schemaType: eligibility.type,
    };
  }

  function migrateStalePostUrls() {
    const prefix = normalizeBlogPathPrefix(getBlogPathPrefix());
    if (prefix === LEGACY_BLOG_PATH) return 0;
    let changed = 0;
    getHistory().forEach(entry => {
      if (entry && typeof entry.url === 'string' && entry.url.includes(LEGACY_BLOG_PATH + '/')) {
        entry.url = entry.url.replace(LEGACY_BLOG_PATH + '/', prefix + '/');
        entry.needsReindex = true;
        changed++;
      }
    });
    if (changed) {
      saveHistory();
      logger.log(`[URL Migration] Rewrote ${changed} stale blog URL(s): ${LEGACY_BLOG_PATH}/ -> ${prefix}/`);
    }
    return changed;
  }

  async function reindexRepairedPosts() {
    const targets = getHistory().filter(entry => (
      entry && entry.needsReindex && /published/i.test(entry.platform || '')
    ));
    if (!targets.length) return 0;
    logger.log(`[URL Migration] Reviewing ${targets.length} repaired URL(s) for indexing...`);
    let attempted = 0;
    for (const entry of targets) {
      const eligibility = validateIndexingEligibility(entry);
      if (!eligibility.eligible) {
        entry.indexed = 'Sitemap Discovered';
        delete entry.needsReindex;
        logger.log(`[URL Migration] Skipped Indexing API submission for ordinary article (discovered via sitemap): ${entry.url}`);
        continue;
      }
      attempted++;
      try {
        await submit(entry.url, entry);
        entry.indexed = 'Indexing Requested';
        logger.log(`[URL Migration] Re-indexed: ${entry.url}`);
      } catch (error) {
        logger.error(`[URL Migration] Re-index failed for ${entry.url}: ${explainError(error.message)}`);
      } finally {
        delete entry.needsReindex;
      }
    }
    saveHistory();
    return attempted;
  }

  return { explainError, migrateStalePostUrls, reindexRepairedPosts, submit };
}

module.exports = {
  LEGACY_BLOG_PATH,
  createArticleIndexingService,
  normalizeBlogPathPrefix,
  validateIndexingEligibility,
};
