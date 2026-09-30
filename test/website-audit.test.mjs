import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  APPROVED_FACTS,
  buildGhlSchemaGraph,
  buildGhlTrackingSnippet,
  validateSchema,
} = require('../lib/ghl-schema-service.js');

const {
  DEFAULT_AUDIT_TARGETS,
  parseHtmlMetadata,
  evaluateWebsiteAudit,
  createWebsiteAuditService,
} = require('../lib/website-audit-service.js');

test('ghl-schema-service generates valid Schema.org graph matching approved facts', () => {
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

  // Verify approved hours
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

  // Verify HaloRed pricing & hours
  const halored = schema['@graph'].find(e => e['@id'] === 'https://bestdayfitness.com/#service-halored');
  assert.ok(halored);
  assert.equal(halored.offers.length, 3);
  assert.equal(halored.offers[0].price, '39.99');
  assert.equal(halored.offers[1].price, '299.00');
  assert.equal(halored.offers[2].price, '399.00');

  // Verify reviews observation
  assert.equal(business.aggregateRating.ratingValue, '5.0');
  assert.equal(business.aggregateRating.reviewCount, '121');

  // Validation function passes
  const validRes = validateSchema(schema);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.issues.length, 0);
});

test('ghl-schema-service catches schema regressions and conflicting hours', () => {
  const badSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'LocalBusiness',
        name: 'Best Day Fitness',
        telephone: '+1-727-334-1472',
        address: { streetAddress: '6619 1st Ave S' },
        openingHoursSpecification: [
          {
            dayOfWeek: ['Monday', 'Saturday'],
            opens: '06:00', // Regression!
            closes: '19:00',
          },
        ],
      },
    ],
  };

  const res = validateSchema(badSchema);
  assert.equal(res.valid, false);
  assert.ok(res.issues.some(i => i.includes('04:00 to 22:00')));
});

test('ghl-schema-service produces ready-to-paste GHL tracking snippet', () => {
  const snippet = buildGhlTrackingSnippet({ domain: 'https://bestdayfitness.com' });
  assert.ok(snippet.includes('<title>'));
  assert.ok(snippet.includes('<meta name="description"'));
  assert.ok(snippet.includes('<link rel="canonical" href="https://bestdayfitness.com/">'));
  assert.ok(snippet.includes('<meta property="og:title"'));
  assert.ok(snippet.includes('<script type="application/ld+json">'));
  assert.ok(snippet.includes('Best Day Fitness & Wellness'));
});

test('parseHtmlMetadata correctly extracts tags and detects oversized GHL builder bloat', () => {
  const mockGhlHtml = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex">
    <meta property="og:type" content="website">
  </head><body>
    <h1>Best Day Fitness</h1>
    <script>/* inlined script */</script>
    <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">
  </body></html>`;

  // Simulate 20MB payload
  const fake20Mb = 20413641;
  const meta = parseHtmlMetadata(mockGhlHtml, fake20Mb);

  assert.equal(meta.title, '');
  assert.equal(meta.description, '');
  assert.equal(meta.canonical, '');
  assert.equal(meta.robots, 'noindex');
  assert.equal(meta.schemaBlocks.length, 0);
  assert.equal(meta.headings.h1Count, 1);
  assert.equal(meta.assets.base64Count, 1);
  assert.equal(meta.bytes, fake20Mb);
});

test('evaluateWebsiteAudit generates truthful baseline findings and recommendations on raw GHL preview', () => {
  const rawGhlMeta = {
    bytes: 20413641,
    title: '',
    description: '',
    canonical: '',
    robots: 'noindex',
    og: { title: '', description: '', image: '' },
    schemaBlocks: [],
    headings: { h1Count: 1, h1Texts: ['Best Day Fitness'], h2Count: 4, h3Count: 6 },
    assets: { scriptTagCount: 7, scriptBytes: 10553145, base64Count: 24 },
    phoneFound: true,
    addressFound: true,
  };

  const audit = evaluateWebsiteAudit(DEFAULT_AUDIT_TARGETS.preview, rawGhlMeta);

  assert.equal(audit.success, true);
  assert.equal(audit.checks.isStaging, true);
  assert.equal(audit.checks.crawlability.status, 'PROTECTED_STAGING');
  assert.equal(audit.checks.structuredData.blockCount, 0);
  assert.equal(audit.checks.performance.isOversized, true);
  assert.ok(audit.checks.performance.warning.includes('Payload exceeds 10MB parser limit'));

  // Actionable recommendations generated
  assert.ok(audit.recommendations.some(r => r.area === 'Structured Data' && r.priority === 'CRITICAL'));
  assert.ok(audit.recommendations.some(r => r.area === 'Metadata' && r.priority === 'HIGH'));
  assert.ok(audit.recommendations.some(r => r.area === 'Canonicals' && r.priority === 'HIGH'));
  assert.ok(audit.recommendations.some(r => r.area === 'Performance & Crawlability'));
});

test('createWebsiteAuditService manages runs, stores history, and handles errors truthfully', async () => {
  const state = { latest: null, updatedAt: null, history: [] };
  let saves = 0;

  const validHtml = `<!DOCTYPE html><html><head>
    <title>Best Day Fitness &amp; Wellness</title>
    <meta name="description" content="One team, one plan: personal training for adults 50+ in St. Petersburg, FL.">
    <link rel="canonical" href="https://bestdayfitness.com/">
    <meta name="robots" content="noindex">
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "HealthClub",
      "name": "Best Day Fitness & Wellness",
      "telephone": "+1-727-334-1472",
      "address": { "@type": "PostalAddress", "streetAddress": "6619 1st Ave S", "addressLocality": "St. Petersburg", "postalCode": "33707" },
      "openingHoursSpecification": [
        { "dayOfWeek": ["Monday", "Saturday"], "opens": "04:00", "closes": "22:00" },
        { "dayOfWeek": ["Sunday"], "opens": "09:00", "closes": "17:00" }
      ]
    }
    </script>
  </head><body><h1>Best Day Fitness &amp; Wellness</h1><p>Call (727) 334-1472 at 6619 1st Ave S</p></body></html>`;

  const service = createWebsiteAuditService({
    state,
    save: () => { saves += 1; },
    providerRuntime: {
      fetch: async (type, url) => {
        if (url.includes('fail-url')) throw new Error('DNS lookup timeout');
        return { text: async () => validHtml };
      },
    },
    nowIso: () => '2026-09-30T17:58:00.000Z',
  });

  const res = await service.run();
  assert.equal(res.ok, true);
  assert.equal(saves, 1);
  assert.ok(state.latest);
  assert.equal(state.latest.checks.structuredData.hasBusinessEntity, true);
  assert.equal(state.latest.checks.structuredData.hoursCompliant, true);
  assert.equal(state.history.length, 1);

  // Failure handling produces structured unavailable state
  const failRes = await service.run('https://fail-url.com');
  assert.equal(failRes.ok, false);
  assert.equal(saves, 2);
  assert.equal(state.latest.status, 'unavailable');
  assert.equal(state.latest.error, 'DNS lookup timeout');
  assert.equal(state.latest.checks.geoOptimizer.status, 'unavailable');
});
