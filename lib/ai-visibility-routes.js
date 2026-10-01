'use strict';
const { publicProviderError } = require('./public-provider-error');
const { APPROVED_SERVICE_PROMPTS, PROMPT_SET_VERSION, filterSnapshotByCategory } = require('./ai-visibility-service');

function buildVisibilityDeltas(latest, previous) {
  if (!latest || latest.measured === false) return { visibility: null, shareOfVoice: null, sentiment: null };
  const delta = (current, prior) => current == null || prior == null ? null : current - prior;
  return {
    visibility: previous ? delta(latest.visibilityScore, previous.visibilityScore) : null,
    shareOfVoice: previous ? delta(latest.shareOfVoice, previous.shareOfVoice) : null,
    sentiment: previous ? delta(latest.sentimentScore, previous.sentimentScore) : null,
  };
}

function normalizePrompts(prompts, defaults) {
  if (!Array.isArray(prompts)) return null;
  const clean = prompts.map(prompt => String(prompt || '').trim()).filter(Boolean).slice(0, 25);
  return clean.length ? clean : defaults.slice();
}

function registerAiVisibilityRoutes(app, options) {
  const {
    requireAuth,
    state,
    nudgeSchedule,
    brandName,
    enginesStatus,
    trend,
    anyConfigured,
    runVisibility,
    usageOverBudget,
    budgetBlock,
    save,
    defaultPrompts,
    approvedServicePrompts = APPROVED_SERVICE_PROMPTS,
    promptSetVersion = PROMPT_SET_VERSION,
    logger = console,
  } = options;

  // Settings must not enqueue scans just to inspect configured providers.
  app.get('/api/ai-engines', (req, res) => {
    res.json({ success: true, engines: enginesStatus().map(({ id, label, configured }) => ({ id, label, configured: !!configured })) });
  });

  app.get('/api/ai-visibility', (req, res) => {
    nudgeSchedule();
    const snapshots = Array.isArray(state.snapshots) ? state.snapshots : [];
    const category = req && req.query ? (req.query.category || req.query.serviceCategory) : null;
    const isAll = !category || category === 'all';

    let relevantSnapshots = [];
    if (!isAll) {
      relevantSnapshots = snapshots
        .map(s => filterSnapshotByCategory(s, category, brandName()))
        .filter(Boolean);
    } else {
      relevantSnapshots = snapshots.slice();
    }

    let latest = null;
    let previous = null;

    if (!isAll && relevantSnapshots.length === 0) {
      // Explicit not-yet-measured state for unmeasured category:
      // Null scores and no unrelated trend or substituted results.
      latest = {
        measured: false,
        status: 'not_yet_measured',
        date: null,
        ranAt: null,
        timestamp: null,
        serviceCategory: category,
        serviceCategories: [category],
        visibilityScore: null,
        searchVisibilityScore: null,
        modelOnlyVisibilityScore: null,
        recommendationRate: null,
        brandMentions: 0,
        brandCitations: 0,
        brandRecommendations: 0,
        recommendationClassifiedCount: 0,
        searchGroundedCount: 0,
        modelOnlyCount: 0,
        totalAnswers: 0,
        shareOfVoice: null,
        sentimentScore: null,
        perEngine: enginesStatus().map(e => ({
          engine: e.id,
          label: e.label,
          score: null,
          searchScore: null,
          modelScore: null,
          answers: 0,
          searchAnswers: 0,
          modelAnswers: 0,
          classifiedAnswers: 0,
          modelClassifiedAnswers: 0,
        })),
        leaderboard: [{ name: brandName(), isBrand: true, mentions: 0, score: 0 }],
        answers: [],
      };
      previous = null;
    } else {
      latest = relevantSnapshots[relevantSnapshots.length - 1] || null;
      previous = relevantSnapshots.length > 1 ? relevantSnapshots[relevantSnapshots.length - 2] : null;
    }

    return res.json({
      brand: brandName(),
      category: isAll ? 'all' : category,
      serviceCategory: isAll ? 'all' : category,
      isAllServices: isAll,
      engines: enginesStatus(),
      prompts: state.prompts,
      approvedServicePrompts,
      promptSetVersion,
      serviceCategories: Object.keys(approvedServicePrompts),
      latest,
      deltas: buildVisibilityDeltas(latest, previous),
      trend: trend(category),
      updatedAt: state.updatedAt,
      anyConfigured: anyConfigured(),
      autoEnabled: !!state.autoEnabled,
      intervalDays: state.intervalDays || 7,
      lastRun: state.lastRun,
      running: state.running,
    });
  });

  app.post('/api/ai-visibility/run', requireAuth, async (req, res) => {
    const busyResponse = () => res.json({ success: true, busy: true, message: 'A visibility check is already running — hang tight.' });
    if (state.running) {
      return busyResponse();
    }
    if (usageOverBudget()) return budgetBlock(res);

    const { engines, prompts, serviceCategories, serviceCategory, categories } = req.body || {};
    try {
      const output = await runVisibility(Array.isArray(engines) ? engines : null, {
        prompts: Array.isArray(prompts) ? prompts : undefined,
        serviceCategories: serviceCategories || categories || (serviceCategory ? [serviceCategory] : undefined),
      });
      if (output.busy) return busyResponse();
      if (output.error) return res.status(400).json({ success: false, error: output.error });
      return res.json({ success: true, snapshot: output.snapshot });
    } catch (error) {
      const failure = publicProviderError(error, { provider: 'The connected AI provider', operation: 'The AI Visibility check' });
      logger.error('[AI Visibility run] failed:', failure.code);
      return res.status(502).json({ success: false, error: failure.error });
    }
  });

  app.post('/api/ai-visibility/toggle', requireAuth, (req, res) => {
    state.autoEnabled = !!(req.body && req.body.enabled);
    save();
    res.json({ success: true, enabled: state.autoEnabled });
  });

  app.post('/api/ai-visibility/prompts', requireAuth, (req, res) => {
    const body = req.body || {};
    let incoming = body.prompts;
    const catCatalog = approvedServicePrompts || APPROVED_SERVICE_PROMPTS;

    if (body.category) {
      const catKey = body.category;
      let catPrompts = [];
      if (catKey === 'all') {
        const set = new Set();
        Object.values(catCatalog).forEach(list => list.forEach(p => set.add(p)));
        catPrompts = Array.from(set);
      } else if (catCatalog[catKey]) {
        catPrompts = [...catCatalog[catKey]];
      }
      if (body.mode === 'merge' || body.preserveExisting || body.append) {
        const existing = Array.isArray(state.prompts) && state.prompts.length ? state.prompts : defaultPrompts;
        incoming = Array.from(new Set([...existing, ...catPrompts]));
      } else {
        incoming = catPrompts;
      }
    } else if (body.preserveExisting || body.mode === 'merge' || body.append) {
      const existing = Array.isArray(state.prompts) && state.prompts.length ? state.prompts : defaultPrompts;
      incoming = Array.from(new Set([...existing, ...(Array.isArray(incoming) ? incoming : [])]));
    }

    const prompts = normalizePrompts(incoming, defaultPrompts);
    if (!prompts) {
      return res.status(400).json({ success: false, error: 'prompts must be an array of strings.' });
    }
    state.prompts = prompts;
    save();
    return res.json({
      success: true,
      prompts: state.prompts,
      promptSetVersion,
    });
  });
}

module.exports = { buildVisibilityDeltas, normalizePrompts, registerAiVisibilityRoutes };
