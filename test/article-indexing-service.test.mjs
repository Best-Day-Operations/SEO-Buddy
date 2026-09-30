import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  LEGACY_BLOG_PATH,
  createArticleIndexingService,
  normalizeBlogPathPrefix,
} = require('../lib/article-indexing-service');

function unavailable(provider, message) {
  const error = new Error(message);
  error.code = 'INTEGRATION_UNAVAILABLE';
  error.provider = provider;
  return error;
}

function fixture(overrides = {}) {
  const history = [];
  const logs = { log: [], error: [] };
  const calls = { publish: [], save: 0, formatted: [] };
  const service = createArticleIndexingService({
    getGoogleAuth: () => ({ account: 'test' }),
    createIndexingClient: auth => ({ auth, kind: 'indexing' }),
    publishIndexNotification: async (...args) => {
      calls.publish.push(args);
      return { data: { urlNotificationMetadata: { url: args[1].requestBody.url } } };
    },
    getSearchConsoleProperty: () => 'sc-domain:example.test',
    getBlogPathPrefix: () => '/post',
    getHistory: () => history,
    saveHistory: () => { calls.save++; },
    allowMockIntegrations: false,
    integrationUnavailable: unavailable,
    formatProviderError: (error, context) => {
      calls.formatted.push([error, context]);
      return { error: `Safe: ${error.message}` };
    },
    logger: {
      log: message => logs.log.push(message),
      error: message => logs.error.push(message),
    },
    ...overrides,
  });
  return { calls, history, logs, service };
}

test('live indexing preserves the exact Google request and response contract', async () => {
  const testCase = fixture();
  const result = await testCase.service.submit('https://example.test/post/guide');

  assert.deepEqual(testCase.calls.publish, [[
    { auth: { account: 'test' }, kind: 'indexing' },
    { requestBody: { url: 'https://example.test/post/guide', type: 'URL_UPDATED' } },
  ]]);
  assert.deepEqual(result, {
    success: true,
    source: 'live_indexing',
    message: 'URL submitted to Google Indexing API successfully!',
    data: { urlNotificationMetadata: { url: 'https://example.test/post/guide' } },
  });
});

test('production missing configuration fails closed while explicit development mode stays simulated', async () => {
  const live = fixture({ getGoogleAuth: () => null });
  await assert.rejects(
    live.service.submit('https://example.test/post/guide'),
    error => error.code === 'INTEGRATION_UNAVAILABLE'
      && error.provider === 'google_indexing'
      && /not configured/.test(error.message),
  );
  assert.equal(live.calls.publish.length, 0);

  const demo = fixture({ getGoogleAuth: () => null, allowMockIntegrations: true });
  assert.deepEqual(await demo.service.submit('https://example.test/post/guide'), {
    success: true,
    source: 'mock_indexing',
    message: 'Submission simulated in Mock Mode.',
  });
  assert.equal(demo.calls.publish.length, 0);
});

test('permission failures keep the owner guidance and other failures use the safe provider boundary', () => {
  const testCase = fixture();
  const permission = testCase.service.explainError('Permission denied: ownership failed');
  assert.match(permission, /verified OWNER/);
  assert.match(permission, /client_email/);
  assert.match(permission, /sc-domain:example\.test/);
  assert.equal(testCase.calls.formatted.length, 0);

  const generic = testCase.service.explainError('test-only upstream body');
  assert.equal(generic, 'Safe: test-only upstream body');
  assert.deepEqual(testCase.calls.formatted[0][1], {
    provider: 'Google Indexing',
    operation: 'The indexing request',
    setupPath: 'Settings → Your connections → Google Search Console',
  });
});

test('legacy URL migration preserves ordering, flags every repaired record, and saves once', () => {
  const testCase = fixture({ getBlogPathPrefix: () => 'articles/' });
  testCase.history.push(
    { title: 'Published', url: `https://example.test${LEGACY_BLOG_PATH}/published`, platform: 'GoHighLevel (Published)' },
    { title: 'Draft', url: `https://example.test${LEGACY_BLOG_PATH}/draft`, platform: 'GoHighLevel (draft)' },
    { title: 'Current', url: 'https://example.test/post/current', platform: 'GoHighLevel (Published)' },
  );

  assert.equal(testCase.service.migrateStalePostUrls(), 2);
  assert.equal(testCase.history[0].url, 'https://example.test/articles/published');
  assert.equal(testCase.history[1].url, 'https://example.test/articles/draft');
  assert.equal(testCase.history[0].needsReindex, true);
  assert.equal(testCase.history[1].needsReindex, true);
  assert.equal(testCase.history[2].needsReindex, undefined);
  assert.equal(testCase.calls.save, 1);
  assert.deepEqual(testCase.history.map(entry => entry.title), ['Published', 'Draft', 'Current']);
  assert.equal(testCase.logs.log[0], '[URL Migration] Rewrote 2 stale blog URL(s): /blog/posts/ -> /articles/');
});

test('migration is idempotent and respects an explicitly retained legacy prefix', () => {
  const retained = fixture({ getBlogPathPrefix: () => '/blog/posts' });
  retained.history.push({ url: 'https://example.test/blog/posts/guide' });
  assert.equal(retained.service.migrateStalePostUrls(), 0);
  assert.equal(retained.calls.save, 0);

  const current = fixture();
  current.history.push({ url: 'https://example.test/post/guide' });
  assert.equal(current.service.migrateStalePostUrls(), 0);
  assert.equal(current.calls.save, 0);
});

test('repair recovery reindexes published records, clears attempted flags, and keeps drafts pending', async () => {
  const indexed = [];
  const testCase = fixture({
    publishIndexNotification: async (client, request) => {
      const url = request.requestBody.url;
      indexed.push(url);
      if (url.endsWith('/failed')) throw new Error('Permission denied');
      return { data: { ok: true } };
    },
  });
  testCase.history.push(
    { url: 'https://example.test/post/good', platform: 'GoHighLevel (Published)', needsReindex: true, indexed: 'Repair Needed' },
    { url: 'https://example.test/post/failed', platform: 'GoHighLevel (Published)', needsReindex: true, indexed: 'Repair Needed' },
    { url: 'https://example.test/post/draft', platform: 'GoHighLevel (draft)', needsReindex: true, indexed: 'Repair Needed' },
  );

  assert.equal(await testCase.service.reindexRepairedPosts(), 2);
  assert.deepEqual(indexed, ['https://example.test/post/good', 'https://example.test/post/failed']);
  assert.equal(testCase.history[0].indexed, 'Indexing Requested');
  assert.equal(testCase.history[0].needsReindex, undefined);
  assert.equal(testCase.history[1].indexed, 'Repair Needed');
  assert.equal(testCase.history[1].needsReindex, undefined);
  assert.equal(testCase.history[2].needsReindex, true);
  assert.equal(testCase.calls.save, 1);
  assert.match(testCase.logs.error[0], /Re-index failed.*verified OWNER/);
});

test('path normalization and dependency validation are deterministic', () => {
  assert.equal(normalizeBlogPathPrefix('articles///'), '/articles');
  assert.equal(normalizeBlogPathPrefix(''), '/post');
  assert.equal(normalizeBlogPathPrefix('/blog/posts'), '/blog/posts');
  assert.throws(() => createArticleIndexingService({}), /getGoogleAuth is required/);
});

test('indexing submission distinguishes qualifying schema and rejects non-qualifying when strict', async () => {
  const testCase = fixture();
  const res = await testCase.service.submit('https://example.test/jobs/trainer', { schemaType: 'JobPosting' });
  assert.equal(res.qualifyingSchema, true);

  await assert.rejects(
    testCase.service.submit('https://example.test/post/guide', { schemaType: 'BlogPosting', strictEligibility: true }),
    /only accepts JobPosting or BroadcastEvent/,
  );
});
