import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_AI_CRAWLERS,
  createAiCrawlerService,
  crawlerVerdict,
  parseRobots,
} = require('../lib/ai-crawler-service.js');

function makeService(responseFactory, overrides = {}) {
  const state = { latest: null, updatedAt: null };
  const calls = [];
  let saves = 0;
  const service = createAiCrawlerService({
    state,
    save: () => { saves += 1; },
    getSiteDomain: () => 'https://bestdayfitness.com',
    providerRuntime: {
      fetch: async (...args) => {
        calls.push(args);
        return responseFactory();
      },
    },
    crawlers: [
      { ua: 'GPTBot', label: 'GPTBot', purpose: 'OpenAI' },
      { ua: 'CCBot', label: 'CCBot', purpose: 'Common Crawl' },
    ],
    nowIso: () => '2026-09-08T16:00:00.000Z',
    ...overrides,
  });
  return { service, state, calls, saves: () => saves };
}

test('crawler catalog and robots parsing preserve specific and wildcard verdicts', () => {
  assert.equal(DEFAULT_AI_CRAWLERS.length, 11);
  assert.deepEqual(DEFAULT_AI_CRAWLERS.slice(0, 3).map(bot => bot.ua), ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User']);
  const groups = parseRobots(`# comment
User-agent: GPTBot
Disallow: /

User-agent: *
Disallow: /private # inline comment
`);
  assert.equal(groups.length, 2);
  assert.deepEqual(crawlerVerdict(groups, 'GPTBot'), { status: 'blocked', reason: 'Disallow: /', matchedBy: 'specific rule' });
  assert.deepEqual(crawlerVerdict(groups, 'CCBot'), { status: 'allowed', reason: 'allowed (some paths blocked)', matchedBy: 'the * (all bots) rule' });
  assert.deepEqual(crawlerVerdict([], 'CCBot'), { status: 'allowed', reason: 'not restricted', matchedBy: 'no matching rule' });
  assert.deepEqual(crawlerVerdict(parseRobots('User-agent: *\nDisallow: /\nAllow: /'), 'CCBot'), {
    status: 'allowed', reason: 'allowed', matchedBy: 'the * (all bots) rule',
  });
});

test('crawler audit preserves provider policy, bot results, and saved snapshot fields', async () => {
  const robots = `User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow: /private\n${'x'.repeat(1600)}`;
  const { service, state, calls, saves } = makeService(() => ({ ok: true, status: 200, text: async () => robots }));

  const { snapshot } = await service.run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'web-audit');
  assert.equal(calls[0][1], 'https://bestdayfitness.com/robots.txt');
  assert.deepEqual(calls[0][2], { headers: { 'User-Agent': 'SEO-Buddy-AI-Readiness/1.0' } });
  assert.deepEqual(calls[0][3], { throwOnHttpError: false, retries: 1, policy: { timeoutMs: 15000 } });
  assert.equal(snapshot.ranAt, '2026-09-08T16:00:00.000Z');
  assert.equal(snapshot.site, 'https://bestdayfitness.com');
  assert.equal(snapshot.hadRobots, true);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.fetchError, '');
  assert.equal(snapshot.blocked, 1);
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.robotsSnippet.length, 1500);
  assert.equal(snapshot.bots[0].status, 'blocked');
  assert.equal(snapshot.bots[1].status, 'allowed');
  assert.equal(state.latest, snapshot);
  assert.equal(state.updatedAt, snapshot.ranAt);
  assert.equal(saves(), 1);
});

test('missing robots response remains open evidence rather than a fabricated failure', async () => {
  const { service } = makeService(() => ({ ok: false, status: 404, text: async () => { throw new Error('must not read'); } }));
  const { snapshot } = await service.run();
  assert.equal(snapshot.hadRobots, false);
  assert.equal(snapshot.status, 404);
  assert.equal(snapshot.fetchError, '');
  assert.equal(snapshot.blocked, 0);
  assert.ok(snapshot.bots.every(bot => bot.reason === 'no robots.txt found (site is open to all)'));
});

test('crawler provider failures are safe and still produce the established saved audit', async () => {
  const raw = 'upstream said Authorization: Bearer secret-token';
  const { service, state, saves } = makeService(() => { throw new Error(raw); });
  const { snapshot } = await service.run();
  assert.equal(snapshot.hadRobots, false);
  assert.equal(snapshot.status, 0);
  assert.ok(snapshot.fetchError);
  assert.doesNotMatch(snapshot.fetchError, /secret-token|Authorization|upstream said/i);
  assert.equal(snapshot.blocked, 0);
  assert.ok(snapshot.bots.every(bot => bot.status === 'unknown'));
  assert.equal(state.latest, snapshot);
  assert.equal(saves(), 1);
});
