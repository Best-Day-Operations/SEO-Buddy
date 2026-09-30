import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  APPROVED_FACTS,
  ALL_DAYS_OF_WEEK,
  VERIFIED_PAGE_CONFIGS,
  buildBusinessIdentitySchema,
  buildPageMetadataAndSchema,
  buildGhlSchemaGraph,
  buildGhlTrackingSnippet,
  validateSchema,
} = require('../lib/ghl-schema-service.js');

const {
  DEFAULT_AUDIT_TARGETS,
  APPROVED_PUBLIC_DOMAINS,
  TEST_LOCAL_DOMAINS,
  isApprovedAuditTarget,
  normalizeUrlForMatch,
  validateGeoEvidence,
  parseHtmlMetadata,
  evaluateWebsiteAudit,
  createWebsiteAuditService,
} = require('../lib/website-audit-service.js');

const { parseHeadElements } = require('../lib/html-head-parser.js');

// --- 1. GEO EVIDENCE VALIDATION & EXACT TARGET MATCHING ---

test('normalizeUrlForMatch preserves query parameters, normalizes port/slash, and strips hashes', () => {
  const u1 = 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?v_test=1790778792385#home';
  const u2 = 'HTTPS://LINK.BESTDAYFITNESS.COM:443/preview/VRsgFMkoL8fUwW9W4ckU/?v_test=1790778792385';
  assert.equal(normalizeUrlForMatch(u1), 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?v_test=1790778792385');
  assert.equal(normalizeUrlForMatch(u2), 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?v_test=1790778792385');
  assert.equal(normalizeUrlForMatch(u1), normalizeUrlForMatch(u2));

  // Query parameter order normalization
  const qA = 'https://bestdayfitness.com/test?b=2&a=1';
  const qB = 'https://bestdayfitness.com/test?a=1&b=2';
  assert.equal(normalizeUrlForMatch(qA), normalizeUrlForMatch(qB));
});

test('exact target matching rejects URL-prefix matches (bestdayfitness.com vs bestdayfitness.com/consultation)', () => {
  const rootTarget = 'https://bestdayfitness.com/';
  const subpageEvidence = {
    url: 'https://bestdayfitness.com/consultation',
    timestamp: '2026-09-30T14:12:47.000Z',
    score: 80,
    exitStatus: 'success',
  };

  const dummyMeta = { bytes: 100, headings: { h1Texts: [] }, assets: {}, schemaBlocks: [], malformedJsonLd: [] };
  const audit = evaluateWebsiteAudit(rootTarget, dummyMeta, { geoEvidence: subpageEvidence });

  assert.equal(audit.checks.geoOptimizer.status, 'evidence_target_mismatch');
  assert.equal(audit.checks.geoOptimizer.score, null);
  assert.ok(audit.checks.geoOptimizer.error.includes('does not match current audit target'));
});

test('validateGeoEvidence rejects out-of-range scores and incomplete evidence', () => {
  // Score 999
  const outOfRange = {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    score: 999,
  };
  const valOut = validateGeoEvidence(outOfRange);
  assert.equal(valOut.valid, false);
  assert.ok(valOut.error.includes('out-of-range score'));

  // Missing timestamp
  const missingTs = {
    url: 'https://bestdayfitness.com',
    score: 80,
  };
  const valTs = validateGeoEvidence(missingTs);
  assert.equal(valTs.valid, false);
  assert.ok(valTs.error.includes('missing valid ISO run timestamp'));

  // Negative score
  const negScore = {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    score: -10,
  };
  assert.equal(validateGeoEvidence(negScore).valid, false);
});

test('evidence with exitStatus: 1 and no error string is labeled unavailable, not completed', () => {
  const failedEvidence = {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    score: null,
    exitStatus: 1, // Exit code 1 with NO error text
  };

  const dummyMeta = { bytes: 100, headings: { h1Texts: [] }, assets: {}, schemaBlocks: [], malformedJsonLd: [] };
  const audit = evaluateWebsiteAudit('https://bestdayfitness.com', dummyMeta, { geoEvidence: failedEvidence });

  assert.equal(audit.checks.geoOptimizer.status, 'unavailable');
  assert.equal(audit.checks.geoOptimizer.score, null);
  assert.ok(audit.checks.geoOptimizer.error.includes('non-zero exit code: 1'));
});

test('evidence with exitStatus: 2 and 130 is normalized as failure with score: null and preserved exitCode', () => {
  const dummyMeta = { bytes: 100, headings: { h1Texts: [] }, assets: {}, schemaBlocks: [], malformedJsonLd: [] };

  // Exit status 2 (misuse of shell built-in or syntax error)
  const audit2 = evaluateWebsiteAudit('https://bestdayfitness.com', dummyMeta, {
    geoEvidence: {
      url: 'https://bestdayfitness.com',
      timestamp: '2026-09-30T14:12:47.000Z',
      score: 42, // Non-null score in raw evidence must NOT be retained on failed exit!
      exitStatus: 2,
    },
  });
  assert.equal(audit2.checks.geoOptimizer.status, 'unavailable');
  assert.equal(audit2.checks.geoOptimizer.score, null);
  assert.equal(audit2.score, null);
  assert.equal(audit2.checks.geoOptimizer.exitCode, 2);
  assert.equal(audit2.checks.geoOptimizer.exitStatus, 'failed');

  // Exit status 130 (Script terminated by Control-C / SIGINT)
  const audit130 = evaluateWebsiteAudit('https://bestdayfitness.com', dummyMeta, {
    geoEvidence: {
      url: 'https://bestdayfitness.com',
      timestamp: '2026-09-30T14:12:47.000Z',
      score: 75,
      exitStatus: 130,
    },
  });
  assert.equal(audit130.checks.geoOptimizer.status, 'unavailable');
  assert.equal(audit130.checks.geoOptimizer.score, null);
  assert.equal(audit130.score, null);
  assert.equal(audit130.checks.geoOptimizer.exitCode, 130);
  assert.equal(audit130.checks.geoOptimizer.exitStatus, 'failed');
});

test('validateGeoEvidence rejects contradictory, unsupported, or insufficient status fields', () => {
  // Contradictory: exitCode: 0 but exitStatus: 2
  const r1 = validateGeoEvidence({
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    exitCode: 0,
    exitStatus: 2,
  });
  assert.equal(r1.valid, false);
  assert.ok(r1.error.includes('Conflicting exitCode'));

  // Contradictory: exitCode: 0 but exitStatus: 'failed'
  const r2 = validateGeoEvidence({
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    exitCode: 0,
    exitStatus: 'failed',
  });
  assert.equal(r2.valid, false);
  assert.ok(r2.error.includes('Contradictory status'));

  // Contradictory: exitCode: 1 but exitStatus: 'success'
  const r3 = validateGeoEvidence({
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    exitCode: 1,
    exitStatus: 'success',
  });
  assert.equal(r3.valid, false);
  assert.ok(r3.error.includes('Contradictory status'));

  // Unsupported exitStatus string
  const r4 = validateGeoEvidence({
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    exitStatus: 'partially_working',
  });
  assert.equal(r4.valid, false);
  assert.ok(r4.error.includes('Unsupported exitStatus value'));

  // Insufficient status information (no code, status, error, or checks)
  const r5 = validateGeoEvidence({
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
  });
  assert.equal(r5.valid, false);
  assert.ok(r5.error.includes('insufficient status information'));
});

test('exitCode: 0 is preserved without truthiness falsy default replacement', () => {
  const successEvidence = {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    score: 50,
    exitCode: 0, // Explicit 0
    checks: { robots_txt: { score: 10 } },
  };

  const dummyMeta = { bytes: 100, headings: { h1Texts: [] }, assets: {}, schemaBlocks: [], malformedJsonLd: [] };
  const audit = evaluateWebsiteAudit('https://bestdayfitness.com', dummyMeta, { geoEvidence: successEvidence });

  assert.equal(audit.checks.geoOptimizer.status, 'completed');
  assert.equal(audit.checks.geoOptimizer.score, 50);
  assert.equal(audit.checks.geoOptimizer.exitCode, 0);
});

test('real tool run demonstration: preview size-limit failure is valid evidence of unavailable measurement', () => {
  // Load real failure artifact from disk
  const artifactPath = path.resolve('C:/Users/chris/.gemini/antigravity/brain/902d0ef8-80e1-4892-97e0-44fe87437e0d/geo-audits/baseline-staging-preview.json');
  assert.ok(fs.existsSync(artifactPath), 'Artifact must exist on disk');
  const previewArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const dummyMeta = { bytes: 20413641, headings: { h1Texts: [] }, assets: {}, schemaBlocks: [], malformedJsonLd: [] };
  const audit = evaluateWebsiteAudit(previewArtifact.url, dummyMeta, { geoEvidence: previewArtifact });

  assert.equal(audit.checks.geoOptimizer.status, 'unavailable');
  assert.equal(audit.checks.geoOptimizer.score, null);
  assert.equal(audit.score, null);
  assert.ok(audit.checks.geoOptimizer.error.includes('Response too large: 20398368 bytes'));
});

test('real tool run demonstration: production baseline import preserves findings and score 32', () => {
  const artifactPath = path.resolve('C:/Users/chris/.gemini/antigravity/brain/902d0ef8-80e1-4892-97e0-44fe87437e0d/geo-audits/baseline-production-bestdayfitness.json');
  assert.ok(fs.existsSync(artifactPath), 'Artifact must exist on disk');
  const prodArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const dummyMeta = { bytes: 50000, headings: { h1Texts: [] }, assets: {}, schemaBlocks: [], malformedJsonLd: [] };
  const audit = evaluateWebsiteAudit(prodArtifact.url, dummyMeta, { geoEvidence: prodArtifact });

  assert.equal(audit.checks.geoOptimizer.status, 'completed');
  assert.equal(audit.checks.geoOptimizer.score, 32);
  assert.equal(audit.score, 32);
  assert.equal(audit.checks.geoOptimizer.band, 'critical');
  assert.equal(audit.checks.geoOptimizer.rawSummary.meta, 5);
  assert.equal(audit.checks.geoOptimizer.rawSummary.robots, 5);
});

// --- 2. PERSISTENCE & MEANINGFUL HISTORY ---

test('imported evidence is persisted in state.evidence and survives service restart', async () => {
  const persistedState = {
    latest: null,
    updatedAt: null,
    history: [],
    evidence: {},
  };
  let saveCount = 0;

  const validHtml = `<!DOCTYPE html><html><head>
    <title>Best Day Fitness &amp; Wellness</title>
    <meta name="description" content="One team, one plan: personal training for adults 50+ in St. Petersburg, FL.">
    <link rel="canonical" href="https://bestdayfitness.com/">
    <meta name="robots" content="index, follow">
  </head><body><h1>Best Day Fitness &amp; Wellness</h1></body></html>`;

  // 1. Initial service instance
  const service1 = createWebsiteAuditService({
    state: persistedState,
    save: () => { saveCount++; },
    providerRuntime: {
      fetch: async () => ({ text: async () => validHtml }),
    },
    allowLocalTargets: true,
  });

  // Run audit initial
  await service1.run('https://bestdayfitness.com');
  assert.equal(persistedState.latest.checks.geoOptimizer.status, 'not_run');

  // Import verified evidence
  const verifiedEvidence = {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    score: 32,
    exitStatus: 'success',
  };
  service1.importGeoEvidence('https://bestdayfitness.com', verifiedEvidence);
  assert.equal(persistedState.latest.checks.geoOptimizer.status, 'completed');
  assert.equal(persistedState.latest.checks.geoOptimizer.score, 32);
  assert.ok(persistedState.evidence['https://bestdayfitness.com']);

  // 2. Recreate service from persistedState (simulating server restart)
  const service2 = createWebsiteAuditService({
    state: persistedState, // Same persisted state loaded from disk
    save: () => { saveCount++; },
    providerRuntime: {
      fetch: async () => ({ text: async () => validHtml }),
    },
    allowLocalTargets: true,
  });

  // Latest snapshot preserved
  assert.equal(service2.getLatest().checks.geoOptimizer.status, 'completed');
  assert.equal(service2.getLatest().checks.geoOptimizer.score, 32);

  // Subsequent audit run retains persistent evidence for the target
  await service2.run('https://bestdayfitness.com');
  assert.equal(service2.getLatest().checks.geoOptimizer.status, 'completed');
  assert.equal(service2.getLatest().checks.geoOptimizer.score, 32);

  // Immutable history contains meaningful fields
  const historyEntry = service2.getHistory()[0];
  assert.ok(historyEntry);
  assert.equal(historyEntry.targetUrl, 'https://bestdayfitness.com');
  assert.equal(historyEntry.geoStatus, 'completed');
  assert.equal(historyEntry.geoScore, 32);
  assert.ok(historyEntry.provenance.toolRevision);
});

// --- 3. POSITIVE SERVICE FACTS VERIFICATION ---

test('validateSchema rejects consultation with 90 minutes and unrelated team', () => {
  const badConsultationSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'LocalBusiness',
        name: 'Best Day Fitness & Wellness',
        telephone: '+1-727-334-1472',
        address: { streetAddress: '6619 1st Ave S', addressLocality: 'St. Petersburg', addressRegion: 'FL', postalCode: '33707' },
        openingHoursSpecification: [
          { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '04:00', closes: '22:00' },
          { dayOfWeek: ['Sunday'], opens: '09:00', closes: '17:00' },
        ],
      },
      {
        '@type': 'Service',
        name: 'Fitness Consultation',
        description: 'A 90-minute session conducted by an unrelated team.', // Conflicting duration and wrong team!
        offers: { price: '99.00', priceCurrency: 'USD' },
      },
    ],
  };

  const res = validateSchema(badConsultationSchema);
  assert.equal(res.valid, false);
  assert.ok(res.categories.approvedFacts.conflictingFacts.some(f => f.includes('conflicting duration')));
  assert.ok(res.categories.approvedFacts.conflictingFacts.some(f => f.includes('Client Experience Team')));
});

test('validateSchema rejects public HaloRed membership price of $999.00', () => {
  const badHaloRedSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'LocalBusiness',
        name: 'Best Day Fitness & Wellness',
        telephone: '+1-727-334-1472',
        address: { streetAddress: '6619 1st Ave S', addressLocality: 'St. Petersburg', addressRegion: 'FL', postalCode: '33707' },
        openingHoursSpecification: [
          { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '04:00', closes: '22:00' },
          { dayOfWeek: ['Sunday'], opens: '09:00', closes: '17:00' },
        ],
      },
      {
        '@type': 'Service',
        name: 'HaloRed Red Light & Salt Therapy',
        offers: [
          { name: 'Single Session', price: '39.99' },
          { name: 'Member Monthly', price: '299.00' },
          { name: 'Public Guest Monthly', price: '999.00' }, // WRONG PRICE: should be 399.00!
        ],
      },
    ],
  };

  const res = validateSchema(badHaloRedSchema);
  assert.equal(res.valid, false);
  assert.ok(res.categories.approvedFacts.conflictingFacts.some(f => f.includes('HaloRed public monthly price mismatch')));
});

test('validateSchema positively verifies genuine approved consultation and HaloRed offers', () => {
  const fullSchema = buildGhlSchemaGraph({ domain: 'https://bestdayfitness.com' });
  const res = validateSchema(fullSchema);
  assert.equal(res.valid, true);
  assert.ok(res.categories.approvedFacts.verifiedFacts.some(f => f.includes('Consultation offer verified: $99.00')));
  assert.ok(res.categories.approvedFacts.verifiedFacts.some(f => f.includes('HaloRed pricing verified: $39.99/15m, $299.00/mo member, $399.00/mo public')));
});

// --- 4. HTML HEAD PARSER (NO FALSE POSITIVES FROM SCRIPTS OR COMMENTS) ---

test('parseHeadElements ignores title inside script and comment in head', () => {
  const htmlWithTrickyHead = `<!DOCTYPE html>
<html>
<head>
  <script>
    // <title>Fake Script Title</title>
    const title = "<title>Another Fake Title</title>";
  </script>
  <!-- <title>Commented Out Title</title> -->
  <title>Real Authentic Title</title>
  <meta name="description" content="Real Meta Description for Testing Purpose.">
  <link rel="canonical" href="https://bestdayfitness.com/">
</head>
<body>
  <h1>Body Header</h1>
</body>
</html>`;

  const parsed = parseHeadElements(htmlWithTrickyHead);
  assert.equal(parsed.title, 'Real Authentic Title');
  assert.equal(parsed.description, 'Real Meta Description for Testing Purpose.');
  assert.equal(parsed.canonical, 'https://bestdayfitness.com/');
});

test('parseHeadElements merges multiple robots directives and integrates X-Robots-Tag header', () => {
  const htmlWithDuplicateRobots = `<!DOCTYPE html>
<html>
<head>
  <meta name="robots" content="noarchive">
  <meta name="robots" content="nofollow">
</head>
<body></body>
</html>`;

  const headers = { 'x-robots-tag': 'noindex, nosnippet' };
  const parsed = parseHeadElements(htmlWithDuplicateRobots, headers);

  assert.equal(parsed.isNoindex, true);
  assert.ok(parsed.robots.includes('noarchive'));
  assert.ok(parsed.robots.includes('nofollow'));
  assert.ok(parsed.robots.includes('header: noindex, nosnippet'));
});

// --- 5. PAGE-SPECIFIC SCOPE ---

test('buildGhlTrackingSnippet produces genuine page-specific outputs for home and consultation', () => {
  const homeSnippet = buildGhlTrackingSnippet({ pageType: 'home' });
  const consultSnippet = buildGhlTrackingSnippet({ pageType: 'consultation' });

  assert.notEqual(homeSnippet, consultSnippet);

  // Home specifics
  assert.ok(homeSnippet.includes('<link rel="canonical" href="https://bestdayfitness.com/">'));
  assert.ok(homeSnippet.includes('Private Personal Training &amp; Recovery in St. Petersburg, FL'));

  // Consultation specifics
  assert.ok(consultSnippet.includes('<link rel="canonical" href="https://bestdayfitness.com/consultation">'));
  assert.ok(consultSnippet.includes('Fitness Consultation | Best Day Fitness &amp; Wellness'));
  assert.ok(consultSnippet.includes('https://bestdayfitness.com/consultation#webpage'));
  assert.ok(consultSnippet.includes('BreadcrumbList'));
});

// --- 6. AUDIT FETCH BOUNDARY & SSRF PROTECTION ---

test('isApprovedAuditTarget restricts localhost in production mode and revalidates redirects', () => {
  // Production mode: localhost blocked
  const prodCheck = isApprovedAuditTarget('http://localhost:3000', { allowLocalTargets: false });
  assert.equal(prodCheck.ok, false);
  assert.ok(prodCheck.error.includes('Localhost targets are restricted to isolated test environments'));

  // Public domain approved
  const pubCheck = isApprovedAuditTarget('https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU');
  assert.equal(pubCheck.ok, true);

  // Malicious domain blocked
  const evilCheck = isApprovedAuditTarget('https://malicious-site.com/exploit');
  assert.equal(evilCheck.ok, false);
  assert.ok(evilCheck.error.includes('Disallowed target host'));
});

// --- 7. REAL PROVIDER RUNTIME & STREAMING SAFEGUARDS ---

test('real provider adapter handles manual redirect revalidation and blocks redirect to unapproved domain', async () => {
  const { createServer } = await import('node:http');
  const { createProviderRuntime } = await import('../lib/provider-runtime.js');

  const server = createServer((req, res) => {
    if (req.url === '/redirect-evil') {
      res.writeHead(302, { Location: 'https://evil-unapproved-site.com/steal' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><head><title>Ok</title></head><body><h1>Ok</h1></body></html>');
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const runtime = createProviderRuntime();
    runtime.setConfigured('web-audit', true);

    const persistedState = { latest: null, updatedAt: null, history: [], evidence: {} };
    const service = createWebsiteAuditService({
      state: persistedState,
      save: () => {},
      providerRuntime: runtime,
      allowLocalTargets: true,
    });

    const res = await service.run(`http://127.0.0.1:${port}/redirect-evil`);
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('Redirect blocked'));
    assert.equal(persistedState.latest.status, 'unavailable');
    assert.equal(persistedState.latest.score, null);
    assert.equal(persistedState.history.length, 1);
    assert.equal(persistedState.history[0].crawlStatus, 'unavailable');
  } finally {
    server.close();
  }
});

test('real provider adapter handles non-2xx error and records failure in history with score: null', async () => {
  const { createServer } = await import('node:http');
  const { createProviderRuntime } = await import('../lib/provider-runtime.js');

  const server = createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const runtime = createProviderRuntime();
    runtime.setConfigured('web-audit', true);

    const persistedState = { latest: null, updatedAt: null, history: [], evidence: {} };
    const service = createWebsiteAuditService({
      state: persistedState,
      save: () => {},
      providerRuntime: runtime,
      allowLocalTargets: true,
    });

    const res = await service.run(`http://127.0.0.1:${port}/broken-endpoint`);
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('HTTP 500'));
    assert.equal(persistedState.latest.status, 'unavailable');
    assert.equal(persistedState.latest.score, null);
    assert.equal(persistedState.history.length, 1);
    assert.equal(persistedState.history[0].crawlStatus, 'unavailable');
    assert.ok(persistedState.history[0].error.includes('HTTP 500'));
  } finally {
    server.close();
  }
});

test('real provider adapter enforces streaming byte limit on Web ReadableStream and cancels stream', async () => {
  const { createServer } = await import('node:http');
  const { createProviderRuntime } = await import('../lib/provider-runtime.js');

  const oneMbChunk = Buffer.alloc(1024 * 1024, 'a');
  let clientAborted = false;

  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    req.on('close', () => { clientAborted = true; });
    for (let i = 0; i < 27; i++) {
      res.write(oneMbChunk);
    }
    res.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const runtime = createProviderRuntime();
    runtime.setConfigured('web-audit', true);

    const persistedState = { latest: null, updatedAt: null, history: [], evidence: {} };
    const service = createWebsiteAuditService({
      state: persistedState,
      save: () => {},
      providerRuntime: runtime,
      allowLocalTargets: true,
    });

    const res = await service.run(`http://127.0.0.1:${port}/large-stream`);
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('exceeded maximum allowed response limit') || res.error.includes('streaming'));
    assert.equal(persistedState.latest.status, 'unavailable');
    assert.equal(persistedState.latest.score, null);
    assert.equal(persistedState.history.length, 1);
  } finally {
    server.close();
  }
});
