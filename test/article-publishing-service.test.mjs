import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  GHL_POSTS_URL,
  articleSlug,
  createArticlePublishingService,
  jsonForHtml,
  validateFactualPublication,
} = require('../lib/article-publishing-service');

const AT = new Date('2026-09-09T12:00:00.000Z');

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeHttpUrl(value, fallback = '') {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : fallback;
  } catch { return fallback; }
}

function unavailable(provider, message) {
  const error = new Error(message);
  error.code = 'INTEGRATION_UNAVAILABLE';
  error.provider = provider;
  return error;
}

function fixture(overrides = {}) {
  const calls = [];
  const env = {
    GHL_LOCATION_ID: 'location-1',
    GHL_ACCESS_TOKEN: 'test-token',
    GHL_BLOG_ID: 'blog-1',
    GHL_AUTHOR_ID: 'author-1',
    GSC_SITE_URL: 'sc-domain:example.test',
    GHL_BLOG_PATH_PREFIX: 'articles/',
    GHL_AUTHOR_NAME: 'Coach <Chris>',
    GHL_AUTHOR_URL: 'https://example.test/team/chris',
    REVIEWS_URL: 'https://reviews.example.test',
  };
  const providerRuntime = {
    async fetch(...args) {
      calls.push(args);
      return { ok: true, status: 201, async json() { return { postId: 'post-1' }; } };
    },
  };
  const service = createArticlePublishingService({
    getHistory: () => [{
      keyword: 'mobility training',
      title: 'Mobility Guide',
      url: 'https://example.test/articles/mobility-guide',
    }],
    sanitizeArticleHtml: html => html.replace(/<script[\s\S]*?<\/script>/gi, ''),
    safeHttpUrl,
    escapeHtml,
    buildLocalBusinessSchema: domain => ({ '@context': 'https://schema.org', '@type': 'LocalBusiness', url: domain, marker: '</script>' }),
    getBusinessName: () => 'Best Day <Fitness>',
    providerRuntime,
    env,
    allowMockIntegrations: false,
    integrationUnavailable: unavailable,
    now: () => new Date(AT),
    ...overrides,
  });
  return { calls, env, providerRuntime, service };
}

test('live publishing preserves enrichment and the exact GoHighLevel request contract', async () => {
  const testCase = fixture();
  const content = '<script>unsafe()</script><p>[Link: Mobility]</p><strong>Q: <em>What helps?</em></strong><p>A: Balance <b>training</b>.</p>';
  const result = await testCase.service.publish('A Better Mobility Guide', content, 'published');

  assert.equal(testCase.calls.length, 1);
  const [provider, url, request, policy] = testCase.calls[0];
  assert.equal(provider, 'gohighlevel');
  assert.equal(url, GHL_POSTS_URL);
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, {
    Authorization: 'Bearer test-token',
    Version: '2021-04-15',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(policy, { retries: 0 });

  const payload = JSON.parse(request.body);
  assert.equal(payload.locationId, 'location-1');
  assert.equal(payload.blogId, 'blog-1');
  assert.equal(payload.title, 'A Better Mobility Guide');
  assert.equal(payload.status, 'PUBLISHED');
  assert.equal(payload.urlSlug, 'a-better-mobility-guide');
  assert.equal(payload.author, 'author-1');
  assert.equal(payload.publishedAt, AT.toISOString());
  assert.doesNotMatch(payload.rawHTML, /unsafe\(\)/);
  assert.match(payload.rawHTML, /href="https:\/\/example\.test\/articles\/mobility-guide"/);
  assert.match(payload.rawHTML, /"@type": "FAQPage"/);
  assert.match(payload.rawHTML, /"name": "What helps\?"/);
  assert.match(payload.rawHTML, /"text": "Balance training\."/);
  assert.match(payload.rawHTML, /"@type": "LocalBusiness"/);
  assert.match(payload.rawHTML, /\\u003c\/script>/);
  assert.match(payload.rawHTML, /"@type": "BlogPosting"/);
  assert.match(payload.rawHTML, /Coach &lt;Chris&gt;/);
  assert.match(payload.rawHTML, /Read Best Day &lt;Fitness&gt; reviews/);

  assert.deepEqual(result, {
    success: true,
    source: 'live_ghl',
    postId: 'post-1',
    url: 'https://example.test/articles/a-better-mobility-guide',
    content: payload.rawHTML,
    message: 'Article successfully published to GoHighLevel!',
  });
});

test('unmatched links, default author, and response URL preserve fallback behavior', async () => {
  const calls = [];
  const { service } = fixture({
    env: {
      GHL_LOCATION_ID: 'location-1', GHL_ACCESS_TOKEN: 'token', GHL_BLOG_ID: 'blog-1',
      GSC_SITE_URL: 'https://example.test/root/', GHL_BLOG_PATH_PREFIX: '/post',
    },
    getHistory: () => [],
    providerRuntime: {
      async fetch(...args) {
        calls.push(args);
        return { ok: true, async json() { return { id: 'post-2', url: 'https://published.example/post-2' }; } };
      },
    },
  });
  const result = await service.publish('Title', '[Link: Missing Page]', undefined);
  const payload = JSON.parse(calls[0][2].body);
  assert.match(payload.rawHTML, /href="https:\/\/example\.test\/root\/post"/);
  assert.equal(Object.hasOwn(payload, 'author'), false);
  assert.doesNotMatch(payload.rawHTML, /BlogPosting|article-author-card/);
  assert.equal(result.url, 'https://published.example/post-2');
  assert.equal(payload.status, 'DRAFT');
});

test('production rejects incomplete GoHighLevel configuration without a provider write', async () => {
  const testCase = fixture({ env: {}, allowMockIntegrations: false });
  await assert.rejects(
    testCase.service.publish('Title', '<p>Body</p>', 'draft'),
    error => error.code === 'INTEGRATION_UNAVAILABLE'
      && error.provider === 'gohighlevel'
      && /GHL_ACCESS_TOKEN, GHL_LOCATION_ID, and GHL_BLOG_ID/.test(error.message),
  );
  assert.equal(testCase.calls.length, 0);
});

test('explicit development mode returns enriched mock output with the existing shape', async () => {
  const testCase = fixture({
    env: { GSC_SITE_URL: 'sc-domain:example.test', REVIEWS_URL: 'javascript:bad' },
    allowMockIntegrations: true,
  });
  const result = await testCase.service.publish('Mock Title', '<p>Body</p>', 'draft');
  assert.equal(testCase.calls.length, 0);
  assert.equal(result.source, 'mock_ghl');
  assert.equal(result.postId, `mock-post-${AT.getTime()}`);
  assert.equal(result.url, 'https://example.test/post/mock-title');
  assert.match(result.content, /LocalBusiness/);
  assert.doesNotMatch(result.content, /Curious what our clients say/);
  assert.equal(result.message, 'Article saved in mock mode. Setup GHL keys to go live!');
});

test('GoHighLevel error messages and HTTP fallback remain unchanged', async () => {
  await assert.rejects(
    fixture({
      providerRuntime: { fetch: async () => ({ ok: false, status: 422, json: async () => ({ message: 'test-only invalid post' }) }) },
    }).service.publish('Title', '<p>Body</p>', 'draft'),
    /test-only invalid post/,
  );
  await assert.rejects(
    fixture({
      providerRuntime: { fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) },
    }).service.publish('Title', '<p>Body</p>', 'draft'),
    /GHL HTTP error! status: 503/,
  );
});

test('publishing helpers are deterministic and dependency wiring fails fast', () => {
  assert.equal(articleSlug(' Mobility & Balance! '), 'mobility-balance');
  assert.equal(jsonForHtml({ value: '</script>' }).includes('<'), false);
  assert.throws(() => createArticlePublishingService({}), /getHistory is required/);
});

test('factual publication validation rejects prohibited claims, incorrect durations, and non-$99 pricing', async () => {
  const testCase = fixture();

  // Prohibited claim: medical-grade
  await assert.rejects(
    () => testCase.service.publish('HaloRed Light', '<p>Uses medical-grade LEDs.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('medical-grade'),
  );

  // Prohibited claim: cures
  await assert.rejects(
    () => testCase.service.publish('Relief Guide', '<p>Our program cures arthritis naturally.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('cure'),
  );

  // Prohibited claim: semi-private / group
  await assert.rejects(
    () => testCase.service.publish('Personal Training', '<p>Try our semi-private training sessions.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('1-on-1 private training'),
  );

  // Incorrect duration: 60-minute
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Book a 60-minute consultation today.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('45 minutes'),
  );

  // Free consultation claim
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Schedule your free consultation now.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('$99 fee'),
  );

  // Non-$99 price
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Book your $150 consultation today.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('$99'),
  );

  // Valid claims pass cleanly
  const validResult = await testCase.service.publish(
    'Longevity Fitness',
    '<p>Book a 45-minute consultation for $99 with 1-on-1 private training.</p>',
    'draft',
  );
  assert.equal(validResult.success, true);
});

test('author bio removes unverified default tagline unless explicitly configured', async () => {
  // Without author bio configured: no unverified tagline
  const noBioCase = fixture();
  const noBioResult = await noBioCase.service.publish('Longevity Training', '<p>Body text.</p>', 'draft');
  assert.doesNotMatch(noBioResult.content, /Certified longevity, mobility, and functional movement specialist/);

  // With author bio explicitly configured via config
  const withBioCase = fixture();
  const withBioResult = await withBioCase.service.publish(
    'Longevity Training',
    '<p>Body text.</p>',
    'draft',
    { authorBio: 'NASM Certified Personal Trainer with 10+ years experience.' },
  );
  assert.match(withBioResult.content, /NASM Certified Personal Trainer with 10\+ years experience\./);

  // With author bio explicitly configured via env
  const envBioCase = fixture({
    env: {
      ...fixture().env,
      GHL_AUTHOR_BIO: 'Expert Fitness Coach at Best Day Fitness.',
    },
  });
  const envBioResult = await envBioCase.service.publish('Longevity Training', '<p>Body text.</p>', 'draft');
  assert.match(envBioResult.content, /Expert Fitness Coach at Best Day Fitness\./);
});

test('service-specific factual validation disentangles consultation duration from personal training duration', async () => {
  const testCase = fixture();

  // "Your consultation lasts 60 minutes" must fail
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Your consultation lasts 60 minutes.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('45 minutes'),
  );

  // "Consultations cost $150" must fail
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Consultations cost $150.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('$99'),
  );

  // "Personal training sessions are normally 60 minutes, with 30-minute sessions available" must pass cleanly
  const ptResult = await testCase.service.publish(
    'Private Personal Training',
    '<p>Personal training sessions are normally 60 minutes, with 30-minute sessions available. We offer 1-on-1 private training.</p>',
    'draft',
  );
  assert.equal(ptResult.success, true);

  // Combined accurate statement passes cleanly
  const combinedResult = await testCase.service.publish(
    'Comprehensive Fitness Program',
    '<p>Schedule your 45-minute consultation for $99. Our personal training sessions are normally 60 minutes, with 30-minute sessions available.</p>',
    'draft',
  );
  assert.equal(combinedResult.success, true);
});

test('factual validation rejects prohibited claims or invalid facts inside author bio or injected schema', async () => {
  const testCase = fixture();

  // Prohibited claim inside authorBio
  await assert.rejects(
    () => testCase.service.publish(
      'Clean Body Title',
      '<p>Our trainers provide 1-on-1 private training.</p>',
      'draft',
      { authorBio: 'Senior trainer who cures chronic back pain through movement.' },
    ),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('cure'),
  );

  // Prohibited duration inside authorBio
  await assert.rejects(
    () => testCase.service.publish(
      'Clean Body Title',
      '<p>Our trainers provide 1-on-1 private training.</p>',
      'draft',
      { authorBio: 'Schedule an initial 60-minute consultation with me.' },
    ),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('45 minutes'),
  );

  // Prohibited claim inside custom injected schema via buildLocalBusinessSchema override
  const schemaTestCase = fixture({
    buildLocalBusinessSchema: domain => ({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      description: 'We offer semi-private training classes for everyone.',
      url: domain,
    }),
  });
  await assert.rejects(
    () => schemaTestCase.service.publish('Clean Body Title', '<p>Healthy living tips.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('1-on-1 private training'),
  );
});

test('consultation pricing validation strictly rejects $200 current price and fractional prices while allowing approved $99 normally $200 wording', async () => {
  const testCase = fixture();

  // "Consultation costs $200" must fail (it is claiming current price is $200)
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Consultation costs $200.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('$99'),
  );

  // "Consultation fee is $200" must fail
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Our consultation fee is $200.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('$99'),
  );

  // "Consultation costs $99.95" must fail (must be exact $99)
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Consultation costs $99.95.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('$99'),
  );

  // "Consultations cost $99.50" must fail
  await assert.rejects(
    () => testCase.service.publish('Getting Started', '<p>Consultations cost $99.50.</p>', 'draft'),
    error => error.code === 'FACTUAL_VALIDATION_FAILED' && error.message.includes('$99'),
  );

  // Approved wording: $99, normally $200 must pass cleanly
  const approvedWording1 = await testCase.service.publish(
    'Getting Started',
    '<p>Book a 45-minute consultation for $99 (normally $200). 1-on-1 private training.</p>',
    'draft',
  );
  assert.equal(approvedWording1.success, true);

  // Approved wording: $99 (regularly $200 value) must pass cleanly
  const approvedWording2 = await testCase.service.publish(
    'Getting Started',
    '<p>Consultations are $99, regularly a $200 value. 1-on-1 private training.</p>',
    'draft',
  );
  assert.equal(approvedWording2.success, true);

  // Personal training 60-minute and 30-minute descriptions remain completely unaffected
  const ptWording = await testCase.service.publish(
    'Personal Training Options',
    '<p>Personal training sessions are normally 60 minutes, with 30-minute sessions available. We offer 1-on-1 private training.</p>',
    'draft',
  );
  assert.equal(ptWording.success, true);
});


