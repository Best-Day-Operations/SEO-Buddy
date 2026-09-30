import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  APPROVED_FACTS,
  ALL_DAYS_OF_WEEK,
  buildBusinessIdentitySchema,
  buildPageMetadataAndSchema,
  buildGhlSchemaGraph,
  buildGhlTrackingSnippet,
  validateSchema,
} = require('../lib/ghl-schema-service.js');

const {
  DEFAULT_AUDIT_TARGETS,
  APPROVED_AUDIT_DOMAINS,
  isApprovedAuditTarget,
  normalizeUrlForMatch,
  parseHtmlMetadata,
  evaluateWebsiteAudit,
  createWebsiteAuditService,
} = require('../lib/website-audit-service.js');

test('ghl-schema-service generates valid Schema.org graph matching approved facts without 404 images or aggregateRating', () => {
  const schema = buildGhlSchemaGraph({ domain: 'https://bestdayfitness.com' });
  assert.equal(schema['@context'], 'https://schema.org');
  assert.ok(Array.isArray(schema['@graph']));
  assert.equal(schema['@graph'].length, 8);

  const business = schema['@graph'].find(e => e['@id'] === 'https://bestdayfitness.com/#business');
  assert.ok(business);
  assert.equal(business.name, 'Best Day Fitness & Wellness');
  assert.equal(business.telephone, '+1-727-334-1472');
  assert.equal(business.address.streetAddress, '6619 1st Ave S');
  assert.equal(business.address.addressLocality, 'St. Petersburg');
  assert.equal(business.address.postalCode, '33707');

  // Verify 404 images are omitted
  assert.equal(business.logo, undefined);
  assert.equal(business.image, undefined);

  // Verify self-serving aggregateRating is omitted from LocalBusiness
  assert.equal(business.aggregateRating, undefined);

  // Verify approved hours across all 7 days
  const monSat = business.openingHoursSpecification.find(h =>
    h.dayOfWeek.includes('Monday') && h.dayOfWeek.includes('Saturday')
  );
  assert.ok(monSat);
  assert.equal(monSat.opens, '04:00');
  assert.equal(monSat.closes, '22:00');

  const sun = business.openingHoursSpecification.find(h => h.dayOfWeek.includes('Sunday'));
  assert.ok(sun);
  assert.equal(sun.opens, '09:00');
  assert.equal(sun.closes, '17:00');

  // Verify consultation pricing & details
  const consultation = schema['@graph'].find(e => e['@id'] === 'https://bestdayfitness.com/#service-consultation');
  assert.ok(consultation);
  assert.equal(consultation.offers.price, '99.00');
  assert.ok(consultation.description.includes('45-minute'));
  assert.ok(consultation.description.includes('Client Experience Team'));

  // Substantive 4-tier validation passes cleanly
  const res = validateSchema(schema);
  assert.equal(res.valid, true);
  assert.equal(res.categories.jsonSyntax.pass, true);
  assert.equal(res.categories.approvedFacts.pass, true);
  assert.equal(res.categories.schemaOrgVocabulary.pass, true);
  assert.equal(res.categories.googleFeatureEligibility.eligible, true);
  assert.equal(res.allIssues.length, 0);
  assert.ok(res.categories.approvedFacts.verifiedFacts.length >= 3);
});

test('validateSchema rejects invalid schemas: 999 Wrong Street, +1-000-000-0000, and partial days', () => {
  // Case A: 999 Wrong Street
  const wrongAddressSchema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Best Day Fitness & Wellness',
    telephone: '+1-727-334-1472',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '999 Wrong Street',
      addressLocality: 'St. Petersburg',
      addressRegion: 'FL',
      postalCode: '33707',
    },
    openingHoursSpecification: [
      { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '04:00', closes: '22:00' },
      { dayOfWeek: ['Sunday'], opens: '09:00', closes: '17:00' },
    ],
  };
  const resAddr = validateSchema(wrongAddressSchema);
  assert.equal(resAddr.valid, false);
  assert.equal(resAddr.categories.approvedFacts.pass, false);
  assert.ok(resAddr.categories.approvedFacts.issues.some(i => i.includes('Street address mismatch')));

  // Case B: +1-000-000-0000
  const wrongPhoneSchema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Best Day Fitness & Wellness',
    telephone: '+1-000-000-0000',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '6619 1st Ave S',
      addressLocality: 'St. Petersburg',
      addressRegion: 'FL',
      postalCode: '33707',
    },
    openingHoursSpecification: [
      { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '04:00', closes: '22:00' },
      { dayOfWeek: ['Sunday'], opens: '09:00', closes: '17:00' },
    ],
  };
  const resPhone = validateSchema(wrongPhoneSchema);
  assert.equal(resPhone.valid, false);
  assert.equal(resPhone.categories.approvedFacts.pass, false);
  assert.ok(resPhone.categories.approvedFacts.issues.some(i => i.includes('Telephone mismatch')));

  // Case C: Partial days (Monday & Saturday only, missing Tuesday, Wednesday, Thursday, Friday, Sunday)
  const partialDaysSchema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Best Day Fitness & Wellness',
    telephone: '+1-727-334-1472',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '6619 1st Ave S',
      addressLocality: 'St. Petersburg',
      addressRegion: 'FL',
      postalCode: '33707',
    },
    openingHoursSpecification: [
      { dayOfWeek: ['Monday', 'Saturday'], opens: '04:00', closes: '22:00' },
    ],
  };
  const resDays = validateSchema(partialDaysSchema);
  assert.equal(resDays.valid, false);
  assert.equal(resDays.categories.approvedFacts.pass, false);
  assert.ok(resDays.categories.approvedFacts.issues.some(i => i.includes('Missing opening hours specifications for days: Tuesday, Wednesday, Thursday, Friday, Sunday')));

  // Case D: Conflicting duplicate opening hours for Monday
  const conflictSchema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Best Day Fitness & Wellness',
    telephone: '+1-727-334-1472',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '6619 1st Ave S',
      addressLocality: 'St. Petersburg',
      addressRegion: 'FL',
      postalCode: '33707',
    },
    openingHoursSpecification: [
      { dayOfWeek: ['Monday'], opens: '04:00', closes: '22:00' },
      { dayOfWeek: ['Monday'], opens: '08:00', closes: '16:00' },
      { dayOfWeek: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '04:00', closes: '22:00' },
      { dayOfWeek: ['Sunday'], opens: '09:00', closes: '17:00' },
    ],
  };
  const resConflict = validateSchema(conflictSchema);
  assert.equal(resConflict.valid, false);
  assert.ok(resConflict.categories.approvedFacts.issues.some(i => i.includes('Conflicting duplicate opening hours for Monday')));
});

test('validateSchema flags Google self-serving review policy and 404 images warnings', () => {
  const schemaWithSelfServingReview = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'HealthClub',
        name: 'Best Day Fitness & Wellness',
        telephone: '+1-727-334-1472',
        logo: 'https://bestdayfitness.com/assets/images/logo.png', // 404 image
        address: {
          '@type': 'PostalAddress',
          streetAddress: '6619 1st Ave S',
          addressLocality: 'St. Petersburg',
          addressRegion: 'FL',
          postalCode: '33707',
        },
        openingHoursSpecification: [
          { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '04:00', closes: '22:00' },
          { dayOfWeek: ['Sunday'], opens: '09:00', closes: '17:00' },
        ],
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '5.0',
          reviewCount: '121',
        },
      },
    ],
  };

  const res = validateSchema(schemaWithSelfServingReview);
  assert.ok(res.categories.googleFeatureEligibility.warnings.some(w => w.includes('Self-Serving Review Policy')));
  assert.ok(res.categories.googleFeatureEligibility.warnings.some(w => w.includes('logo.png')));
  assert.ok(res.categories.googleFeatureEligibility.limitations.length >= 2);
});

test('parseHtmlMetadata strictly extracts head tags, strips scripts from visible content, and tracks malformed JSON-LD', () => {
  const mockHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Real Head Title</title>
  <meta name="description" content="Proper head meta description of sufficient length for test verification.">
  <link rel="canonical" href="https://bestdayfitness.com/">
  <meta name="robots" content="noindex, nofollow">
  <script type="application/ld+json">
    { "badJson": missingQuote }
  </script>
</head>
<body>
  <script>
    // Fake title and phone inside JS that must NOT be extracted as document metadata
    const config = { title: "Fake Script Title", phone: "999-999-9999" };
  </script>
  <h1>Visible Page Header</h1>
  <p>Visit us at 6619 1st Ave S or call (727) 334-1472.</p>
</body>
</html>`;

  const meta = parseHtmlMetadata(mockHtml);

  assert.equal(meta.title, 'Real Head Title');
  assert.equal(meta.description, 'Proper head meta description of sufficient length for test verification.');
  assert.equal(meta.canonical, 'https://bestdayfitness.com/');
  assert.equal(meta.robots, 'noindex, nofollow');
  assert.equal(meta.headings.h1Texts[0], 'Visible Page Header');
  assert.equal(meta.headings.h1Count, 1);
  assert.equal(meta.phoneFound, true);
  assert.equal(meta.addressFound, true);

  // Malformed JSON-LD tracked explicitly
  assert.equal(meta.malformedJsonLd.length, 1);
  assert.ok(meta.malformedJsonLd[0].parseError);
  assert.equal(meta.schemaBlocks.length, 1);
  assert.equal(meta.schemaBlocks[0].valid, false);
});

test('evaluateWebsiteAudit handles no GEO run truthfully: status="not_run", score=null without fallback fabrication', () => {
  const meta = {
    bytes: 50000,
    title: 'Best Day Fitness & Wellness',
    description: 'Personal training for adults 50+ in St. Petersburg, FL.',
    canonical: 'https://bestdayfitness.com/',
    robots: 'index, follow',
    og: { title: '', description: '', image: '' },
    schemaBlocks: [],
    malformedJsonLd: [],
    headings: { h1Count: 1, h1Texts: ['Best Day Fitness'], h2Count: 2, h3Count: 0 },
    assets: { scriptTagCount: 2, scriptBytes: 1000, base64Count: 0 },
    phoneFound: true,
    addressFound: true,
  };

  const audit = evaluateWebsiteAudit('https://bestdayfitness.com', meta, {
    geoEvidence: null, // NO RUN PROVIDED
  });

  assert.equal(audit.success, true);
  assert.equal(audit.checks.geoOptimizer.status, 'not_run');
  assert.equal(audit.checks.geoOptimizer.score, null);
  assert.equal(audit.score, null);
  assert.ok(audit.checks.geoOptimizer.note.includes('Fallback scores are prohibited'));
});

test('evaluateWebsiteAudit handles successful GEO evidence import preserving tool revision, timestamp, and score', () => {
  const meta = {
    bytes: 50000,
    title: 'Best Day Fitness & Wellness',
    description: 'Personal training for adults 50+ in St. Petersburg, FL.',
    canonical: 'https://bestdayfitness.com/',
    robots: 'index, follow',
    og: { title: '', description: '', image: '' },
    schemaBlocks: [],
    malformedJsonLd: [],
    headings: { h1Count: 1, h1Texts: ['Best Day Fitness'], h2Count: 2, h3Count: 0 },
    assets: { scriptTagCount: 2, scriptBytes: 1000, base64Count: 0 },
    phoneFound: true,
    addressFound: true,
  };

  const verifiedEvidence = {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.607042+00:00',
    tool: 'geo-optimizer v4.18.3',
    score: 32,
    band: 'critical',
    exitStatus: 'success',
    error: null,
    checks: {
      robots_txt: { score: 5 },
      schema_jsonld: { score: 0 },
      meta_tags: { score: 14 },
      content: { score: 13 },
    },
  };

  const audit = evaluateWebsiteAudit('https://bestdayfitness.com', meta, {
    geoEvidence: verifiedEvidence,
  });

  assert.equal(audit.success, true);
  assert.equal(audit.checks.geoOptimizer.status, 'completed');
  assert.equal(audit.checks.geoOptimizer.score, 32);
  assert.equal(audit.score, 32);
  assert.equal(audit.checks.geoOptimizer.band, 'critical');
  assert.equal(audit.checks.geoOptimizer.tool, 'geo-optimizer v4.18.3');
  assert.equal(audit.checks.geoOptimizer.runTimestamp, '2026-09-30T14:12:47.607042+00:00');
  assert.equal(audit.checks.geoOptimizer.rawSummary.meta, 14);
});

test('evaluateWebsiteAudit handles failed GEO run preserving error without guessing scores', () => {
  const meta = {
    bytes: 20413641,
    title: '',
    description: '',
    canonical: '',
    robots: 'noindex',
    og: { title: '', description: '', image: '' },
    schemaBlocks: [],
    malformedJsonLd: [],
    headings: { h1Count: 1, h1Texts: ['Best Day Fitness'], h2Count: 2, h3Count: 0 },
    assets: { scriptTagCount: 7, scriptBytes: 10553145, base64Count: 24 },
    phoneFound: true,
    addressFound: true,
  };

  const failedRunEvidence = {
    url: 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU',
    timestamp: '2026-09-30T14:12:57.528906+00:00',
    tool: 'geo-optimizer v4.18.3',
    score: 0,
    band: 'critical',
    exitStatus: 'failed',
    error: 'Response too large: 20398368 bytes (max: 10485760)',
  };

  const audit = evaluateWebsiteAudit('https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU', meta, {
    geoEvidence: failedRunEvidence,
  });

  assert.equal(audit.success, true);
  assert.equal(audit.checks.geoOptimizer.status, 'unavailable');
  assert.equal(audit.checks.geoOptimizer.score, null);
  assert.equal(audit.score, null);
  assert.equal(audit.checks.geoOptimizer.error, 'Response too large: 20398368 bytes (max: 10485760)');
});

test('evaluateWebsiteAudit rejects mismatched target evidence with evidence_target_mismatch', () => {
  const meta = {
    bytes: 50000,
    title: 'Preview',
    description: '',
    canonical: '',
    robots: 'noindex',
    og: { title: '', description: '', image: '' },
    schemaBlocks: [],
    malformedJsonLd: [],
    headings: { h1Count: 1, h1Texts: ['Preview'], h2Count: 0, h3Count: 0 },
    assets: { scriptTagCount: 1, scriptBytes: 100, base64Count: 0 },
    phoneFound: false,
    addressFound: false,
  };

  // Evidence is for production bestdayfitness.com, but target is preview link.bestdayfitness.com
  const mismatchedEvidence = {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47+00:00',
    score: 32,
  };

  const audit = evaluateWebsiteAudit('https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU', meta, {
    geoEvidence: mismatchedEvidence,
  });

  assert.equal(audit.success, true);
  assert.equal(audit.checks.geoOptimizer.status, 'evidence_target_mismatch');
  assert.equal(audit.checks.geoOptimizer.score, null);
  assert.ok(audit.checks.geoOptimizer.error.includes('Mismatched evidence rejected'));
});

test('createWebsiteAuditService enforces SSRF domain bounding', async () => {
  const state = { latest: null, updatedAt: null, history: [] };
  const service = createWebsiteAuditService({
    state,
    save: () => {},
    providerRuntime: {
      fetch: async () => ({ text: async () => '<html></html>' }),
    },
  });

  // Attempt SSRF against internal IP
  const ssrfRes = await service.run('http://169.254.169.254/latest/meta-data/');
  assert.equal(ssrfRes.ok, false);
  assert.equal(state.latest.status, 'rejected');
  assert.ok(state.latest.error.includes('Disallowed target host'));

  // Attempt audit against unapproved external domain
  const extRes = await service.run('https://evil-hacker.com/');
  assert.equal(extRes.ok, false);
  assert.equal(state.latest.status, 'rejected');
  assert.ok(state.latest.error.includes('Disallowed target host'));
});

test('createWebsiteAuditService supports repeatable importGeoEvidence and re-evaluates latest audit', async () => {
  const state = { latest: null, updatedAt: null, history: [] };
  let saveCount = 0;

  const validHtml = `<!DOCTYPE html><html><head>
    <title>Best Day Fitness &amp; Wellness | Private Personal Training</title>
    <meta name="description" content="One team, one plan: personal training for adults 50+ in St. Petersburg, FL.">
    <link rel="canonical" href="https://bestdayfitness.com/">
    <meta name="robots" content="index, follow">
  </head><body>
    <h1>Best Day Fitness &amp; Wellness</h1>
    <p>Call (727) 334-1472 at 6619 1st Ave S</p>
  </body></html>`;

  const service = createWebsiteAuditService({
    state,
    save: () => { saveCount++; },
    providerRuntime: {
      fetch: async () => ({ text: async () => validHtml }),
    },
  });

  // Step 1: Run audit initially with no GEO evidence -> status="not_run", score=null
  const runRes = await service.run('https://bestdayfitness.com');
  assert.equal(runRes.ok, true);
  assert.equal(state.latest.checks.geoOptimizer.status, 'not_run');
  assert.equal(state.latest.checks.geoOptimizer.score, null);

  // Step 2: Import verified GEO evidence for that target URL
  const importRes = service.importGeoEvidence('https://bestdayfitness.com', {
    url: 'https://bestdayfitness.com',
    timestamp: '2026-09-30T14:12:47.000Z',
    tool: 'geo-optimizer v4.18.3',
    score: 32,
    band: 'critical',
    exitStatus: 'success',
  });
  assert.equal(importRes.ok, true);

  // Re-evaluated latest audit now has status="completed", score=32
  assert.equal(state.latest.checks.geoOptimizer.status, 'completed');
  assert.equal(state.latest.checks.geoOptimizer.score, 32);
});
