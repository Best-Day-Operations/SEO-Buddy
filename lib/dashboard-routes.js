'use strict';
const { gbpPublicationStatus } = require('./gbp-publication');

const MOVE_CAPABILITY = {
  nap: {
    capability: 'manual', doerLabel: 'You do it',
    ownerTitle: 'Your business details do not match on another website',
    ownerWhy: "We found a difference in your business name, address, or phone number. We can't edit another company's website, so you'll need to update that listing with your correct details.",
    ownerCta: 'Walk me through it', realEffort: 'about 15 minutes',
  },
  gbp: {
    capability: 'manual', doerLabel: 'You do it',
    ownerTitle: "This week's Google post is written",
    ownerWhy: "Google hasn't approved us to post on your behalf yet, so this is copy-and-paste for now. Takes under a minute.",
    ownerCta: 'Copy & open Google', realEffort: 'about 1 minute',
  },
  listed: {
    capability: 'manual', doerLabel: 'You do it',
    ownerWhy: 'AI recommends businesses from this source. We can draft the approach, but someone has to send it and follow up.',
    ownerCta: 'Show me the draft', realEffort: 'about 5 minutes',
  },
  autopilot: {
    capability: 'approve', doerLabel: 'Needs approval',
    ownerTitle: 'Let SEO Buddy publish for you on a schedule',
    ownerWhy: 'Say yes once and we find a gap, write the page, publish it and ask Google to list it — repeatedly, without you. That whole chain we can do end to end.',
    ownerCta: 'Turn it on', realEffort: 'about 10 seconds',
  },
  ai: {
    capability: 'approve', doerLabel: 'Needs approval',
    ownerWhy: 'See whether the AI services you have connected recommend your business. SEO Buddy runs the check; you just start it.',
    ownerCta: 'Run the check', realEffort: 'about 1 minute',
  },
  gsc: {
    capability: 'blocked', doerLabel: 'Blocked',
    ownerWhy: "We can't see your real search numbers until Google Search Console is connected. Everything on Results stays estimated until then.",
    ownerCta: 'Connect it', realEffort: 'about 5 minutes',
  },
};

function moveCapability(key) {
  return MOVE_CAPABILITY[key] || { capability: 'manual', doerLabel: 'You do it' };
}

function buildNextMoves(context) {
  const {
    localDb,
    citationsDb,
    aioAuditsDb,
    autopilotEnabled,
    gscConfigured,
    isGbpConfigured,
  } = context;
  const moves = [];
  const rank = { high: 3, med: 2, opportunity: 1 };
  if (localDb && localDb.nap && (localDb.nap.mismatchCount || 0) > 0) {
    const bad = (localDb.nap.listings || []).find(listing => listing.phoneMatch === false || listing.addrMatch === false || listing.nameMatch === false);
    const where = (bad && bad.platform) ? bad.platform : 'a listing';
    moves.push({ key: 'nap', impact: 'high', title: `Fix your business info on ${where}`, why: 'Google trusts businesses whose name, address and phone match everywhere. A mismatch quietly hurts your local ranking.', effort: '~2 min', tab: 'local-tab', cta: 'Show me how' });
  }
  if (localDb && localDb.gbpDraft && !localDb.gbpDraft.posted) {
    const gbpConfigured = isGbpConfigured();
    moves.push({
      key: 'gbp', impact: 'med', title: "Approve this week's Google post",
      why: gbpConfigured
        ? 'We wrote a fresh Google Business Profile post. Google rewards active profiles — post it in one tap.'
        : 'We wrote a fresh Google Business Profile post. Copy it into your Google Business Profile, then tap "Mark as posted" so this clears.',
      effort: '~30 sec', tab: 'local-tab',
      cta: gbpConfigured ? 'Post it' : 'Review & post',
      action: 'post-gbp',
    });
  }
  if (citationsDb && citationsDb.targets && citationsDb.targets.length) {
    const statuses = citationsDb.statuses || {};
    const target = citationsDb.targets.find(item => item.listed !== true && ((statuses[item.domain] && statuses[item.domain].status) || 'todo') === 'todo');
    if (target) moves.push({ key: 'listed', impact: 'opportunity', title: `Get listed on ${target.domain}`, why: 'AI recommends businesses from this source. Getting listed here helps AI recommend you too — we can draft the outreach.', effort: '~5 min', tab: 'citations-tab', cta: 'See how' });
  }
  if (!aioAuditsDb || !aioAuditsDb.length) {
    moves.push({ key: 'ai', impact: 'med', title: 'Run your first AI visibility check', why: 'See whether the AI services you have connected recommend your business when people ask.', effort: '~1 min', tab: 'aio-tab', cta: 'Run check' });
  }
  if (!autopilotEnabled) {
    moves.push({ key: 'autopilot', impact: 'med', title: 'Turn on content autopilot', why: 'Let SEO Buddy write and publish a fresh, keyword-targeted post for you on a schedule — hands-off.', effort: '~30 sec', tab: 'publish-tab', cta: 'Turn on', action: 'enable-autopilot' });
  }
  if (!gscConfigured) {
    moves.push({ key: 'gsc', impact: 'high', title: 'Connect Google Search Console', why: 'This unlocks your real search rankings and clicks — the biggest part of your score.', effort: '~5 min', tab: 'settings-tab', cta: 'Connect' });
  }
  moves.sort((left, right) => rank[right.impact] - rank[left.impact]);
  return moves.map(move => {
    const capability = moveCapability(move.key);
    return {
      ...move,
      capability: capability.capability,
      doerLabel: capability.doerLabel,
      ownerTitle: capability.ownerTitle || move.title,
      ownerWhy: capability.ownerWhy || move.why,
      ownerCta: capability.ownerCta || move.cta,
      realEffort: capability.realEffort || move.effort,
    };
  });
}

function buildAutopilotDigest(context, now = () => new Date()) {
  const {
    onsiteDb,
    localDb,
    citationsDb,
    perfDigestDb,
    historyDb,
    aiVisDb,
    autopilotEnabled,
  } = context;
  const nowMs = now().getTime();
  const items = [];
  if (onsiteDb && onsiteDb.ideas && onsiteDb.ideas.clusters && onsiteDb.ideas.clusters.length) {
    const count = onsiteDb.ideas.clusters.length;
    items.push({ key: 'onsite', tab: 'onsite-tab', icon: '💡', label: 'Content ideas', text: `${count} fresh topic cluster${count > 1 ? 's' : ''} to write about`, isNew: !!onsiteDb.ideas.isNew, tone: 'info' });
  }
  if (onsiteDb && onsiteDb.links && onsiteDb.links.suggestions && onsiteDb.links.suggestions.length) {
    const count = onsiteDb.links.suggestions.length;
    items.push({ key: 'onsite-links', tab: 'onsite-tab', icon: '🔗', label: 'Internal links', text: `${count} link suggestion${count > 1 ? 's' : ''} to add`, isNew: !!onsiteDb.links.isNew, tone: 'info' });
  }
  if (localDb && localDb.nap) {
    const mismatchCount = localDb.nap.mismatchCount || 0;
    items.push({ key: 'local-nap', tab: 'local-tab', icon: '📍', label: 'Business details check', text: mismatchCount ? `${mismatchCount} listing${mismatchCount > 1 ? 's' : ''} to fix` : 'All checked listings match', isNew: !!localDb.napNewMismatch, tone: mismatchCount ? 'warn' : 'info' });
  }
  if (localDb && localDb.gbpDraft) {
    const draft = localDb.gbpDraft;
    items.push({ key: 'local-gbp', tab: 'local-tab', icon: '📝', label: 'Weekly GBP post', text: draft.posted ? (gbpPublicationStatus(draft) === 'google-confirmed' ? 'Google confirmed publication ✓' : 'Marked as posted — not verified by Google') : 'Ready to post', isNew: !!draft.isNew, tone: 'info' });
  }
  if (citationsDb && citationsDb.targets && citationsDb.targets.length) {
    const total = citationsDb.targets.length;
    const statuses = citationsDb.statuses || {};
    const notDone = citationsDb.targets.filter(target => target.listed !== true && ((statuses[target.domain] && statuses[target.domain].status) || 'todo') === 'todo').length;
    const newCount = (citationsDb.newDomains || []).length;
    const text = newCount ? `${newCount} new source${newCount > 1 ? 's' : ''} AI now cites` : (notDone ? `${notDone} source${notDone > 1 ? 's' : ''} to get listed on` : `${total} sources tracked`);
    items.push({ key: 'citations', tab: 'citations-tab', icon: '🎯', label: 'Directory opportunities', text, isNew: newCount > 0, tone: 'info' });
  }
  if (perfDigestDb && perfDigestDb.digest) {
    const digest = perfDigestDb.digest;
    const clicks = digest.clicks;
    const text = clicks ? `${clicks.cur} clicks this week${clicks.pct != null ? ` (${clicks.pct >= 0 ? '+' : ''}${clicks.pct}%)` : ''}` : 'Weekly digest ready';
    items.push({ key: 'perf', tab: 'performance-tab', icon: '📈', label: 'Weekly digest', text, isNew: !!digest.isNew, tone: 'info' });
  }

  const within7d = date => {
    if (!date) return false;
    const timestamp = new Date(date).getTime();
    return !isNaN(timestamp) && (nowMs - timestamp) <= 7 * 864e5;
  };
  const articlesThisWeek = Array.isArray(historyDb) ? historyDb.filter(item => within7d(item.date || item.publishedAt)) : [];
  if (Array.isArray(historyDb) && historyDb.length) {
    const latest = historyDb[0];
    const count = articlesThisWeek.length;
    const text = count ? `${count} article${count > 1 ? 's' : ''} published this week` : `Last published “${String(latest.title || '').slice(0, 40)}${(latest.title || '').length > 40 ? '…' : ''}”`;
    items.push({ key: 'articles', tab: 'publish-tab', icon: '✍️', label: 'Content autopilot', text, isNew: within7d(latest.date || latest.publishedAt), tone: 'info' });
  }
  if (aiVisDb && Array.isArray(aiVisDb.snapshots) && aiVisDb.snapshots.length) {
    const snapshot = aiVisDb.snapshots[aiVisDb.snapshots.length - 1];
    const text = (snapshot && typeof snapshot.visibilityScore === 'number')
      ? `${snapshot.visibilityScore}% AI search visibility`
      : (snapshot && typeof snapshot.modelOnlyVisibilityScore === 'number')
        ? `${snapshot.modelOnlyVisibilityScore}% model-only evaluation (search unverified)`
        : 'AI visibility checked';
    items.push({ key: 'aivis', tab: 'aio-tab', icon: '🔎', label: 'AI Visibility', text, isNew: within7d(aiVisDb.lastRun), tone: 'info' });
  }

  const did = [];
  if (articlesThisWeek.length) did.push(`published ${articlesThisWeek.length} article${articlesThisWeek.length > 1 ? 's' : ''}`);
  if (localDb && localDb.gbpDraft && within7d(localDb.gbpDraft.createdAt)) did.push('wrote your Google Business post');
  if (localDb && within7d(localDb.lastNapRun)) did.push('checked your listings (NAP)');
  if (citationsDb && within7d(citationsDb.lastRun)) did.push('scanned directories AI cites');
  if (onsiteDb && within7d(onsiteDb.lastRun)) did.push('refreshed on-site ideas');
  if (aiVisDb && within7d(aiVisDb.lastRun)) did.push('ran an AI visibility check');
  if (perfDigestDb && within7d(perfDigestDb.lastRun)) did.push('built your performance digest');
  const enabledCount = [true, citationsDb && citationsDb.autoEnabled, localDb && localDb.enabled, onsiteDb && onsiteDb.enabled, perfDigestDb && perfDigestDb.enabled, aiVisDb && aiVisDb.autoEnabled, autopilotEnabled].filter(Boolean).length;
  const lastActivity = [
    articlesThisWeek[0] && (articlesThisWeek[0].date || articlesThisWeek[0].publishedAt),
    localDb && localDb.lastNapRun,
    localDb && localDb.lastGbpRun,
    citationsDb && citationsDb.lastRun,
    onsiteDb && onsiteDb.lastRun,
    aiVisDb && aiVisDb.lastRun,
    perfDigestDb && perfDigestDb.lastRun,
  ].filter(Boolean).map(date => new Date(date).getTime()).filter(timestamp => !isNaN(timestamp)).sort((left, right) => right - left)[0];
  const recap = did.length
    ? `This week SEO Buddy ${did.length > 1 ? `${did.slice(0, -1).join(', ')} and ${did.slice(-1)}` : did[0]} — all on its own. Nothing needs you unless a card below is marked NEW.`
    : `All ${enabledCount} autopilots are on and running on schedule. New activity will show up here automatically — no need to check back.`;
  return {
    success: true,
    items,
    recap,
    autopilotsOn: enabledCount,
    lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    newCount: items.filter(item => item.isNew).length,
    generatedAt: now().toISOString(),
  };
}

function buildDeployReadiness(context) {
  const checks = [
    { key: 'gemini', label: 'Gemini API key', icon: '🧠', ok: context.geminiConfigured, severity: 'block',
      okText: 'Powers every autopilot — content, AI visibility, local posts, and directory scans.',
      badText: 'Add your Gemini API key so the autopilots can run.', fixLabel: 'Add Gemini key' },
    { key: 'storage', label: 'Persistent storage', icon: '💾', ok: context.storagePersistent, severity: 'block',
      okText: 'History and schedules survive redeploys — the autopilots never lose their place.',
      badText: context.stateBackendMode === 'postgres'
        ? 'PostgreSQL is selected but not ready. Check DATABASE_URL and migration status.'
        : 'Attach a Railway volume and set DATA_DIR so history survives redeploys.', fixLabel: 'Set up storage' },
    { key: 'gsc', label: 'Google Search Console', icon: '🔍', ok: context.gscConfigured, severity: 'block',
      okText: 'Unlocks real rankings, clicks, and the search-gap finder.',
      badText: 'Connect Search Console to unlock real rankings and clicks.', fixLabel: 'Connect Search Console' },
    { key: 'ghl', label: 'GoHighLevel publishing', icon: '📤', ok: context.ghlConfigured, severity: 'block',
      okText: 'Lets the Content Autopilot publish articles to the live site automatically.',
      badText: 'Required for the Content Autopilot to publish articles automatically.', fixLabel: 'Add GoHighLevel token & location' },
    { key: 'admin', label: 'Admin password', icon: '🔒', ok: context.adminConfigured, severity: 'warn',
      okText: 'Settings and publishing are locked to you.',
      badText: 'Without it, anyone with the link can change settings and trigger publishing.', fixLabel: 'Set an admin password' },
    { key: 'business', label: 'Business profile', icon: '🏢', ok: context.businessProfileSaved, severity: 'warn',
      okText: 'This location’s name, address and phone are set — used across NAP, posts, and schema.',
      badText: 'Confirm this location’s name, address and phone (still using the seed profile).', fixLabel: 'Complete business profile' },
    { key: 'brand', label: 'Brand voice', icon: '🗣️', ok: context.brandReviewed, severity: 'warn', tab: 'brand-tab',
      reviewedAt: context.brandReviewedAt, durable: context.brandDurable,
      okText: 'Your voice, phrases and never-use list drive every article, post and reply.',
      badText: 'Running on the starter voice built from your brand docs — worth a read-through so it sounds like you.', fixLabel: 'Review brand voice' },
  ];
  const ready = checks.filter(check => check.ok).length;
  const total = checks.length;
  return {
    success: true,
    ready,
    total,
    blockersLeft: checks.filter(check => !check.ok && check.severity === 'block').length,
    allReady: ready === total,
    runtime: { mode: context.appMode, mockIntegrationsAllowed: context.mockIntegrationsAllowed },
    checks,
  };
}

function registerDashboardRoutes(app, options) {
  const {
    buildHealthScoreResponse,
    getNextMovesContext,
    getDigestContext,
    getReadinessContext,
    logger = console,
  } = options;

  app.get('/api/health-score', async (req, res) => {
    try {
      return res.json({ success: true, ...(await buildHealthScoreResponse()) });
    } catch (error) {
      logger.error('[Health Score] failed:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  });
  app.get('/api/next-moves', (req, res) => res.json({ success: true, moves: buildNextMoves(getNextMovesContext()) }));
  app.get('/api/autopilot-digest', (req, res) => res.json(buildAutopilotDigest(getDigestContext())));
  app.get('/api/deploy-readiness', (req, res) => res.json(buildDeployReadiness(getReadinessContext())));
}

module.exports = {
  MOVE_CAPABILITY,
  buildAutopilotDigest,
  buildDeployReadiness,
  buildNextMoves,
  moveCapability,
  registerDashboardRoutes,
};
