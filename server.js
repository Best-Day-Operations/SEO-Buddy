const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const { GoogleGenAI } = require('@google/genai');
const { saveJsonFileSync, setJsonWriteObserver, writeJsonFileSync } = require('./lib/json-file-store');
const { createHealthScoreService } = require('./lib/health-score-service');
const { createScoreHistory } = require('./lib/score-history');
const { createScoreHistoryRepository } = require('./lib/score-history-repository');
const { createPublicationHistoryRepository } = require('./lib/publication-history-repository');
const { createPerformanceHistory } = require('./lib/performance-history');
const { createPerformanceHistoryRepository } = require('./lib/performance-history-repository');
const { integrationUnavailable, mocksAllowed, resolveAppMode } = require('./lib/runtime-mode');
const { createLogger } = require('./lib/logger');
const { createRequestMetrics } = require('./lib/request-metrics');
const { buildBrowserAssets, renderAssetIndex } = require('./lib/browser-assets');
const { createAccessControl } = require('./lib/access-control');
const { createAuditLog } = require('./lib/audit-log');
const { createFileStateRepository } = require('./lib/state-repository');
const { createBackupService } = require('./lib/backup-service');
const { createPostgresStore } = require('./lib/postgres-store');
const { createPostgresStateBridge } = require('./lib/postgres-state-bridge');
const { createDurableJobQueue } = require('./lib/durable-job-queue');
const { createSwitchableJobQueue } = require('./lib/job-queue');
const { createPostgresJobQueue } = require('./lib/postgres-job-queue');
const { createJobWorker } = require('./lib/job-worker');
const { createJobDispatcher } = require('./lib/job-dispatcher');
const { buildAutomationStatus, registerAutomationStatusRoute } = require('./lib/automation-status');
const { ProviderRuntimeError, createProviderRuntime } = require('./lib/provider-runtime');
const { assessArticleQuality } = require('./lib/content-quality');
const { createArticleGenerationService } = require('./lib/article-generation-service');
const { createArticlePublishingService } = require('./lib/article-publishing-service');
const { createArticleIndexingService } = require('./lib/article-indexing-service');
const { createGoogleApiClient } = require('./lib/google-api-client');
const { createBrandProfileService } = require('./lib/brand-profile-service');
const { createBusinessProfileService } = require('./lib/business-profile-service');
const { escapeHtml, safeHttpUrl, sanitizeArticleHtml } = require('./lib/content-safety');
const { registerOperationsRoutes } = require('./lib/operations-routes');
const { registerProfileRoutes } = require('./lib/profile-routes');
const { registerUsageRoutes } = require('./lib/usage-routes');
const { createUsageMeter } = require('./lib/usage-meter');
const { createUsageRepository } = require('./lib/usage-repository');
const { registerGscRoutes } = require('./lib/gsc-routes');
const { registerAutopilotRoutes } = require('./lib/autopilot-routes');
const { createContentScheduler } = require('./lib/content-scheduler');
const { createContentAutopilotService } = require('./lib/content-autopilot-service');
const { recordGbpPublication, gbpPublicationStatus } = require('./lib/gbp-publication');
const { registerContentRoutes } = require('./lib/content-routes');
const { registerAiVisibilityRoutes } = require('./lib/ai-visibility-routes');
const { DEFAULT_AI_ENGINES, DEFAULT_VIS_PROMPTS, createAiVisibilityService } = require('./lib/ai-visibility-service');
const { registerAiAuditRoutes } = require('./lib/ai-audit-routes');
const { buildFactTruth, createAiFactCheckService } = require('./lib/ai-factcheck-service');
const { createAiCrawlerService } = require('./lib/ai-crawler-service');
const { createRedditDiscoveryService } = require('./lib/reddit-discovery-service');
const { registerScheduledFeatureRoutes } = require('./lib/scheduled-feature-routes');
const { createGoogleDelivery } = require('./lib/google-delivery');
const { registerDeliveryRoutes } = require('./lib/delivery-routes');
const { createMonthlyReportService, registerMonthlyReportRoutes } = require('./lib/monthly-report');
const { createMonthlyReportDataService } = require('./lib/monthly-report-data-service');
const { createServerPdfReport } = require('./lib/server-pdf-report');
const { registerCitationRoutes } = require('./lib/citation-routes');
const { eligibleCitationState, buildCitationWorklist } = require('./lib/citation-eligibility');
const { createCitationScanService } = require('./lib/citation-scan-service');
const { createListingKitService } = require('./lib/listing-kit-service');
const { registerLocalSeoRoutes } = require('./lib/local-seo-routes');
const { effectiveNap, registerLocalListingRoutes } = require('./lib/local-listing-preferences');
const { createLocalAutopilotService } = require('./lib/local-autopilot-service');
const { createPerformanceService, registerPerformanceRoutes } = require('./lib/performance-routes');
const { registerOnsiteRoutes } = require('./lib/onsite-routes');
const { createOnsiteAutopilotService } = require('./lib/onsite-autopilot-service');
const { createPerformanceDigestService } = require('./lib/performance-digest-service');
const { registerAioCoreRoutes } = require('./lib/aio-core-routes');
const { registerAssistantRoutes } = require('./lib/assistant-routes');
const { createAssistantContext } = require('./lib/assistant-context');
const { registerRecordedContentRoutes } = require('./lib/recorded-content-routes');
const { buildDeployReadiness, buildNextMoves, registerDashboardRoutes } = require('./lib/dashboard-routes');
const { createReviewsService, registerReviewsRoutes } = require('./lib/reviews-routes');
const { registerConfigurationRoutes } = require('./lib/configuration-routes');
const { buildOperationalHealth } = require('./lib/operational-health');
const { createCredentialMetadata } = require('./lib/credential-metadata');
const { createReliabilityAlertService, registerReliabilityAlertRoutes } = require('./lib/reliability-alerts');
const { resolveProcessRole } = require('./lib/process-role');
const { createBackgroundRuntime } = require('./lib/background-runtime');
const { createWebsiteAuditService, DEFAULT_AUDIT_TARGETS } = require('./lib/website-audit-service');
const { buildGhlSchemaGraph, buildGhlTrackingSnippet, validateSchema, APPROVED_FACTS } = require('./lib/ghl-schema-service');

// Load volume-backed configuration before composition. Deployments using
// SECRET_STORAGE_MODE=managed keep credentials in host variables; dotenv's
// default no-override behavior preserves those authoritative values.
const CONFIG_DIR = process.env.DATA_DIR || __dirname;
dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const APP_MODE = resolveAppMode(process.env);
const PROCESS_ROLE = resolveProcessRole(process.env);
const STATE_BACKEND_MODE = String(process.env.STATE_BACKEND || 'filesystem').trim().toLowerCase();
const SECRET_STORAGE_MODE = String(process.env.SECRET_STORAGE_MODE || 'volume').trim().toLowerCase();
if (!['filesystem', 'postgres'].includes(STATE_BACKEND_MODE)) throw new Error('STATE_BACKEND must be filesystem or postgres.');
if (STATE_BACKEND_MODE === 'postgres' && !process.env.DATABASE_URL) throw new Error('STATE_BACKEND=postgres requires DATABASE_URL.');
if (!['volume', 'managed'].includes(SECRET_STORAGE_MODE)) throw new Error('SECRET_STORAGE_MODE must be volume or managed.');
const ALLOW_MOCK_INTEGRATIONS = mocksAllowed(APP_MODE, process.env);
const BOOTED_AT = new Date().toISOString();
const logger = createLogger({ service: 'seo-buddy', environment: APP_MODE });
const requestMetrics = createRequestMetrics();
const AI_PROVIDER_NAMES = new Set(['gemini', 'openai', 'perplexity']);
const providerRuntime = createProviderRuntime({
  logger,
  guard: async provider => {
    if (AI_PROVIDER_NAMES.has(provider) && usageOverBudget()) {
      throw new ProviderRuntimeError(`Monthly AI budget of $${usageMeter.budgetUSD} has been reached.`, {
        code: 'PROVIDER_BUDGET_EXCEEDED', provider, retryable: false,
      });
    }
  },
  policies: {
    gemini: { concurrency: 2, maxCallsPerWindow: 50, timeoutMs: 60000 },
    openai: { concurrency: 2, maxCallsPerWindow: 30, timeoutMs: 45000 },
    perplexity: { concurrency: 2, maxCallsPerWindow: 30, timeoutMs: 45000 },
    gohighlevel: { concurrency: 3, maxCallsPerWindow: 60, timeoutMs: 30000 },
    'search-console': { concurrency: 3, maxCallsPerWindow: 60, timeoutMs: 30000 },
    'google-indexing': { concurrency: 2, maxCallsPerWindow: 30, timeoutMs: 30000 },
    trustpilot: { concurrency: 2, maxCallsPerWindow: 60, timeoutMs: 20000 },
    website: { concurrency: 2, maxCallsPerWindow: 30, timeoutMs: 30000 },
  },
});
let isShuttingDown = false;
const PUBLIC_DIR = path.join(__dirname, 'public');
const BROWSER_ASSETS = buildBrowserAssets(PUBLIC_DIR, [
  { token: 'STYLE_ASSET', file: 'style.css' },
  { token: 'THEME_ASSET', file: 'modules/theme.js' },
  { token: 'CORE_ASSET', file: 'modules/core.js' },
  { token: 'APP_ASSET', file: 'app.js' },
  { token: 'ASSISTANT_ASSET', file: 'modules/assistant.js' },
  { token: 'REVIEWS_ASSET', file: 'modules/reviews.js' },
  { token: 'RECORDED_CONTENT_ASSET', file: 'modules/recorded-content.js' },
  { token: 'PDF_REPORT_ASSET', file: 'modules/pdf-report.js' },
  { token: 'CITATION_ASSET', file: 'modules/citations.js' },
  { token: 'LOCAL_PRESENCE_ASSET', file: 'modules/local-presence.js' },
  { token: 'PERFORMANCE_ASSET', file: 'modules/performance.js' },
  { token: 'SITE_OPTIMIZATION_ASSET', file: 'modules/site-optimization.js' },
  { token: 'AI_VISIBILITY_ASSET', file: 'modules/ai-visibility.js' },
  { token: 'BRAND_PROFILE_ASSET', file: 'modules/brand-profile.js' },
  { token: 'OWNER_VIEWS_ASSET', file: 'modules/owner-views.js' },
  { token: 'SEARCH_OPPORTUNITIES_ASSET', file: 'modules/search-opportunities.js' },
  { token: 'SETTINGS_ASSET', file: 'modules/settings.js' },
  { token: 'CONTENT_WORKSPACE_ASSET', file: 'modules/content-workspace.js' },
  { token: 'WORKSPACE_ASSET', file: 'modules/workspace.js' },
]);
const INDEX_HTML = renderAssetIndex(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'), BROWSER_ASSETS);

function integrationErrorStatus(error) {
  return error && Number.isInteger(error.statusCode) ? error.statusCode : 500;
}

// ----------------------------------------------------
// Core Configuration
// ----------------------------------------------------
// Gemini model is now env-configurable. Default to the current stable Flash
// model. NOTE: the previous hardcoded 'gemini-3.5-flash' is not a valid model
// ID, so every live generation silently failed and fell back to mock output.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

async function geminiGenerate(request, options = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw integrationUnavailable('gemini', 'Gemini is not configured. Add GEMINI_API_KEY before running AI features.');
  }
  const response = await providerRuntime.run('gemini', async () => {
    if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return ai.models.generateContent(request);
  }, { policy: { retries: 0, timeoutMs: options.timeoutMs || 60000 } });
  const grounded = Array.isArray(request?.config?.tools) && request.config.tools.some(tool => tool && tool.googleSearch);
  meterUsage(options.usageKind || (grounded ? 'grounded' : 'gemini'));
  return response;
}

const googleApi = createGoogleApiClient({
  providerRuntime,
  env: process.env,
  baseDir: __dirname,
  logger: console,
  secretStorageMode: SECRET_STORAGE_MODE,
});
const {
  getGoogleAuth,
  createWebmasters,
  createIndexingClient,
  searchConsoleQuery,
  publishIndexNotification,
  parseServiceAccountJson,
  credentialShape,
} = googleApi;

// State is isolated by tenant below the durable storage root. On first boot the
// repository copies legacy root-level files into the tenant boundary, verifies
// checksums, and leaves the originals untouched for rollback.
const stateRepository = createFileStateRepository({
  storageRoot: CONFIG_DIR,
  tenantId: process.env.TENANT_ID || 'best-day-fitness',
});
const DATA_DIR = stateRepository.directory;
let savedProviderHealth = null;
try { savedProviderHealth = stateRepository.readJson('integration-health.json', null); }
catch (error) { logger.warn('provider.health_state_unreadable', { error }); }
providerRuntime.hydrate(savedProviderHealth);
providerRuntime.setStateObserver(snapshot => stateRepository.writeJson('integration-health.json', snapshot));
let savedCredentialMetadata = null;
try { savedCredentialMetadata = stateRepository.readJson('credential-metadata.json', null); }
catch (error) { logger.warn('credential.metadata_unreadable', { error }); }
const credentialMetadata = createCredentialMetadata({
  initialState: savedCredentialMetadata,
  save: state => stateRepository.writeJson('credential-metadata.json', state),
});
// Without DATA_DIR the files sit on the container filesystem, which the host
// replaces on every deploy. Anything the owner confirms through the UI is then
// true until the next deploy and false afterwards, so endpoints that record an
// owner decision say which of the two they just did.
const STORAGE_IS_PERSISTENT = !!process.env.DATA_DIR;
const backupService = createBackupService({ repository: stateRepository, backupRoot: path.join(CONFIG_DIR, 'backups') });
const durableJobQueue = createSwitchableJobQueue(
  createDurableJobQueue({ filePath: stateRepository.pathFor('jobs.json') }),
  'filesystem',
);
const jobHandlers = new Map();
const JOB_WORKER_ID = `${process.env.RAILWAY_REPLICA_ID || 'local'}:${process.pid}`;
const jobWorker = createJobWorker({
  queue: durableJobQueue,
  handlers: jobHandlers,
  logger,
  workerId: JOB_WORKER_ID,
  isShuttingDown: () => isShuttingDown,
  reportHeartbeat: async () => {
    if (postgresMirror && PROCESS_ROLE.worksJobs) {
      await postgresMirror.touchWorker(stateRepository.tenantId, JOB_WORKER_ID, PROCESS_ROLE.name);
      postgresStatus.activeWorkers = await postgresMirror.activeWorkers(stateRepository.tenantId);
    }
  },
});

const jobDispatcher = createJobDispatcher({ queue: durableJobQueue, worker: jobWorker, logger });
const { key: durableJobKey, enqueue: enqueueDurableJob } = jobDispatcher;
let postgresMirror = null;
let postgresStateBridge = null;
const postgresStatus = {
  configured: Boolean(process.env.DATABASE_URL),
  mode: STATE_BACKEND_MODE,
  ready: false,
  lastSyncAt: null,
  syncedFiles: 0,
  pendingWrites: 0,
  activeWorkers: [],
  error: null,
};

async function syncPostgresMirror() {
  if (!postgresMirror) return;
  try {
    await postgresStateBridge?.flush();
    postgresStatus.syncedFiles = (await postgresMirror.listStates(stateRepository.tenantId)).length;
    postgresStatus.lastSyncAt = new Date().toISOString();
    postgresStatus.pendingWrites = postgresStateBridge?.status().pendingWrites || 0;
    postgresStatus.activeWorkers = await postgresMirror.activeWorkers(stateRepository.tenantId);
    postgresStatus.ready = true;
    postgresStatus.error = null;
  } catch (error) {
    postgresStatus.ready = false;
    postgresStatus.error = error.code || error.message;
    logger.error('storage.postgres_sync_failed', { tenantId: stateRepository.tenantId, error });
  }
}

async function initializePostgresMirror() {
  if (!process.env.DATABASE_URL) return;
  postgresMirror = createPostgresStore({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL !== 'disable' });
  const migrations = await postgresMirror.migrate(path.join(__dirname, 'migrations'));
  if (STATE_BACKEND_MODE === 'postgres') {
    durableJobQueue.setBackend(createPostgresJobQueue({ pool: postgresMirror.pool, tenantId: stateRepository.tenantId }), 'postgres');
  }
  postgresStateBridge = createPostgresStateBridge({ repository: stateRepository, store: postgresMirror, logger });
  setJsonWriteObserver(postgresStateBridge.capture);
  // `npm start` runs prepare-state first. PostgreSQL is hydrated to the local
  // read cache before this process loads feature services, so runtime sync only
  // drains new writes; it must never overwrite canonical rows from a stale replica.
  await syncPostgresMirror();
  await postgresStateBridge.flush();
  postgresStatus.pendingWrites = postgresStateBridge.status().pendingWrites;
  logger.info('storage.postgres_ready', { tenantId: stateRepository.tenantId, migrations, syncedFiles: postgresStatus.syncedFiles });
  const timer = setInterval(syncPostgresMirror, 5 * 60 * 1000);
  timer.unref?.();
}

// Optional admin password. When set, it locks down the sensitive endpoints
// (settings, publishing, indexing, autopilot, and any Gemini-spend routes).
// Leave unset only for trusted local development.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD || '';
const accessControl = createAccessControl({ ownerToken: ADMIN_PASSWORD, operatorToken: OPERATOR_PASSWORD });
const requireAuth = accessControl.requireRole('operator');
const requireOwner = accessControl.requireRole('owner');
const auditLog = createAuditLog({
  filePath: stateRepository.pathFor('audit-log.jsonl'),
  signingKey: process.env.AUDIT_SIGNING_KEY || '',
});

// ===========================================================================
// BRAND PROFILE  —  the single source of truth for every AI feature
// ---------------------------------------------------------------------------
// Before this existed, eight separate one-sentence brand blurbs were hand-copied
// through this file. They drifted, none of them carried the real voice guidance,
// and changing the brand meant editing eight strings and redeploying.
//
// Seeded from the owner's own brand docs (brand-context.md and the Brand Voice
// guide). Editable in Settings, persisted to DATA_DIR, and rendered into every
// prompt by brandPrompt(). Change it once, every feature follows.
//
// NOTE ON THE PHONE: brand-context.md and the site homepage both carry
// (727) 677-9770, but the owner confirmed (727) 334-1472 is canonical. The
// seed below uses the canonical number deliberately — do not "correct" it back.
// ===========================================================================

const BRAND_FILE = path.join(DATA_DIR, 'brand-profile.json');
const brandProfileService = createBrandProfileService({ filePath: BRAND_FILE, saveJsonFileSync });
const BRAND_DEFAULT = brandProfileService.defaults;
const brandState = brandProfileService.state;
const saveBrand = brandProfileService.save;
const brandPrompt = brandProfileService.prompt;
const brandViolations = brandProfileService.violations;



// ----------------------------------------------------
// Editable, LOCATION-STAMPED business profile (franchise seed).
// A saved profile overrides the hardcoded defaults above, so business
// identity is configurable per location instead of baked into code.
// Loading merges saved identity INTO the BUSINESS object, so every existing
// BUSINESS.xxx reference automatically uses the saved values — no refactor.
// ----------------------------------------------------
const BUSINESS_PROFILE_FILE = path.join(DATA_DIR, 'business-profile.json');
const businessProfileService = createBusinessProfileService({
  filePath: BUSINESS_PROFILE_FILE,
  writeJsonFileSync,
  logger: console,
});
const BUSINESS = businessProfileService.business;
const businessProfile = businessProfileService.profile;
const saveBusinessProfileFromBody = businessProfileService.save;
const buildLocalBusinessSchema = businessProfileService.buildLocalBusinessSchema;
const phoneDisplay = businessProfileService.phoneDisplay;

// CORS: default to same-origin only (the dashboard is served from this same
// server, so no cross-origin headers are needed). Set ALLOWED_ORIGIN to a
// comma-separated allowlist only if you must call the API from another origin.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
if (ALLOWED_ORIGIN) {
  app.use(cors({ origin: ALLOWED_ORIGIN.split(',').map(s => s.trim()) }));
}

// Baseline browser hardening without adding another runtime dependency. API
// responses may contain business history and configuration state, so prevent
// intermediary/browser caches from retaining them.
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "script-src-attr 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (APP_MODE === 'production') contentSecurityPolicy.push('upgrade-insecure-requests');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy.join('; '));
  if (req.path.startsWith('/api/') || req.path.startsWith('/health/')) res.setHeader('Cache-Control', 'no-store');
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Give every request a stable correlation ID and retain bounded, low-cardinality
// process metrics. No URLs, query strings, credentials, or request bodies are
// retained in the metrics snapshot.
app.use((req, res, next) => {
  const incomingId = String(req.get('x-request-id') || '');
  const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(incomingId) ? incomingId : crypto.randomUUID();
  const startedAt = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  requestMetrics.started(req.method);
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    requestMetrics.finished(res.statusCode, durationMs);
    if (!req.path.startsWith('/health/') || res.statusCode >= 400) {
      logger.info('http.request', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    }
  });
  next();
});

// Compress HTML, JavaScript, CSS, and JSON over the wire. The dashboard ships
// sizeable hand-authored assets, so this removes most transfer bytes without a
// build step or extra copies in memory.
app.use(compression({ threshold: 1024 }));

function storageReadiness() {
  try {
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    const databaseRequired = STATE_BACKEND_MODE === 'postgres';
    const databaseReady = !databaseRequired || postgresStatus.ready;
    return {
      ok: databaseReady,
      persistent: databaseRequired ? postgresStatus.ready : STORAGE_IS_PERSISTENT,
      backend: STATE_BACKEND_MODE,
      ...(databaseReady ? {} : { error: postgresStatus.error || 'POSTGRES_NOT_READY' }),
    };
  } catch (error) {
    return { ok: false, persistent: false, backend: STATE_BACKEND_MODE, error: error.code || 'STORAGE_UNAVAILABLE' };
  }
}

// Kubernetes-, Railway-, and load-balancer-friendly lifecycle probes. Liveness
// is deliberately cheap; readiness verifies only conditions required to serve
// safely and does not take the app offline for an optional provider outage.
app.get('/health/live', (req, res) => {
  res.status(isShuttingDown ? 503 : 200).json({
    status: isShuttingDown ? 'shutting_down' : 'live',
    uptimeSeconds: Math.floor(process.uptime()),
    bootedAt: BOOTED_AT,
  });
});

app.get('/health/ready', (req, res) => {
  const storage = storageReadiness();
  const checks = {
    acceptingTraffic: !isShuttingDown,
    storage,
    runtime: { ok: true, mode: APP_MODE, mockIntegrationsAllowed: ALLOW_MOCK_INTEGRATIONS },
  };
  const ready = checks.acceptingTraffic && storage.ok;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});

// A dedicated worker deployment exposes probes to the platform but does not
// expose the application or API surface. It only claims PostgreSQL jobs.
app.use((req, res, next) => {
  if (PROCESS_ROLE.servesWeb || req.path.startsWith('/health/')) return next();
  return res.status(404).json({ success: false, error: 'This process serves background work only.' });
});

// Recording uploads need far more than the default 100kb. Mounted path-first so
// every other endpoint keeps the small limit.
// Mounted path-first so the global limit below still protects every other route.
app.use('/api/transcribe', bodyParser.json({ limit: '34mb' }));
app.use(bodyParser.json());

// Record every state-changing API request after the response finishes. Audit
// entries deliberately exclude query strings, headers, and bodies so secrets
// and generated content never enter the log.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  res.once('finish', () => {
    try {
      auditLog.record({
        requestId: req.requestId,
        actorId: req.auth?.actorId,
        role: req.auth?.role,
        action: `${req.method} ${req.path}`,
        statusCode: res.statusCode,
      });
    } catch (error) {
      logger.error('audit.write_failed', { requestId: req.requestId, error });
    }
  });
  next();
});

// The HTML is rendered with content-hashed asset URLs at process start. A new
// deployment therefore gets new URLs while unchanged assets remain safely
// cacheable for a year; browsers can no longer mix old JS with new server code.
for (const asset of BROWSER_ASSETS) {
  app.get(asset.url, (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(asset.filePath);
  });
}
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(INDEX_HTML);
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    // HTML must revalidate so a deployment can point at the newest un-hashed
    // assets. Other static files can be reused briefly and revalidated in the
    // background, cutting repeat-visit bandwidth without long-lived staleness.
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    }
  },
}));

// Profile routes live below the body parser on purpose — registered above it,
// req.body is undefined and every save fails with a confusing 400.
registerProfileRoutes(app, {
  requireOwner,
  brandDefaults: BRAND_DEFAULT,
  brandState,
  saveBrand,
  storageReadiness,
  businessProfile,
  saveBusinessProfile: saveBusinessProfileFromBody,
});

// ----------------------------------------------------
// Auth middleware — protects sensitive/credential/spend endpoints.
// If ADMIN_PASSWORD is not set, endpoints stay open (local dev) but the server
// logs a loud startup warning. Provide the password from the client as either
// an "Authorization: Bearer <password>" header or an "x-admin-token" header.
// ----------------------------------------------------
// Initialize Gemini Client if Key is present
let ai = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log('[Gemini SDK] Autopilot ready. Initialized successfully.');
  } catch (error) {
    console.error('[Gemini SDK] Initialization failed:', error.message);
  }
} else {
  console.log(ALLOW_MOCK_INTEGRATIONS
    ? '[Gemini SDK] No GEMINI_API_KEY found. Demo generation is available outside production.'
    : '[Gemini SDK] No GEMINI_API_KEY found. Live generation is unavailable; production will not fabricate output.');
}

providerRuntime.setConfigured('gemini', () => Boolean(process.env.GEMINI_API_KEY));
providerRuntime.setConfigured('openai', () => Boolean(process.env.OPENAI_API_KEY));
providerRuntime.setConfigured('perplexity', () => Boolean(process.env.PERPLEXITY_API_KEY));
providerRuntime.setConfigured('gohighlevel', () => Boolean(process.env.GHL_ACCESS_TOKEN && process.env.GHL_LOCATION_ID));
providerRuntime.setConfigured('search-console', () => Boolean(process.env.GSC_SITE_URL && getGoogleAuth()));
providerRuntime.setConfigured('google-indexing', () => Boolean(getGoogleAuth()));
providerRuntime.setConfigured('gmail', () => Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN));
providerRuntime.setConfigured('google-business-profile', () => Boolean(process.env.GBP_REFRESH_TOKEN && process.env.GBP_ACCOUNT_ID && process.env.GBP_LOCATION_ID));
providerRuntime.setConfigured('reviews-site', true);
providerRuntime.setConfigured('web-audit', true);
providerRuntime.setConfigured('trustpilot', () => Boolean(process.env.TRUSTPILOT_API_KEY && process.env.TRUSTPILOT_DOMAIN));

function currentBudgetStatus() {
  return {
    limitUSD: usageMeter.budgetUSD,
    usedUSD: currentUsage().estCostUSD,
    reached: usageOverBudget(),
  };
}

function isWorkerAvailable() {
  return jobWorker.status().running || postgresStatus.activeWorkers.length > 0;
}

async function currentOperationalHealth({ budget = currentBudgetStatus(), providerSnapshot = providerRuntime.snapshot() } = {}) {
  const queue = await durableJobQueue.snapshot(100);
  return buildOperationalHealth({
    budget,
    providerSnapshot,
    storage: storageReadiness(),
    workerRunning: isWorkerAvailable(),
    backups: backupService.list(),
    automation: buildAutomationStatus(getAutomationFeatures(), queue, isWorkerAvailable()),
    monthlyReport: monthlyReportService?.status() || null,
    credentialMetadata: credentialMetadata.snapshot(),
  });
}

registerOperationsRoutes(app, {
  requireAuth,
  requireOwner,
  getRuntime: () => ({
    mode: APP_MODE,
    mockIntegrationsAllowed: ALLOW_MOCK_INTEGRATIONS,
    nodeVersion: process.version,
    bootedAt: BOOTED_AT,
    uptimeSeconds: Math.floor(process.uptime()),
    shuttingDown: isShuttingDown,
    processRole: PROCESS_ROLE.name,
  }),
  storageReadiness,
  requestMetrics,
  accessControl,
  auditLog,
  stateRepository,
  getPostgresStatus: () => postgresStatus,
  providerRuntime,
  getBudget: currentBudgetStatus,
  backupService,
  durableJobQueue,
  isJobWorkerRunning: isWorkerAvailable,
  getOperationalHealth: currentOperationalHealth,
});

// ----------------------------------------------------
// Persistent JSON Database Configuration
// ----------------------------------------------------
const LOGS_FILE = path.join(DATA_DIR, 'autopilot-logs.json');

const historyRepository = createPublicationHistoryRepository(stateRepository);
const historyDb = historyRepository.load();
let autopilotLogs = [];

// Initialize autopilot logs database
if (fs.existsSync(LOGS_FILE)) {
  try {
    autopilotLogs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
  } catch (e) {
    autopilotLogs = [];
  }
} else {
  autopilotLogs = [
    {
      timestamp: new Date().toISOString(),
      message: 'Autopilot Agent initialized. Standing by.'
    }
  ];
  writeJsonFileSync(LOGS_FILE, autopilotLogs);
}

// Initialize AIO audits database
const AIO_AUDITS_FILE = path.join(DATA_DIR, 'aio-audits.json');
let aioAuditsDb = [];

if (fs.existsSync(AIO_AUDITS_FILE)) {
  try {
    aioAuditsDb = JSON.parse(fs.readFileSync(AIO_AUDITS_FILE, 'utf8'));
  } catch (e) {
    aioAuditsDb = [];
  }
} else {
  // Start with an empty, honest history — real audits populate this on demand.
  aioAuditsDb = [];
  writeJsonFileSync(AIO_AUDITS_FILE, aioAuditsDb);
}

// ============================================================
// Multi-engine AI Visibility store (Phase 1). Tracks brand visibility
// across several answer engines over time, plus a competitor leaderboard.
// Shape: { prompts:[str], snapshots:[snapshot], updatedAt }
//   snapshot = { date, engines:[str], visibilityScore, shareOfVoice,
//     sentimentScore, brandMentions, totalAnswers, perEngine:[{engine,score}],
//     leaderboard:[{name,isBrand,mentions,score}], answers:[{engine,prompt,recommended,sentiment,competitors,snippet}] }
const AI_VIS_FILE = path.join(DATA_DIR, 'ai-visibility.json');
let aiVisDb = { prompts: DEFAULT_VIS_PROMPTS.slice(), snapshots: [], updatedAt: null, autoEnabled: true, intervalDays: 7, lastRun: null };
if (fs.existsSync(AI_VIS_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(AI_VIS_FILE, 'utf8'));
    if (loaded && typeof loaded === 'object') {
      aiVisDb = {
        prompts: Array.isArray(loaded.prompts) && loaded.prompts.length ? loaded.prompts : DEFAULT_VIS_PROMPTS.slice(),
        snapshots: Array.isArray(loaded.snapshots) ? loaded.snapshots : [],
        updatedAt: loaded.updatedAt || null,
        autoEnabled: !!loaded.autoEnabled,
        intervalDays: loaded.intervalDays || 7,
        lastRun: loaded.lastRun || null
      };
    }
  } catch (e) { /* keep defaults */ }
} else {
  try { writeJsonFileSync(AI_VIS_FILE, aiVisDb); } catch (e) {}
}
function saveAiVis() {
  saveJsonFileSync(AI_VIS_FILE, aiVisDb, 'AI Visibility');
}

// Helper to log Autopilot activity
function logAutopilotActivity(message) {
  const timestamp = new Date().toISOString();
  autopilotLogs.unshift({ timestamp, message });
  if (autopilotLogs.length > 100) autopilotLogs.pop(); // Cap at 100 logs
  saveJsonFileSync(LOGS_FILE, autopilotLogs, 'Logs File');
  console.log(`[Autopilot Agent] ${message}`);
}

// Helper to save history
function saveHistory() {
  historyRepository.save(historyDb);
}

// ----------------------------------------------------
// Mock Data for GSC (Best Day Fitness Search Console leaks)
// ----------------------------------------------------
const MOCK_GSC_DATA = [
  { query: 'senior fitness st petersburg fl', impressions: 1450, clicks: 0, ctr: 0, position: 11.2, leak: true },
  { query: 'mobility training st pete', impressions: 980, clicks: 0, ctr: 0, position: 14.5, leak: true },
  { query: 'longevity fitness coach st petersburg', impressions: 850, clicks: 0, ctr: 0, position: 12.1, leak: true },
  { query: 'posture correction exercises senior', impressions: 720, clicks: 0, ctr: 0, position: 15.3, leak: true },
  { query: 'barefoot training older adults balance', impressions: 540, clicks: 0, ctr: 0, position: 18.0, leak: true },
  { query: 'best day fitness', impressions: 620, clicks: 480, ctr: 77.4, position: 1.1, leak: false },
  { query: 'senior workout facility near me', impressions: 480, clicks: 0, ctr: 0, position: 19.4, leak: true },
  { query: 'injury recovery gym st petersburg fl', impressions: 420, clicks: 0, ctr: 0, position: 13.8, leak: true },
  { query: 'best day fitness st petersburg', impressions: 350, clicks: 270, ctr: 77.1, position: 1.2, leak: false },
  { query: 'st petersburg senior personal trainer', impressions: 310, clicks: 0, ctr: 0, position: 11.9, leak: true },
  { query: 'co-op gym for wellness professionals st pete', impressions: 290, clicks: 0, ctr: 0, position: 16.5, leak: true }
];

// Article generation owns prompt construction, provider output normalization,
// claim extraction, safety checks, quality scoring, and the explicit mock boundary.
const articleGenerationService = createArticleGenerationService({
  brandPrompt,
  brandViolations,
  assessArticleQuality,
  sanitizeArticleHtml,
  escapeHtml,
  safeHttpUrl,
  geminiGenerate,
  model: GEMINI_MODEL,
  isGeminiReady: () => !!ai,
  allowMockIntegrations: ALLOW_MOCK_INTEGRATIONS,
  integrationUnavailable,
  logger: console,
});
const generateArticleHelper = articleGenerationService.generate;
// Publishing enrichment and the GoHighLevel provider request share one service;
// HTTP validation and publication-history mutation remain in content routes.
const articlePublishingService = createArticlePublishingService({
  getHistory: () => historyDb,
  sanitizeArticleHtml,
  safeHttpUrl,
  escapeHtml,
  buildLocalBusinessSchema,
  getBusinessName: () => BUSINESS.name,
  providerRuntime,
  env: process.env,
  allowMockIntegrations: ALLOW_MOCK_INTEGRATIONS,
  integrationUnavailable,
});
const publishGhlHelper = articlePublishingService.publish;
// Google Indexing submission, owner-facing permission guidance, legacy URL
// migration, and boot-time re-index recovery share one article lifecycle boundary.
const articleIndexingService = createArticleIndexingService({
  getGoogleAuth,
  createIndexingClient,
  publishIndexNotification,
  getSearchConsoleProperty: () => process.env.GSC_SITE_URL,
  getBlogPathPrefix: () => process.env.GHL_BLOG_PATH_PREFIX,
  getHistory: () => historyDb,
  saveHistory,
  allowMockIntegrations: ALLOW_MOCK_INTEGRATIONS,
  integrationUnavailable,
  logger: console,
});
const indexUrlHelper = articleIndexingService.submit;
const explainIndexError = articleIndexingService.explainError;
articleIndexingService.migrateStalePostUrls();

// ----------------------------------------------------
// Autopilot Agent Logic
// ----------------------------------------------------
let contentScheduler = null;
let autopilotEnabled = true;   // default ON so fresh franchise installs publish content hands-off
let autopilotIntervalHours = 24;
let nextRunTime = null;
let lastAutopilotRun = null;   // ISO timestamp of the last successful content cycle (for redeploy catch-up)
let autopilotQueue = []; // [{ topic, addedAt }] — covered before GSC gaps
// Proactive Target Keywords: core money terms the autopilot pursues on rotation
// EVEN WHEN they generate no GSC impressions yet. The leak strategy only
// reinforces terms you already rank for; targets let you deliberately break into
// the searches you want to win. Seeded per-location (franchise-general).
let autopilotTargets = []; // [string]
let autopilotTargetIndex = 0; // rotation cursor

// Durable autopilot config (cadence + enabled + topic queue) so the schedule
// and queue survive redeploys. The scheduler itself is restored at startup.
const AUTOPILOT_CONFIG_FILE = path.join(DATA_DIR, 'autopilot-config.json');
function saveAutopilotConfig() {
  return saveJsonFileSync(AUTOPILOT_CONFIG_FILE, { enabled: autopilotEnabled, intervalHours: autopilotIntervalHours, nextRunTime, queue: autopilotQueue, targets: autopilotTargets, targetIndex: autopilotTargetIndex, lastRun: lastAutopilotRun }, 'Autopilot Config');
}
// Build sensible default target terms from the business location + niche so a
// fresh franchise install pursues its own "[service] [city]" money terms.
function defaultAutopilotTargets() {
  const city = (BUSINESS.addressLocality || '').trim();
  if (!city) return [];
  return [
    `senior fitness ${city}`,
    `fitness for adults over 50 ${city}`,
    `balance and mobility training for seniors ${city}`,
    `personal trainer for seniors ${city}`,
    `best gym for seniors ${city}`
  ];
}
try {
  if (fs.existsSync(AUTOPILOT_CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(AUTOPILOT_CONFIG_FILE, 'utf8'));
    if (typeof cfg.enabled === 'boolean') autopilotEnabled = cfg.enabled;
    if (cfg.intervalHours) autopilotIntervalHours = parseFloat(cfg.intervalHours);
    if (Array.isArray(cfg.queue)) autopilotQueue = cfg.queue;
    if (Array.isArray(cfg.targets)) autopilotTargets = cfg.targets.filter(t => typeof t === 'string' && t.trim());
    if (Number.isInteger(cfg.targetIndex)) autopilotTargetIndex = cfg.targetIndex;
    if (cfg.lastRun) lastAutopilotRun = cfg.lastRun;
    if (Number.isFinite(Date.parse(cfg.nextRunTime))) nextRunTime = cfg.nextRunTime;
  }
} catch (e) { console.error('[Autopilot Config] load failed:', e.message); }
// Seed defaults on first run (empty targets) so the autopilot proactively
// pursues the location's core terms without waiting for manual setup.
if (!autopilotTargets.length) {
  autopilotTargets = defaultAutopilotTargets();
  if (autopilotTargets.length) { try { saveAutopilotConfig(); } catch (e) {} }
}

const contentAutopilotState = {
  get queue() { return autopilotQueue; },
  set queue(value) { autopilotQueue = value; },
  get targets() { return autopilotTargets; },
  get targetIndex() { return autopilotTargetIndex; },
  set targetIndex(value) { autopilotTargetIndex = value; },
  get lastRun() { return lastAutopilotRun; },
  set lastRun(value) { lastAutopilotRun = value; },
};
const contentAutopilotService = createContentAutopilotService({
  state: contentAutopilotState,
  getHistory: () => historyDb,
  saveHistory,
  saveConfig: saveAutopilotConfig,
  logActivity: logAutopilotActivity,
  getGoogleAuth,
  getSiteUrl: () => process.env.GSC_SITE_URL,
  createWebmasters,
  searchConsoleQuery,
  generateArticle: generateArticleHelper,
  publishArticle: publishGhlHelper,
  indexUrl: indexUrlHelper,
  explainIndexError,
  mockData: MOCK_GSC_DATA,
  allowMockIntegrations: ALLOW_MOCK_INTEGRATIONS,
});
const runAutopilotCycle = contentAutopilotService.runCycle;

function startAutopilotScheduler(options) {
  if (!contentScheduler) contentScheduler = createContentScheduler({
    state: {
      get enabled() { return autopilotEnabled; },
      get intervalHours() { return autopilotIntervalHours; },
      get lastRun() { return lastAutopilotRun; },
      get nextRunTime() { return nextRunTime; },
      set nextRunTime(value) { nextRunTime = value; },
    },
    save: saveAutopilotConfig, enqueue: enqueueDurableJob,
  });
  contentScheduler.start(options);
  logAutopilotActivity(autopilotEnabled ? `Content schedule restored. Next check: ${nextRunTime}.` : 'Background Autopilot scheduler stopped.');
}

// ----------------------------------------------------
// Routes
// ----------------------------------------------------

registerConfigurationRoutes(app, {
  requireOwner,
  configDir: CONFIG_DIR,
  environment: process.env,
  parseServiceAccountJson,
  reloadEnvironment: settingsPath => dotenv.config({ path: settingsPath, override: true }),
  reinitializeGemini: apiKey => {
    try {
      ai = new GoogleGenAI({ apiKey });
      console.log('[Gemini SDK] Re-initialized successfully.');
    } catch (error) {
      console.error('[Gemini SDK] Re-initialization failed:', error.message);
    }
  },
  clearCaches: () => {
    getGscDashboardData.clear();
    computePerformance.clear();
    providerRuntime.clearCache();
  },
  onCredentialsChanged: providers => {
    for (const provider of providers) {
      providerRuntime.reset(provider);
      if (provider === 'search-console') providerRuntime.reset('google-indexing');
    }
    try { credentialMetadata.record(providers); }
    catch (error) { logger.warn('credential.metadata_persist_failed', { providers, error }); }
  },
  getStorageStatus: () => {
    const storage = storageReadiness();
    return {
      persistent: storage.persistent,
      backend: STATE_BACKEND_MODE,
      tenantId: stateRepository.tenantId,
      postgresMirror: { ...postgresStatus },
    };
  },
  logger: console,
});

// Search Console stays behind one service boundary so query construction,
// caching, diagnostics, and live-vs-mock behavior cannot drift across routes.
const gscService = registerGscRoutes(app, {
  requireAuth,
  getGoogleAuth,
  getSiteUrl: () => process.env.GSC_SITE_URL,
  getRawCredentials: () => process.env.GOOGLE_APPLICATION_CREDENTIALS,
  createWebmasters,
  searchConsoleQuery,
  parseServiceAccountJson,
  credentialShape,
  integrationUnavailable,
  allowMockIntegrations: ALLOW_MOCK_INTEGRATIONS,
  mockData: MOCK_GSC_DATA,
  baseDir: __dirname,
  logger: console,
});
const getGscDashboardData = gscService.getDashboardData;

// Manual article delivery shares one boundary for validation, quality,
// history persistence, and Search Console property containment.
registerContentRoutes(app, {
  requireAuth,
  state: { get history() { return historyDb; } },
  generateArticle: generateArticleHelper,
  publishGhl: publishGhlHelper,
  indexUrl: indexUrlHelper,
  safeHttpUrl,
  sanitizeArticleHtml,
  assessArticleQuality,
  brandViolations,
  usageOverBudget,
  budgetBlock,
  integrationErrorStatus,
  explainIndexError,
  saveHistory,
  getSearchConsoleProperty: () => process.env.GSC_SITE_URL,
});

// Autopilot HTTP contracts use an adapter over the existing scheduler state.
// This keeps behavior stable now and creates a seam for transactional state later.
const autopilotRouteState = {
  get enabled() { return autopilotEnabled; },
  set enabled(value) { autopilotEnabled = value; },
  get intervalHours() { return autopilotIntervalHours; },
  set intervalHours(value) { autopilotIntervalHours = value; },
  get nextRunTime() { return nextRunTime; },
  get queue() { return autopilotQueue; },
  get targets() { return autopilotTargets; },
  get targetIndex() { return autopilotTargetIndex; },
  set targetIndex(value) { autopilotTargetIndex = value; },
  get logs() { return autopilotLogs; },
};
registerAutopilotRoutes(app, {
  requireAuth,
  state: autopilotRouteState,
  startScheduler: startAutopilotScheduler,
  saveConfig: saveAutopilotConfig,
  runCycle: runAutopilotCycle,
  explainIndexError,
});

const aioCoreRouteState = {
  get history() { return aioAuditsDb; },
  set history(value) { aioAuditsDb = value; },
};
registerAioCoreRoutes(app, {
  requireAuth,
  hasGeminiKey: () => !!process.env.GEMINI_API_KEY,
  usageOverBudget,
  budgetBlock,
  business: BUSINESS,
  brandDomainRoot: 'bestdayfitness',
  geminiGenerate,
  model: GEMINI_MODEL,
  state: aioCoreRouteState,
  persistHistory: history => writeJsonFileSync(AIO_AUDITS_FILE, history),
  getSiteUrl: () => process.env.GSC_SITE_URL,
  buildLocalBusinessSchema,
  logger: console,
});

// ============================================================
// MULTI-ENGINE AI VISIBILITY (Phase 1)
// Runs the same brand-recommendation prompts across several answer engines,
// scores Visibility / Share of Voice / Sentiment, builds a competitor
// leaderboard, and snapshots it over time. Google works with the existing
// Gemini key; ChatGPT + Perplexity light up when their keys are added.
// ============================================================
const AI_ENGINES = DEFAULT_AI_ENGINES;
const visBrandName = () => BUSINESS.name;
const aiVisibilityService = createAiVisibilityService({
  state: aiVisDb,
  save: saveAiVis,
  geminiGenerate,
  geminiModel: GEMINI_MODEL,
  providerRuntime,
  parseJson: parseGeminiJson,
  brandName: visBrandName,
  meterUsage,
  env: process.env,
  daysSince,
  logger: console,
});
const {
  askEngine,
  engineConfigured,
  enginesStatus,
  runVisibility: runAiVisibility,
  trend: visTrend,
} = aiVisibilityService;

// AI Visibility HTTP contracts use a state adapter so provider orchestration
// and persistence remain independently replaceable.
const aiVisibilityRouteState = {
  get prompts() { return aiVisDb.prompts; },
  set prompts(value) { aiVisDb.prompts = value; },
  get snapshots() { return aiVisDb.snapshots; },
  get updatedAt() { return aiVisDb.updatedAt; },
  get autoEnabled() { return aiVisDb.autoEnabled; },
  set autoEnabled(value) { aiVisDb.autoEnabled = value; },
  get intervalDays() { return aiVisDb.intervalDays; },
  get lastRun() { return aiVisDb.lastRun; },
  get running() { return aiVisibilityService.running; },
};
registerAiVisibilityRoutes(app, {
  requireAuth,
  state: aiVisibilityRouteState,
  nudgeSchedule: () => enqueueDurableJob('ai.visibility', {}, {
    idempotencyKey: durableJobKey('ai.visibility', 12 * 60 * 60 * 1000),
    maxAttempts: 5,
  }),
  brandName: visBrandName,
  enginesStatus,
  trend: visTrend,
  anyConfigured: () => AI_ENGINES.some(engine => engineConfigured(engine.id)),
  runVisibility: runAiVisibility,
  usageOverBudget,
  budgetBlock,
  save: saveAiVis,
  defaultPrompts: DEFAULT_VIS_PROMPTS,
  logger: console,
});

// Staggered startup catch-up + 12h heartbeat so the trend fills on schedule.

// ============================================================
// P4a — FACTCHECK / BRAND-ACCURACY MONITOR
// Asks each engine what it "knows" about the business, then compares against
// the canonical business identity and flags inaccurate/outdated claims.
// ============================================================
const FACTCHECK_FILE = path.join(DATA_DIR, 'ai-factcheck.json');
let factCheckDb = { latest: null, updatedAt: null };
if (fs.existsSync(FACTCHECK_FILE)) {
  try { const l = JSON.parse(fs.readFileSync(FACTCHECK_FILE, 'utf8')); if (l && typeof l === 'object') factCheckDb = { latest: l.latest || null, updatedAt: l.updatedAt || null }; }
  catch (e) { /* keep default */ }
} else { try { writeJsonFileSync(FACTCHECK_FILE, factCheckDb); } catch (e) {} }
function saveFactCheck() { saveJsonFileSync(FACTCHECK_FILE, factCheckDb, 'FactCheck'); }

const aiFactCheckService = createAiFactCheckService({
  state: factCheckDb,
  save: saveFactCheck,
  engines: AI_ENGINES,
  engineConfigured,
  askEngine,
  meterUsage,
  getTruth: () => buildFactTruth({ business: BUSINESS, listingKit, siteDomain }),
  geminiGenerate,
  geminiModel: GEMINI_MODEL,
  parseJson: parseGeminiJson,
  env: process.env,
});
const runFactCheck = aiFactCheckService.run;

// ============================================================
// P4b — AI CRAWLER ACCESS AUDIT
// AI crawlers are server-side bots (they don't run JS), and GHL doesn't expose
// server logs — so we can't count hits. What we CAN do (and what actually
// matters) is verify the site's robots.txt lets the AI bots read it at all.
// A blocked GPTBot = invisible to ChatGPT no matter how good the content is.
// ============================================================
const AI_CRAWLERS_FILE = path.join(DATA_DIR, 'ai-crawlers.json');
let crawlersDb = { latest: null, updatedAt: null };
if (fs.existsSync(AI_CRAWLERS_FILE)) {
  try { const l = JSON.parse(fs.readFileSync(AI_CRAWLERS_FILE, 'utf8')); if (l && typeof l === 'object') crawlersDb = { latest: l.latest || null, updatedAt: l.updatedAt || null }; } catch (e) {}
} else { try { writeJsonFileSync(AI_CRAWLERS_FILE, crawlersDb); } catch (e) {} }
function saveCrawlers() { saveJsonFileSync(AI_CRAWLERS_FILE, crawlersDb, 'AI Crawlers'); }

const aiCrawlerService = createAiCrawlerService({
  state: crawlersDb,
  save: saveCrawlers,
  getSiteDomain: siteDomain,
  providerRuntime,
});
const runCrawlerAudit = aiCrawlerService.run;
// ============================================================
// P4c — REDDIT VISIBILITY ENGINE
// AI answer engines cite Reddit heavily. This finds real, high-intent Reddit
// threads where the business can add genuine value (and get mentioned), with
// an authentic, non-spammy engagement angle for each.
// ============================================================
const REDDIT_FILE = path.join(DATA_DIR, 'reddit-threads.json');
let redditDb = { latest: null, updatedAt: null };
if (fs.existsSync(REDDIT_FILE)) {
  try { const l = JSON.parse(fs.readFileSync(REDDIT_FILE, 'utf8')); if (l && typeof l === 'object') redditDb = { latest: l.latest || null, updatedAt: l.updatedAt || null }; } catch (e) {}
} else { try { writeJsonFileSync(REDDIT_FILE, redditDb); } catch (e) {} }
function saveReddit() { saveJsonFileSync(REDDIT_FILE, redditDb, 'Reddit'); }

const redditDiscoveryService = createRedditDiscoveryService({
  state: redditDb,
  save: saveReddit,
  business: BUSINESS,
  getListingKit: listingKit,
  geminiGenerate,
  geminiModel: GEMINI_MODEL,
  parseJson: parseGeminiJson,
  env: process.env,
});
const runRedditScan = redditDiscoveryService.run;
// These three read/run features share one concurrency, budget, and error
// boundary while retaining their distinct status payloads.
registerAiAuditRoutes(app, {
  requireAuth,
  usageOverBudget,
  budgetBlock,
  logger: console,
  audits: [
    {
      path: '/api/ai-factcheck',
      status: () => ({
        latest: factCheckDb.latest,
        updatedAt: factCheckDb.updatedAt,
        engines: enginesStatus(),
        anyConfigured: AI_ENGINES.some(engine => engineConfigured(engine.id)),
      }),
      run: runFactCheck,
      useBudget: true,
      rejectOutputError: true,
      logLabel: 'FactCheck',
    },
    {
      path: '/api/ai-crawlers',
      status: () => ({
        latest: crawlersDb.latest,
        updatedAt: crawlersDb.updatedAt,
        site: siteDomain(),
      }),
      run: runCrawlerAudit,
      logLabel: 'AI Crawlers',
    },
    {
      path: '/api/reddit-threads',
      status: () => ({
        latest: redditDb.latest,
        updatedAt: redditDb.updatedAt,
        anyConfigured: !!process.env.GEMINI_API_KEY,
      }),
      run: runRedditScan,
      useBudget: true,
      rejectOutputError: true,
      logLabel: 'Reddit',
    },
  ],
});

// ============================================================
// P4d — REPEATABLE WEBSITE AUDIT & GHL SCHEMA ENGINE
// Inspects live hosted GHL preview and production websites, validating
// metadata, robots, schema graphs, content clarity, and asset bloat.
// ============================================================
const WEBSITE_AUDIT_FILE = path.join(DATA_DIR, 'website-audit.json');
let websiteAuditDb = { latest: null, updatedAt: null, history: [] };
if (fs.existsSync(WEBSITE_AUDIT_FILE)) {
  try {
    const l = JSON.parse(fs.readFileSync(WEBSITE_AUDIT_FILE, 'utf8'));
    if (l && typeof l === 'object') {
      websiteAuditDb = { latest: l.latest || null, updatedAt: l.updatedAt || null, history: Array.isArray(l.history) ? l.history : [] };
    }
  } catch (e) {}
} else {
  try { writeJsonFileSync(WEBSITE_AUDIT_FILE, websiteAuditDb); } catch (e) {}
}
function saveWebsiteAudit() { saveJsonFileSync(WEBSITE_AUDIT_FILE, websiteAuditDb, 'Website Audit'); }

const websiteAuditService = createWebsiteAuditService({
  state: websiteAuditDb,
  save: saveWebsiteAudit,
  providerRuntime,
  getSiteUrl: () => DEFAULT_AUDIT_TARGETS.preview,
  logger,
});

app.get('/api/website-audit', (req, res) => {
  res.json({
    latest: websiteAuditService.getLatest(),
    updatedAt: websiteAuditDb.updatedAt,
    history: websiteAuditService.getHistory(),
    running: websiteAuditService.isRunning(),
    defaultTargets: DEFAULT_AUDIT_TARGETS,
  });
});

app.post('/api/website-audit/run', requireAuth, async (req, res) => {
  const targetUrl = req.body?.url ? String(req.body.url).trim() : null;
  const result = await websiteAuditService.run(targetUrl);
  if (!result.ok && result.busy) {
    return res.json({ success: true, busy: true });
  }
  return res.json({ success: result.ok, snapshot: result.snapshot, error: result.error });
});

app.get('/api/ghl-schema', (req, res) => {
  const domain = siteDomain();
  const schemaGraph = buildGhlSchemaGraph({ domain });
  const snippet = buildGhlTrackingSnippet({ domain });
  const validation = validateSchema(schemaGraph);
  res.json({
    success: true,
    domain,
    approvedFacts: APPROVED_FACTS,
    schemaGraph,
    snippet,
    validation,
  });
});

// ============================================================
// SEO BUDDY ASSISTANT — current dashboard data and confirmed action proposals
// A plain-English copilot that answers from the owner's REAL stored data.
// Reuses the dashboard score calculation and configured connection metadata.
// External actions still require the owner's confirmation.
// ============================================================
const assistantContext = createAssistantContext({
  buildHealthScore: (...args) => buildHealthScoreResponse(...args),
  getBusinessProfile: businessProfile,
  business: BUSINESS,
  getScoreSnapshots: () => scoreHistory.snapshots,
  getAiVisibilitySnapshot: () => aiVisDb.snapshots[aiVisDb.snapshots.length - 1] || null,
  getFactCheckSnapshot: () => factCheckDb.latest,
  getCrawlerSnapshot: () => crawlersDb.latest,
  getLocalNap: () => effectiveNap(localDb.nap, localDb.napExclusions),
  getNapExclusions: () => localDb.napExclusions || [],
  getCitationWorklist: worklistPayload,
  getAioAudits: () => aioAuditsDb,
  getConnections: () => ({
    googleBusinessProfilePublishing: gbpConfigured(),
    googleBusinessProfile: gbpReadiness(),
    gmail: !!gmailClient(),
    websitePublishing: !!process.env.GHL_ACCESS_TOKEN && !!process.env.GHL_LOCATION_ID,
    searchConsole: !!(process.env.GSC_SITE_URL && getGoogleAuth()),
  }),
  getGooglePost: () => ({
    status: gbpPublicationStatus(localDb.gbpDraft),
    recordedAt: localDb.gbpDraft?.postedAt || localDb.gbpDraft?.createdAt || null,
  }),
  getMonthlyReport: () => monthlyReportService ? monthlyReportService.status() : { ready: false },
  getFailureAlerts: () => reliabilityAlertService ? reliabilityAlertService.status() : { enabled: false, ready: false },
  getOperationalHealth: currentOperationalHealth,
  getContentSchedule: () => ({
    enabled: autopilotEnabled,
    nextRunAt: autopilotEnabled ? nextRunTime : null,
    lastSuccessfulRunAt: lastAutopilotRun,
  }),
  getRedditSnapshot: () => redditDb.latest,
  getEngines: enginesStatus,
  getUsage: currentUsage,
  getBudget: () => usageMeter.budgetUSD,
  getSiteDomain: siteDomain,
});
// ============================================================
// USAGE / COST METERING — tenant-scoped compatibility boundary.
// Account/month accounting is separate from storage and HTTP. A transactional
// reservation design is still required before adding application replicas.
// ============================================================
const usageRepository = createUsageRepository(stateRepository);
const usageMeter = createUsageMeter({
  initialState: usageRepository.load(),
  saveState: usageRepository.save,
  getAccountKey: () => businessProfileService.locationId,
});
// Hoisted callbacks preserve earlier route registrations without moving boot
// initialization ahead of tenant hydration, write observers, or business setup.
function saveUsage() { return usageMeter.save(); }
function accountKey() { return usageMeter.accountKey(); }
function usageMonthKey() { return usageMeter.monthKey(); }
function currentUsage() { return usageMeter.current(); }
function meterUsage(kind, n) { return usageMeter.record(kind, n); }
function usageOverBudget() { return usageMeter.overBudget(); }
function budgetBlock(res) { res.json({ success: true, budgetReached: true, message: `You've reached your monthly usage budget of $${usageMeter.budgetUSD}. Raise or clear it in Settings to keep running AI features this month.` }); return true; }

registerUsageRoutes(app, {
  requireOwner,
  currentUsage,
  usageMonthKey,
  accountKey,
  usageState: usageMeter,
  usageOverBudget,
  saveUsage,
});
registerAssistantRoutes(app, {
  requireAuth,
  hasGeminiKey: () => !!process.env.GEMINI_API_KEY,
  usageOverBudget,
  getBudget: () => usageMeter.budgetUSD,
  getContext: assistantContext,
  geminiGenerate,
  model: GEMINI_MODEL,
  logger: console,
});

// 15. Performance — period-over-period trends, durable snapshots, and leads
const performanceHistoryRepository = createPerformanceHistoryRepository(stateRepository);
const performanceHistory = createPerformanceHistory({
  initialSnapshots: performanceHistoryRepository.load(),
  saveSnapshots: performanceHistoryRepository.save,
});

const performanceService = createPerformanceService({
  allowMockIntegrations: ALLOW_MOCK_INTEGRATIONS,
  getGoogleAuth,
  getSiteUrl: () => process.env.GSC_SITE_URL,
  createWebmasters,
  searchConsoleQuery,
  getSnapshots: () => performanceHistory.snapshots,
  recordSnapshot: performanceHistory.record,
  getAioAudits: () => aioAuditsDb,
  getGhlConfig: () => ({ token: process.env.GHL_ACCESS_TOKEN, locationId: process.env.GHL_LOCATION_ID }),
  providerFetch: (...args) => providerRuntime.fetch(...args),
  logger: console,
});
const computePerformance = performanceService.getPerformance;

registerPerformanceRoutes(app, { getPerformance: computePerformance });

// 16. On-Site & Technical SEO tools
function parseGeminiJson(text) {
  let raw = (text || '').trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) raw = m[0];
  try { return JSON.parse(raw); } catch (e) { return null; }
}

registerOnsiteRoutes(app, {
  requireAuth,
  hasGeminiKey: () => !!process.env.GEMINI_API_KEY,
  brandPrompt,
  geminiGenerate,
  model: GEMINI_MODEL,
  parseGeminiJson,
  getHistory: () => historyDb,
  getSiteUrl: () => process.env.GSC_SITE_URL,
  getAuthorName: () => process.env.GHL_AUTHOR_NAME,
  getAuthorUrl: () => process.env.GHL_AUTHOR_URL,
  business: BUSINESS,
  logger: console,
});

// ============================================================
// 15. Citation Outreach Engine — turns the citation audit into an
// ACTION worklist. The finder runs server-side and is cached; the tab
// shows only what to do. Pieces: a cached scan, a canonical Listing Kit,
// per-target outreach assets (pitch email or listing payload), and a
// persistent status tracker that survives redeploys.
// ============================================================
const CITATIONS_FILE = path.join(DATA_DIR, 'citations.json');
let citationsDb = {
  lastScanned: null, brandCited: false, totalQueries: 0, sourcesFound: 0,
  queries: [], targets: [], statuses: {}, kit: null, excludedCompetitorDomains: [],
  autoEnabled: true, intervalDays: 7, newDomains: []
};
try {
  if (fs.existsSync(CITATIONS_FILE)) {
    citationsDb = Object.assign(citationsDb, JSON.parse(fs.readFileSync(CITATIONS_FILE, 'utf8')));
  }
} catch (e) { console.error('[Citations] load failed:', e.message); }
function saveCitations() {
  saveJsonFileSync(CITATIONS_FILE, citationsDb, 'Citations');
}

// Canonical facts pasted onto every listing + used in every pitch.
function siteDomain() {
  let domain = (process.env.GSC_SITE_URL || 'https://bestdayfitness.com').trim();
  if (domain.startsWith('sc-domain:')) domain = 'https://' + domain.substring(10);
  return domain.replace(/\/$/, '');
}
const listingKitService = createListingKitService({
  business: BUSINESS,
  getBrandProfile: () => brandState.profile,
  getCitationState: () => citationsDb,
  getSiteDomain: siteDomain,
  phoneDisplay,
  save: saveCitations,
});
// Kept as a declaration because AI audit services are composed earlier and
// receive this lazy reader before citation state is initialized.
function listingKit() {
  return listingKitService.build();
}

// Merge cached targets with saved statuses + derive the action for each.
function worklistPayload() {
  return buildCitationWorklist(citationsDb, listingKit());
}

const citationScanService = createCitationScanService({
  state: citationsDb,
  save: saveCitations,
  business: BUSINESS,
  geminiGenerate,
  model: GEMINI_MODEL,
  parseJson: parseGeminiJson,
  daysSince,
  env: process.env,
  logger: console,
});

registerCitationRoutes(app, {
  requireAuth,
  hasGeminiKey: () => !!process.env.GEMINI_API_KEY,
  usageOverBudget,
  budgetBlock,
  getSavedQueries: () => citationsDb.queries || [],
  performScan: citationScanService.performScan,
  worklist: worklistPayload,
  enqueueScanCheck: () => enqueueDurableJob('citation.scan', {}, {
    idempotencyKey: durableJobKey('citation.scan', 12 * 60 * 60 * 1000),
    maxAttempts: 5,
  }),
  setAutoEnabled: enabled => {
    citationsDb.autoEnabled = enabled;
    saveCitations();
    return citationsDb.autoEnabled;
  },
  clearNewDomains: () => {
    citationsDb.newDomains = [];
    saveCitations();
  },
  updateStatus: (domain, status) => {
    if (!citationsDb.statuses) citationsDb.statuses = {};
    citationsDb.statuses[domain] = { status, updatedAt: new Date().toISOString() };
    saveCitations();
  },
  listingKit,
  discoverTargets: citationScanService.discoverTargets,
  filterTargets: citationScanService.filterTargets,
  isExcludedDomain: citationScanService.isExcludedDomain,
  updateListingKit: listingKitService.update,
  geminiGenerate,
  model: GEMINI_MODEL,
  parseGeminiJson,
  brandPrompt,
  logger: console,
});

// Background scheduler for the weekly citation auto-scan (staggered from the
// Local/On-Site autopilots so they don't all fire grounded calls at once).

// ============================================================
// 16. Local SEO Autopilot — hands-off local upkeep:
//   • NAP monitor: scheduled grounded scan, flags NEW mismatches only
//   • Weekly GBP post: auto-drafted and queued, ready to paste (Google
//     doesn't allow auto-posting without OAuth approval, so we draft)
//   • Review-reply drafter with saved history (on-demand — GBP reviews
//     can't be auto-pulled without Google OAuth)
// ============================================================
const LOCAL_FILE = path.join(DATA_DIR, 'local-autopilot.json');
let localDb = {
  enabled: true,
  napIntervalDays: 7,
  gbpIntervalDays: 7,
  lastNapRun: null,
  lastGbpRun: null,
  nap: null,               // { canonical, listings, mismatchCount, checkedAt }
  napExclusions: [],       // Owner preferences; keep original scan evidence intact.
  napSignature: null,      // to detect NEW mismatches vs last check
  napNewMismatch: false,
  gbpDraft: null,          // { text, topic, postType, createdAt, isNew }
  gbpHistory: [],
  replyHistory: []         // { review, rating, reply, createdAt }
};
try {
  if (fs.existsSync(LOCAL_FILE)) localDb = Object.assign(localDb, JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')));
} catch (e) { console.error('[Local Autopilot] load failed:', e.message); }
function saveLocal() {
  return saveJsonFileSync(LOCAL_FILE, localDb, 'Local Autopilot');
}

function daysSince(iso) { if (!iso) return Infinity; return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24); }

const localAutopilotService = createLocalAutopilotService({
  state: localDb,
  save: saveLocal,
  business: BUSINESS,
  getHistory: () => historyDb,
  brandPrompt,
  geminiGenerate,
  model: GEMINI_MODEL,
  parseJson: parseGeminiJson,
  daysSince,
  isGbpConfigured: () => typeof gbpConfigured === 'function' && gbpConfigured(),
  publishGbp: (...args) => postGbpLocalPost(...args),
  env: process.env,
  logger: console,
});

registerLocalSeoRoutes(app, {
  requireAuth,
  hasGeminiKey: () => !!process.env.GEMINI_API_KEY,
  business: BUSINESS,
  brandPrompt,
  geminiGenerate,
  model: GEMINI_MODEL,
  localState: localDb,
  filterNap: nap => effectiveNap(nap, localDb.napExclusions),
  saveLocal,
  logger: console,
});

registerLocalListingRoutes(app, { requireOwner, state: localDb, save: saveLocal });

// Background scheduler: catch up shortly after boot, then check twice a day.

// ============================================================
// 17. On-Site SEO Autopilot — a weekly content & optimization pipeline:
//   • Content Ideas: grounded keyword/topic clusters (rotating seed)
//   • Internal Links: suggested links between your published pages
//   • Title/Meta: optimized tags for your most recent page
// Runs on the same weekly, restart-safe schedule as the Local autopilot.
// ============================================================
const ONSITE_FILE = path.join(DATA_DIR, 'onsite-autopilot.json');
let onsiteDb = {
  enabled: true, intervalDays: 7, lastRun: null, seedIndex: 0,
  ideas: null, links: null, titlemeta: null
};
try {
  if (fs.existsSync(ONSITE_FILE)) onsiteDb = Object.assign(onsiteDb, JSON.parse(fs.readFileSync(ONSITE_FILE, 'utf8')));
} catch (e) { console.error('[On-Site Autopilot] load failed:', e.message); }
function saveOnsite() {
  saveJsonFileSync(ONSITE_FILE, onsiteDb, 'On-Site Autopilot');
}

const onsiteAutopilotService = createOnsiteAutopilotService({
  state: onsiteDb,
  save: saveOnsite,
  getHistory: () => historyDb,
  brandPrompt,
  geminiGenerate,
  model: GEMINI_MODEL,
  parseJson: parseGeminiJson,
  daysSince,
  env: process.env,
  logger: console,
});


// ============================================================
// 18. OAuth integrations — Gmail direct send + Google Business Profile
// auto-post. Both are PROGRESSIVE ENHANCEMENTS: if the env vars aren't
// set, the endpoints report needsSetup and the UI falls back to the
// existing compose-link / paste flow. Nothing breaks when unconfigured.
// ============================================================
const googleDelivery = createGoogleDelivery({ providerRuntime, siteDomain, env: process.env });
const { gmailClient, sendGmail, gbpConfigured, gbpReadiness, postGbpLocalPost } = googleDelivery;

// Monthly owner reports have their own durable state. Recipient addresses are
// operational configuration rather than secrets, and are masked in public
// status responses.
const MONTHLY_REPORT_FILE = path.join(DATA_DIR, 'monthly-report.json');
let savedMonthlyReport = {};
try { savedMonthlyReport = stateRepository.readJson('monthly-report.json', {}); }
catch (error) { logger.warn('monthly_report.state_unreadable', { error }); }
const monthlyReportDb = Object.assign({
  enabled: true,
  timeZone: process.env.REPORT_TIME_ZONE || 'America/New_York',
  recipient: '',
  lastAttemptAt: null,
  lastSentAt: null,
  lastSentMonth: null,
  lastMessageId: null,
  lastError: null,
}, savedMonthlyReport);
function saveMonthlyReport() {
  saveJsonFileSync(MONTHLY_REPORT_FILE, monthlyReportDb, 'Monthly Report');
}
let monthlyReportService = null;
const RELIABILITY_ALERTS_FILE = path.join(DATA_DIR, 'reliability-alerts.json');
let savedReliabilityAlerts = {};
try { savedReliabilityAlerts = stateRepository.readJson('reliability-alerts.json', {}); }
catch (error) { logger.warn('reliability_alerts.state_unreadable', { error }); }
const reliabilityAlertsDb = Object.assign({
  enabled: false,
  lastCheckedAt: null,
  lastAttemptAt: null,
  lastSentAt: null,
  lastResolvedAt: null,
  lastIncidentFingerprint: null,
  lastFailedFingerprint: null,
  lastDeliveryFailed: false,
}, savedReliabilityAlerts);
function saveReliabilityAlerts() {
  saveJsonFileSync(RELIABILITY_ALERTS_FILE, reliabilityAlertsDb, 'Reliability alerts');
}
let reliabilityAlertService = null;

// ============================================================
// 19. Performance weekly digest — a scheduled snapshot of search performance
// (clicks/impressions/rank vs last period, top movers, AI visibility, leads),
// saved for the Performance tab and auto-emailed via Gmail when connected.
// ============================================================
const PERF_DIGEST_FILE = path.join(DATA_DIR, 'performance-digest.json');
let perfDigestDb = { enabled: true, intervalDays: 7, autoEmail: false, lastRun: null, digest: null };
try {
  if (fs.existsSync(PERF_DIGEST_FILE)) perfDigestDb = Object.assign(perfDigestDb, JSON.parse(fs.readFileSync(PERF_DIGEST_FILE, 'utf8')));
} catch (e) { console.error('[Perf Digest] load failed:', e.message); }
function savePerfDigest() {
  saveJsonFileSync(PERF_DIGEST_FILE, perfDigestDb, 'Perf Digest');
}
const performanceDigestService = createPerformanceDigestService({
  state: perfDigestDb,
  save: savePerfDigest,
  getPerformance: computePerformance,
  getHealthScore: () => buildHealthScoreResponse(),
  businessName: BUSINESS.name,
  gmailClient,
  sendGmail,
  daysSince,
  env: process.env,
  logger: console,
});
registerDeliveryRoutes(app, {
  requireAuth,
  gmailClient,
  gmailSender: () => process.env.GMAIL_SENDER || '',
  sendGmail,
  gbpConfigured,
  gbpReadiness,
  postGbpLocalPost,
  getGbpDraft: () => localDb.gbpDraft,
  markGbpDraftPosted: result => {
    recordGbpPublication(localDb.gbpDraft, result);
    saveLocal();
  },
  defaultDigestRecipient: performanceDigestService.deliveryRecipient,
  getDigest: () => perfDigestDb.digest,
  saveNewDigest: performanceDigestService.saveNewDigest,
  buildDigest: performanceDigestService.build,
  logger: console,
});

// These scheduled features share the same state/toggle/run/seen HTTP shape.
// Their distinct scheduling, availability, and persistence behavior remains in
// the feature callbacks below.
registerScheduledFeatureRoutes(app, {
  requireAuth,
  features: [
    {
      path: '/api/local-autopilot',
      status: localAutopilotService.status,
      nudge: () => enqueueDurableJob('local.autopilot', {}, {
        idempotencyKey: durableJobKey('local.autopilot', 12 * 60 * 60 * 1000),
        maxAttempts: 5,
      }),
      toggle: body => {
        localDb.enabled = !!body.enabled;
        saveLocal();
        return { success: true, enabled: localDb.enabled };
      },
      availability: () => process.env.GEMINI_API_KEY ? null : ({
        success: true,
        unavailable: true,
        message: 'Add your Gemini API key in Settings to run the Local SEO Autopilot.',
      }),
      start: () => localAutopilotService.maybeRun(true).catch(() => {}),
      markSeen: () => {
        localDb.napNewMismatch = false;
        if (localDb.gbpDraft) localDb.gbpDraft.isNew = false;
        saveLocal();
      },
    },
    {
      path: '/api/onsite-autopilot',
      status: onsiteAutopilotService.status,
      nudge: () => enqueueDurableJob('onsite.autopilot', {}, {
        idempotencyKey: durableJobKey('onsite.autopilot', 12 * 60 * 60 * 1000),
        maxAttempts: 5,
      }),
      toggle: body => onsiteAutopilotService.setEnabled(body.enabled),
      availability: () => process.env.GEMINI_API_KEY ? null : ({
        success: true,
        unavailable: true,
        message: 'Add your Gemini API key in Settings to run the On-Site SEO Autopilot.',
      }),
      start: () => onsiteAutopilotService.maybeRun(true).catch(() => {}),
      markSeen: onsiteAutopilotService.markSeen,
    },
    {
      path: '/api/performance-digest',
      status: performanceDigestService.status,
      nudge: () => enqueueDurableJob('performance.digest', {}, {
        idempotencyKey: durableJobKey('performance.digest', 12 * 60 * 60 * 1000),
        maxAttempts: 5,
      }),
      toggle: performanceDigestService.setPreferences,
      start: () => performanceDigestService.maybeRun(true).catch(() => {}),
      markSeen: performanceDigestService.markSeen,
    },
  ],
});

// ============================================================
// 20. Optimization (Health) Score — the redesign's headline number.
// Five outcome pillars scored 0-100 from data we ALREADY store; the
// overall is a weighted average of only the MEASURED pillars, so a fresh
// account never sees a scary low number. Snapshotted daily for trend.
// ============================================================
const scoreHistoryRepository = createScoreHistoryRepository(stateRepository);
const healthScoreService = createHealthScoreService({
  getPerformance: computePerformance,
  getLocalState: () => localDb,
  effectiveNap,
  getAiAudits: () => aioAuditsDb,
  getCitationState: () => citationsDb,
  eligibleCitationState,
  getPublicationHistory: () => historyDb,
  isAutopilotEnabled: () => autopilotEnabled,
});
const scoreHistory = createScoreHistory({
  initialSnapshots: scoreHistoryRepository.load(),
  computeScore: healthScoreService.compute,
  saveSnapshots: scoreHistoryRepository.save,
  getRuntime: () => ({ mode: APP_MODE, mockIntegrationsAllowed: ALLOW_MOCK_INTEGRATIONS }),
});
const { buildResponse: buildHealthScoreResponse, recordDaily: recordDailyHealthSnapshot } = scoreHistory;

function scheduleDailyHealthSnapshots() {
  jobDispatcher.scheduleDaily('health.snapshot', 60000, 5);
}

function getNextMovesContext() {
  return {
    localDb: { ...localDb, nap: effectiveNap(localDb.nap, localDb.napExclusions) },
    citationsDb: eligibleCitationState(citationsDb),
    aioAuditsDb,
    autopilotEnabled,
    gscConfigured: !!(process.env.GSC_SITE_URL && getGoogleAuth()),
    isGbpConfigured: gbpConfigured,
  };
}

function getDigestContext() {
  return { onsiteDb, localDb: { ...localDb, nap: effectiveNap(localDb.nap, localDb.napExclusions) }, citationsDb: eligibleCitationState(citationsDb), perfDigestDb, historyDb, aiVisDb, autopilotEnabled };
}

function getReadinessContext() {
  return {
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    storagePersistent: storageReadiness().persistent,
    gscConfigured: !!(process.env.GSC_SITE_URL && getGoogleAuth()),
    ghlConfigured: !!(process.env.GHL_ACCESS_TOKEN && process.env.GHL_LOCATION_ID),
    adminConfigured: !!ADMIN_PASSWORD,
    businessProfileSaved: businessProfileService.configured,
    brandReviewed: !!brandState.reviewedAt,
    brandReviewedAt: brandState.reviewedAt,
    brandDurable: storageReadiness().persistent,
    stateBackendMode: STATE_BACKEND_MODE,
    appMode: APP_MODE,
    mockIntegrationsAllowed: ALLOW_MOCK_INTEGRATIONS,
  };
}

function getAutomationFeatures() {
  const aiReady = !!process.env.GEMINI_API_KEY;
  const week = 7 * 86400000;
  const features = [
    { key: 'content', title: 'Content publishing', tab: 'publish-tab', jobType: 'content.autopilot',
      configured: aiReady && !!process.env.GHL_ACCESS_TOKEN && !!process.env.GHL_LOCATION_ID,
      setupReason: 'Connect AI writing and website publishing in Settings.',
      enabled: autopilotEnabled, lastRun: lastAutopilotRun, nextRun: nextRunTime },
    { key: 'ai', title: 'AI visibility checks', tab: 'aio-tab', jobType: 'ai.visibility',
      configured: aiReady, enabled: aiVisDb.autoEnabled, running: aiVisibilityService.running,
      lastRun: aiVisDb.lastRun, intervalMs: (aiVisDb.intervalDays || 7) * 86400000 },
    { key: 'local', title: 'Local listings and Google posts', tab: 'local-tab', jobType: 'local.autopilot',
      configured: aiReady, enabled: localDb.enabled, running: localAutopilotService.running,
      lastRun: localDb.lastNapRun || localDb.lastGbpRun, intervalMs: week,
      needsApproval: !!localDb.gbpDraft && !localDb.gbpDraft.posted, failed: !!localDb.gbpDraft?.postError },
    { key: 'citations', title: 'Directory discovery', tab: 'citations-tab', jobType: 'citation.scan',
      configured: aiReady, enabled: citationsDb.autoEnabled, running: citationScanService.running,
      lastRun: citationsDb.lastScanned, intervalMs: (citationsDb.intervalDays || 7) * 86400000 },
    { key: 'onsite', title: 'Website improvement ideas', tab: 'onsite-tab', jobType: 'onsite.autopilot',
      configured: aiReady, enabled: onsiteDb.enabled, running: onsiteAutopilotService.running,
      lastRun: onsiteDb.lastRun, intervalMs: (onsiteDb.intervalDays || 7) * 86400000 },
    { key: 'digest', title: 'Results summary', tab: 'performance-tab', jobType: 'performance.digest',
      configured: aiReady, enabled: perfDigestDb.enabled, running: performanceDigestService.running,
      lastRun: perfDigestDb.lastRun, intervalMs: (perfDigestDb.intervalDays || 7) * 86400000 },
  ];
  if (monthlyReportService) {
    const report = monthlyReportService.status();
    features.push({
      key: 'monthly-report', title: 'Monthly owner report', tab: 'performance-tab', jobType: 'report.monthly-email',
      configured: report.ready,
      setupReason: report.gmailConfigured ? 'Add the owner email address in Results.' : 'Connect Gmail and add the owner email address in Results.',
      enabled: report.enabled, lastRun: report.lastSentAt, nextRun: report.nextRunAt, failed: report.hasDeliveryProblem,
    });
  }
  return features;
}

// Home/Reports dashboard projection. The module keeps response shaping pure;
// the composition root supplies the current live integration and feature state.
registerDashboardRoutes(app, {
  buildHealthScoreResponse,
  getNextMovesContext,
  getDigestContext,
  getReadinessContext,
  logger: console,
});

registerAutomationStatusRoute(app, {
  queue: durableJobQueue, worker: { status: () => ({ ...jobWorker.status(), running: isWorkerAvailable() }) },
  getFeatures: getAutomationFeatures,
});

// Start the Express Server

// ===========================================================================
// REVIEWS SITE STATS  —  bestdayfitnessreviews.com
// ---------------------------------------------------------------------------
// The reviews hub is a single self-contained static page, so everything here is
// derived by fetching that one URL. No new API keys, no new credentials, no new
// dependency — which is why this can ship today rather than waiting on Google
// Business Profile API access.
//
// Two jobs:
//   1. Inventory & growth — how many reviews are published, on which platforms,
//      and how that has grown month over month.
//   2. Structured-data & SEO health — the checks that catch the failure modes
//      this page is actually prone to: the visible cards silently drifting from
//      the JSON-LD, an aggregateRating the page has not earned, and a social
//      preview image that 404s (all three were real, found 2026-08-05).
// ===========================================================================

const REVIEWS_SNAPSHOTS_FILE = path.join(DATA_DIR, 'reviews-snapshots.json');
let reviewsSnapshots = [];
try {
  reviewsSnapshots = JSON.parse(fs.readFileSync(REVIEWS_SNAPSHOTS_FILE, 'utf8'));
  if (!Array.isArray(reviewsSnapshots)) reviewsSnapshots = [];
} catch (e) { reviewsSnapshots = []; }
const reviewsService = createReviewsService({
  providerRuntime,
  initialSnapshots: reviewsSnapshots,
  saveSnapshots: snapshots => saveJsonFileSync(REVIEWS_SNAPSHOTS_FILE, snapshots, 'Reviews snapshot'),
  getReviewsUrl: () => process.env.REVIEWS_URL || 'https://bestdayfitnessreviews.com',
  getReviewsApiUrl: () => process.env.REVIEWS_API_URL || `${(process.env.REVIEWS_URL || 'https://bestdayfitnessreviews.com').replace(/\/+$/, '')}/api/reviews`,
  getTrustpilotSettings: () => ({
    apiKey: process.env.TRUSTPILOT_API_KEY,
    domain: process.env.TRUSTPILOT_DOMAIN,
    apiBase: process.env.TRUSTPILOT_API_BASE,
  }),
});
registerReviewsRoutes(app, { service: reviewsService, logger: console });

const serverPdfReport = createServerPdfReport({ publicDir: PUBLIC_DIR, appOrigin: siteDomain() });
const monthlyReportDataService = createMonthlyReportDataService({
  buildScore: buildHealthScoreResponse,
  getPerformance: computePerformance,
  getSearch: getGscDashboardData,
  getReviews: reviewsService.getStats,
  getQueue: () => durableJobQueue.snapshot(100),
  buildMoves: () => buildNextMoves(getNextMovesContext()),
  getProfile: businessProfile,
  getHistory: () => historyDb,
  getAiState: () => aiVisDb,
  getDigest: performanceDigestService.status,
  buildAutomation: buildAutomationStatus,
  getAutomationFeatures,
  getWorkerRunning: isWorkerAvailable,
  buildReadiness: () => buildDeployReadiness(getReadinessContext()),
  logger,
});
const buildMonthlyReportData = monthlyReportDataService.build;
monthlyReportService = createMonthlyReportService({
  state: monthlyReportDb,
  saveState: saveMonthlyReport,
  gmailConfigured: () => !!gmailClient(),
  defaultRecipient: () => process.env.MONTHLY_REPORT_EMAIL || process.env.DIGEST_EMAIL || process.env.GMAIL_SENDER || '',
  buildReportData: buildMonthlyReportData,
  renderReport: serverPdfReport.render,
  sendGmail,
});
registerMonthlyReportRoutes(app, { requireOwner, service: monthlyReportService });
reliabilityAlertService = createReliabilityAlertService({
  state: reliabilityAlertsDb,
  saveState: saveReliabilityAlerts,
  gmailConfigured: () => !!gmailClient(),
  recipient: () => monthlyReportService.deliveryRecipient(),
  sendEmail: sendGmail,
});
registerReliabilityAlertRoutes(app, { requireOwner, service: reliabilityAlertService });
// ===========================================================================
// RECORDED ANSWERS  —  turning the owner's own words into content
// ---------------------------------------------------------------------------
// Two capabilities that nothing else in this app could do. Everything else here
// writes ABOUT a keyword from the model's general knowledge; these two are the
// only path for first-hand expertise to enter the system.
//
//   /api/transcribe   upload a recording, get a transcript back. Feeds the
//                     optional "your own words" box on the article generator,
//                     which is where the blog-post half of this now lives.
//   /api/social-pack  transcript -> 5 angles -> 5 hooks -> a 30s script, for
//                     the short-form platforms GBP posts don't cover.
//
// Deliberately NOT here: question-picking (the leak list on the Search Console
// tab already ranks queries with impressions and no clicks, and Autopilot
// already writes articles from it) and a second blog writer (generateArticleHelper
// has the better AEO prompt and the only path to publishing).
//
// Both spend Gemini credits, so both sit behind requireAuth.
// ===========================================================================

registerRecordedContentRoutes(app, {
  requireAuth,
  usageOverBudget,
  budgetBlock,
  geminiGenerate,
  model: GEMINI_MODEL,
  businessName: BUSINESS.name,
  parseGeminiJson,
  logger: console,
});

const backgroundRuntime = createBackgroundRuntime({
  role: PROCESS_ROLE,
  worker: jobWorker,
  dispatcher: jobDispatcher,
  handlers: jobHandlers,
  logger,
  startContentSchedule: () => {
    if (!autopilotEnabled) return;
    try { startAutopilotScheduler(); }
    catch (error) { logger.error('autopilot.schedule_restore_failed', { error }); }
  },
  stopContentSchedule: () => contentScheduler?.stop(),
  scheduleHealthSnapshots: scheduleDailyHealthSnapshots,
  recurringChecks: [
    { type: 'local.autopilot', initialDelayMs: 30000, intervalMs: 12 * 60 * 60 * 1000 },
    { type: 'onsite.autopilot', initialDelayMs: 45000, intervalMs: 12 * 60 * 60 * 1000 },
    { type: 'citation.scan', initialDelayMs: 60000, intervalMs: 12 * 60 * 60 * 1000 },
    { type: 'performance.digest', initialDelayMs: 75000, intervalMs: 12 * 60 * 60 * 1000 },
    { type: 'ai.visibility', initialDelayMs: 90000, intervalMs: 12 * 60 * 60 * 1000 },
  ],
  reindexRepairedPosts: () => articleIndexingService.reindexRepairedPosts(),
  featureHandlers: {
    'content.autopilot': async () => {
    if (!autopilotEnabled) return { skipped: 'disabled' };
    await runAutopilotCycle();
    return { completed: true };
    },
    'ai.visibility': async () => { await aiVisibilityService.maybeRun(false); return { checked: true }; },
    'citation.scan': async () => { await citationScanService.maybeRun(false); return { checked: true }; },
    'local.autopilot': async () => { await localAutopilotService.maybeRun(false); return { checked: true }; },
    'onsite.autopilot': async () => { await onsiteAutopilotService.maybeRun(false); return { checked: true }; },
    'performance.digest': async () => { await performanceDigestService.maybeRun(false); return { checked: true }; },
    'report.monthly-email': async () => monthlyReportService.runScheduled(),
    'operations.alert-check': async () => reliabilityAlertService.check(await currentOperationalHealth()),
    'health.snapshot': async () => { await recordDailyHealthSnapshot(); return { recorded: true }; },
    'storage.backup': async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (backupService.list().some(item => item.valid && String(item.id).startsWith(today))) return { skipped: 'already-backed-up' };
      const backup = backupService.create();
      logger.info('storage.backup_created', { tenantId: stateRepository.tenantId, backupId: backup.id, files: backup.files.length });
      return { backupId: backup.id, files: backup.files.length };
    },
  },
});

const server = app.listen(PORT, () => {
  logger.info('server.started', {
    port: Number(PORT),
    mode: APP_MODE,
    mockIntegrationsAllowed: ALLOW_MOCK_INTEGRATIONS,
    geminiModel: GEMINI_MODEL,
    persistentStorage: STORAGE_IS_PERSISTENT || STATE_BACKEND_MODE === 'postgres',
    adminLockEnabled: Boolean(ADMIN_PASSWORD),
    operatorLockEnabled: Boolean(OPERATOR_PASSWORD),
    auditSigningEnabled: Boolean(process.env.AUDIT_SIGNING_KEY),
    tenantId: stateRepository.tenantId,
    repositoryBackend: stateRepository.backend,
    stateBackendMode: STATE_BACKEND_MODE,
    processRole: PROCESS_ROLE.name,
    migratedStateFiles: stateRepository.migrated.length,
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME || null,
    railwayReplica: process.env.RAILWAY_REPLICA_ID || null,
  });
  if (!ADMIN_PASSWORD) logger.warn('security.admin_lock_disabled', { mode: APP_MODE });
  backgroundRuntime.registerHandlers();
  const databaseInitialization = initializePostgresMirror().catch(error => {
    postgresStatus.ready = false;
    postgresStatus.error = error.code || error.message;
    logger.error('storage.postgres_initialization_failed', { tenantId: stateRepository.tenantId, error });
    if (STATE_BACKEND_MODE === 'postgres') throw error;
  });
  if (STATE_BACKEND_MODE === 'postgres') {
    databaseInitialization.then(() => backgroundRuntime.start()).catch(() => { /* readiness remains false */ });
  } else {
    backgroundRuntime.start();
  }
});

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  const backgroundStop = backgroundRuntime.stop().catch(error => logger.warn('background.stop_failed', { error }));
  logger.info('server.shutdown_started', { signal });
  const forceExit = setTimeout(() => {
    logger.error('server.shutdown_timeout', { signal, timeoutMs: 10000 });
    server.closeAllConnections?.();
    process.exit(1);
  }, 10000);
  forceExit.unref();
  server.close(async error => {
    clearTimeout(forceExit);
    if (error) {
      logger.error('server.shutdown_failed', { signal, error });
      process.exit(1);
    }
    try {
      await backgroundStop;
      if (postgresStateBridge) {
        await postgresStateBridge.flush();
        postgresStateBridge.close();
        setJsonWriteObserver(null);
      }
      if (postgresMirror) await postgresMirror.close();
    } catch (error) { logger.warn('storage.postgres_close_failed', { error }); }
    logger.info('server.shutdown_completed', { signal });
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
