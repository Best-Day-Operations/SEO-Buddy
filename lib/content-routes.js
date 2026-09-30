'use strict';
const { publicProviderError } = require('./public-provider-error');

function belongsToSearchConsoleProperty(url, configuredProperty) {
  const configured = String(configuredProperty || '').trim();
  if (!configured) return true;

  const target = new URL(url);
  if (configured.startsWith('sc-domain:')) {
    const domain = configured.slice(10);
    return target.hostname === domain || target.hostname.endsWith('.' + domain);
  }
  return url.startsWith(configured);
}

function registerContentRoutes(app, options) {
  const {
    requireAuth,
    state,
    generateArticle,
    publishGhl,
    indexUrl,
    safeHttpUrl,
    sanitizeArticleHtml,
    assessArticleQuality,
    brandViolations,
    usageOverBudget,
    budgetBlock,
    integrationErrorStatus,
    explainIndexError,
    saveHistory,
    getSearchConsoleProperty,
    today = () => new Date().toISOString().split('T')[0],
  } = options;

  app.post('/api/generate-article', requireAuth, async (req, res) => {
    const body = req.body || {};
    const keyword = String(body.keyword || '').trim().slice(0, 300);
    const caseStudy = String(body.caseStudy || '').trim().slice(0, 10000);
    const ctaText = String(body.ctaText || '').trim().slice(0, 300);
    const ctaUrl = String(body.ctaUrl || '').trim().slice(0, 2000);
    const transcript = String(body.transcript || '').trim().slice(0, 60000);
    if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
    if (ctaUrl && !safeHttpUrl(ctaUrl)) {
      return res.status(400).json({ error: 'CTA URL must start with http:// or https://.' });
    }
    if (usageOverBudget()) return budgetBlock(res);

    try {
      return res.json(await generateArticle(keyword, caseStudy, ctaText, ctaUrl, transcript));
    } catch (error) {
      const failure = publicProviderError(error, {
        provider: 'Gemini',
        operation: 'The article draft',
        setupPath: 'Settings → Your connections → Gemini',
      });
      return res.status(integrationErrorStatus(error)).json({
        success: false,
        code: error.code === 'INTEGRATION_UNAVAILABLE' ? error.code : failure.code,
        error: failure.error,
      });
    }
  });

  app.post('/api/publish-ghl', requireAuth, async (req, res) => {
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 300);
    const content = sanitizeArticleHtml(String(body.content || '').slice(0, 2 * 1024 * 1024));
    const status = ['draft', 'published'].includes(String(body.status || '').toLowerCase())
      ? String(body.status).toLowerCase()
      : 'draft';
    if (!title) return res.status(400).json({ success: false, error: 'A title is required.' });
    if (!content.trim()) return res.status(400).json({ success: false, error: 'Article content is required.' });

    try {
      // Credentials and destination IDs remain server-side dependencies; the
      // request can never override them.
      const data = await publishGhl(title, content, status);
      const quality = assessArticleQuality(content, {
        brandViolations: brandViolations(content + ' ' + title),
      });
      const historyEntry = {
        title,
        keyword: String(body.keyword || 'Manual Entry').slice(0, 300),
        platform: data.source === 'mock_ghl' ? 'GHL (Mock Manual)' : `GoHighLevel (${status})`,
        date: today(),
        indexed: 'Indexing Available',
        url: data.url,
        qualityScore: quality.score,
        qualityVersion: quality.version,
      };

      if (!state.history.some(entry => entry.url === historyEntry.url)) {
        state.history.unshift(historyEntry);
        saveHistory();
      }
      return res.json({ ...data, quality });
    } catch (error) {
      const failure = publicProviderError(error, {
        provider: 'GoHighLevel',
        operation: 'The article publication',
        setupPath: 'Settings → Your connections → GoHighLevel',
      });
      return res.status(integrationErrorStatus(error)).json({
        success: false,
        code: error.code === 'INTEGRATION_UNAVAILABLE' ? error.code : failure.code,
        error: failure.error,
      });
    }
  });

  app.post('/api/index-url', requireAuth, async (req, res) => {
    const url = safeHttpUrl(req.body && req.body.url);
    if (!url) return res.status(400).json({ error: 'A valid http:// or https:// URL is required.' });
    if (!belongsToSearchConsoleProperty(url, getSearchConsoleProperty())) {
      return res.status(400).json({ error: 'The indexing URL must belong to the configured Search Console property.' });
    }

    try {
      const data = await indexUrl(url, req.body);
      state.history.forEach(entry => {
        if (entry.url === url) entry.indexed = 'Indexing Requested';
      });
      saveHistory();
      return res.json(data);
    } catch (error) {
      if (error.code === 'NOT_ELIGIBLE_FOR_INDEXING_API') {
        return res.status(400).json({
          success: false,
          code: error.code,
          error: explainIndexError(error.message),
        });
      }
      const failure = publicProviderError(error, {
        provider: 'Google Indexing',
        operation: 'The indexing request',
        setupPath: 'Settings → Your connections → Google Search Console',
      });
      return res.status(integrationErrorStatus(error)).json({
        success: false,
        code: error.code === 'INTEGRATION_UNAVAILABLE' ? error.code : failure.code,
        error: explainIndexError(error.message),
      });
    }
  });

  app.get('/api/history', (req, res) => {
    res.json(state.history);
  });
}

module.exports = { belongsToSearchConsoleProperty, registerContentRoutes };
