'use strict';

const { publicProviderError } = require('./public-provider-error');

const LEGACY_BLOG_PATH = '/blog/posts';

function normalizeBlogPathPrefix(value) {
  let prefix = String(value || '/post').trim();
  if (!prefix.startsWith('/')) prefix = '/' + prefix;
  return prefix.replace(/\/+$/, '');
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
    const isQualifying = options.schemaType ? ['JobPosting', 'BroadcastEvent'].includes(options.schemaType) : null;
    if (options.strictEligibility && isQualifying === false) {
      throw new Error(`Google Indexing API only accepts JobPosting or BroadcastEvent pages; cannot submit schemaType ${options.schemaType}`);
    }
    if (auth) {
      const response = await publishIndexNotification(createIndexingClient(auth), {
        requestBody: { url, type: 'URL_UPDATED' },
      });
      const result = {
        success: true,
        source: 'live_indexing',
        message: 'URL submitted to Google Indexing API successfully!',
        data: response.data,
      };
      if (isQualifying !== null) {
        result.qualifyingSchema = isQualifying;
      }
      return result;
    }

    if (!allowMockIntegrations) {
      throw integrationUnavailable(
        'google_indexing',
        'Google Indexing is not configured. Add valid service-account credentials before requesting production indexing.',
      );
    }

    return {
      success: true,
      source: 'mock_indexing',
      message: 'Submission simulated in Mock Mode.',
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
    logger.log(`[URL Migration] Re-submitting ${targets.length} repaired URL(s) to Google indexing...`);
    for (const entry of targets) {
      try {
        await submit(entry.url);
        entry.indexed = 'Indexing Requested';
        logger.log(`[URL Migration] Re-indexed: ${entry.url}`);
      } catch (error) {
        logger.error(`[URL Migration] Re-index failed for ${entry.url}: ${explainError(error.message)}`);
      } finally {
        delete entry.needsReindex;
      }
    }
    saveHistory();
    return targets.length;
  }

  return { explainError, migrateStalePostUrls, reindexRepairedPosts, submit };
}

module.exports = {
  LEGACY_BLOG_PATH,
  createArticleIndexingService,
  normalizeBlogPathPrefix,
};
