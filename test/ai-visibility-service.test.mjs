import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  APPROVED_SERVICE_PROMPTS,
  PROMPT_SET_VERSION,
  DEFAULT_AI_ENGINES,
  DEFAULT_VIS_PROMPTS,
  createAiVisibilityService,
  normalizeName,
  sentimentToScore,
  visibilityPrompt,
} = require('../lib/ai-visibility-service.js');

function serviceFixture(overrides = {}) {
  const state = overrides.state || { prompts: ['query one'], snapshots: [], updatedAt: null, lastRun: null };
  const fetchCalls = [];
  let saves = 0;
  const service = createAiVisibilityService({
    state,
    save: () => { saves += 1; },
    geminiGenerate: async request => ({ text: request.config ? 'Best Day Fitness' : '{"mentioned":true,"sentiment":"positive","competitors":[]}' }),
    geminiModel: 'gemini-test',
    providerRuntime: {
      fetch: async (...args) => {
        fetchCalls.push(args);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output_text: ' provider answer ',
            choices: [{ message: { content: ' provider answer ' } }],
            citations: ['https://source.example'],
          }),
        };
      },
    },
    parseJson: JSON.parse,
    brandName: () => 'Best Day Fitness',
    meterUsage: () => {},
    env: {},
    nowIso: () => '2026-09-08T14:00:00.000Z',
    ...overrides,
    state,
  });
  return { service, state, fetchCalls, saves: () => saves };
}

test('AI visibility helpers preserve the public engine catalog and scoring rules', () => {
  assert.deepEqual(DEFAULT_AI_ENGINES.map(engine => engine.id), ['google', 'openai', 'perplexity']);
  assert.equal(DEFAULT_VIS_PROMPTS.length, 5);
  assert.equal(normalizeName('  Best-Day Fitness! '), 'best day fitness');
  assert.deepEqual(['positive', 'neutral', 'negative', 'absent'].map(sentimentToScore), [100, 50, 0, 50]);
  assert.match(visibilityPrompt('senior fitness'), /senior fitness/);
});

test('AI visibility provider adapters preserve request and response contracts', async () => {
  const geminiCalls = [];
  const { service, fetchCalls } = serviceFixture({
    env: { GEMINI_API_KEY: 'gemini-secret', OPENAI_API_KEY: 'openai-secret', PERPLEXITY_API_KEY: 'pplx-secret' },
    openAiModel: 'openai-test',
    perplexityModel: 'pplx-test',
    geminiGenerate: async request => {
      geminiCalls.push(request);
      return {
        text: ' Google answer ',
        candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: 'Source', uri: 'https://google.example' } }] } }],
      };
    },
  });

  assert.deepEqual(service.enginesStatus().map(engine => engine.configured), [true, true, true]);
  assert.deepEqual(await service.askEngine('google', 'prompt'), {
    ok: true,
    answer: 'Google answer',
    sources: [{ title: 'Source', uri: 'https://google.example' }],
  });
  assert.equal(geminiCalls[0].model, 'gemini-test');
  assert.deepEqual(geminiCalls[0].config, { tools: [{ googleSearch: {} }] });

  const openai = await service.askEngine('openai', 'openai prompt');
  const perplexity = await service.askEngine('perplexity', 'perplexity prompt');
  assert.equal(openai.answer, 'provider answer');
  assert.deepEqual(perplexity.sources, [{ title: '', uri: 'https://source.example' }]);
  assert.equal(fetchCalls[0][0], 'openai');
  assert.equal(fetchCalls[0][1], 'https://api.openai.com/v1/responses');
  assert.equal(fetchCalls[0][2].headers.Authorization, 'Bearer openai-secret');
  assert.equal(JSON.parse(fetchCalls[0][2].body).model, 'openai-test');
  assert.equal(JSON.parse(fetchCalls[0][2].body).input, 'openai prompt');
  assert.deepEqual(JSON.parse(fetchCalls[0][2].body).tools, [{ type: 'web_search' }]);
  assert.equal(fetchCalls[1][0], 'perplexity');
  assert.equal(JSON.parse(fetchCalls[1][2].body).model, 'pplx-test');
  assert.deepEqual(await service.askEngine('missing', 'prompt'), { ok: false, answer: '', sources: [], error: 'unknown engine' });
});

test('AI visibility run keeps scoring, persistence, retention, and metering stable', async () => {
  const prior = Array.from({ length: 60 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    leaderboard: [],
    visibilityScore: 0,
    shareOfVoice: 0,
    sentimentScore: null,
  }));
  const state = { prompts: ['query one', 'query two'], snapshots: prior, updatedAt: null, lastRun: null };
  const usage = [];
  let providerCall = 0;
  let saves = 0;
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    meterUsage: engine => usage.push(engine),
    save: () => { saves += 1; },
    providerRuntime: {
      fetch: async () => {
        const text = providerCall++ === 0 ? 'Best Day Fitness and Rival Gym' : 'Rival Gym';
        return {
          ok: true,
          json: async () => ({
            output_text: text,
            output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://bestdayfitness.com' }] } }],
            choices: [{ message: { content: text } }],
          }),
        };
      },
    },
    geminiGenerate: async request => {
      if (request.config) return { text: '' };
      const mentioned = request.contents.includes('Best Day Fitness and Rival Gym');
      return { text: JSON.stringify({ mentioned, sentiment: mentioned ? 'positive' : 'neutral', competitors: ['Rival Gym', 'rival gym', 'Best Day Fitness'] }) };
    },
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.visibilityScore, 50);
  assert.equal(snapshot.shareOfVoice, 33);
  assert.equal(snapshot.sentimentScore, 100);
  assert.equal(snapshot.brandMentions, 1);
  assert.deepEqual(snapshot.perEngine, [{
    engine: 'openai',
    label: 'ChatGPT',
    score: 50,
    searchScore: 50,
    modelScore: null,
    answers: 2,
    searchAnswers: 2,
    modelAnswers: 0,
    classifiedAnswers: 2,
    modelClassifiedAnswers: 0,
  }]);
  assert.deepEqual(snapshot.leaderboard.map(row => [row.name, row.mentions, row.score]), [
    ['Rival Gym', 2, 100],
    ['Best Day Fitness', 1, 50],
  ]);
  assert.deepEqual(usage, ['openai', 'openai']);
  assert.equal(state.snapshots.length, 60);
  assert.equal(state.snapshots.at(-1), snapshot);
  assert.equal(state.updatedAt, snapshot.ranAt);
  assert.equal(state.lastRun, snapshot.ranAt);
  assert.equal(saves, 1);

  const trend = service.trend();
  assert.equal(trend.dates.at(-1), '2026-09-08');
  assert.equal(trend.series[0].name, 'Rival Gym');
  assert.equal(trend.metricLines.visibility.at(-1).value, 50);
});

test('AI visibility reports a controlled configuration error without calling providers', async () => {
  const { service, fetchCalls, saves } = serviceFixture();
  assert.deepEqual(await service.runVisibility(), {
    error: 'No AI engines are configured. Add GEMINI_API_KEY (and optionally OPENAI_API_KEY / PERPLEXITY_API_KEY).',
  });
  assert.equal(fetchCalls.length, 0);
  assert.equal(saves(), 0);
});

test('scheduled visibility checks preserve enabled, configured, due, and force guards', async () => {
  let providerCalls = 0;
  const state = {
    prompts: ['query one'], snapshots: [], updatedAt: null, lastRun: '2026-09-08T00:00:00.000Z',
    autoEnabled: false, intervalDays: 7,
  };
  const { service } = serviceFixture({
    state,
    env: { GEMINI_API_KEY: 'gemini-secret' },
    daysSince: () => 2,
    geminiGenerate: async request => {
      providerCalls += 1;
      return request.config
        ? { text: 'Best Day Fitness' }
        : { text: '{"mentioned":true,"sentiment":"positive","competitors":[]}' };
    },
  });

  await service.maybeRun(false);
  assert.equal(providerCalls, 0, 'disabled schedules stay idle');
  state.autoEnabled = true;
  await service.maybeRun(false);
  assert.equal(providerCalls, 0, 'not-due schedules stay idle');
  await service.maybeRun(true);
  assert.equal(providerCalls, 2, 'a forced run bypasses schedule guards but keeps the same provider workflow');
  assert.equal(service.running, false);

  const disconnected = serviceFixture({ state: { ...state, snapshots: [] }, env: {}, daysSince: () => Infinity });
  await disconnected.service.maybeRun(true);
  assert.equal(disconnected.fetchCalls.length, 0, 'force does not invent a configured provider');
});

test('scheduled and manual visibility work share one overlap guard and recover after failures', async () => {
  let releaseProvider;
  let announceStart;
  const started = new Promise(resolve => { announceStart = resolve; });
  let providerCalls = 0;
  let blockFirstProviderCall = true;
  const saves = [];
  const errors = [];
  const state = { prompts: ['query one'], snapshots: [], autoEnabled: true, intervalDays: 7, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { GEMINI_API_KEY: 'gemini-secret' },
    daysSince: () => Infinity,
    save: () => {
      saves.push('save');
      if (saves.length === 1) throw new Error('storage unavailable');
    },
    logger: { error: (...args) => errors.push(args) },
    geminiGenerate: async request => {
      providerCalls += 1;
      if (!request.config) return { text: '{"mentioned":true,"sentiment":"positive","competitors":[]}' };
      if (blockFirstProviderCall) {
        blockFirstProviderCall = false;
        announceStart();
        return new Promise(resolve => { releaseProvider = () => resolve({ text: 'Best Day Fitness' }); });
      }
      return { text: 'Best Day Fitness' };
    },
  });

  const first = service.maybeRun(false);
  await started;
  assert.equal(service.running, true);
  assert.deepEqual(await service.runVisibility(['google']), { busy: true }, 'a manual request shares the active service guard');
  await service.maybeRun(true);
  assert.equal(providerCalls, 1, 'an overlapping scheduled request does not start another provider call');
  releaseProvider();
  await first;
  assert.equal(service.running, false, 'the guard always releases after a failed run');
  assert.deepEqual(errors, [['[AI Visibility Autopilot] auto-run failed:', 'storage unavailable']]);

  await service.maybeRun(false);
  assert.equal(saves.length, 2, 'a later scheduled run can persist after recovery');
  assert.equal(service.running, false);
});

test('OpenAI web search adapter validates Responses endpoint, tools contract, search execution evidence, and citations', async () => {
  const { service, fetchCalls } = serviceFixture({
    env: { OPENAI_API_KEY: 'openai-secret' },
    openAiModel: 'gpt-4o',
    providerRuntime: {
      fetch: async (...args) => {
        fetchCalls.push(args);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'resp_123',
            output_text: null, // Test that output_text is parsed from message content type 'output_text'
            output: [
              {
                type: 'web_search_call',
                status: 'completed',
                action: {
                  sources: [
                    { url: 'https://competitor.example/directory', title: 'Gym Directory' },
                  ],
                },
              },
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Best Day Fitness is recommended in St. Petersburg for longevity training.',
                    annotations: [
                      { type: 'url_citation', url: 'https://bestdayfitness.com/consultation', title: 'Consultation' },
                    ],
                  },
                ],
              },
            ],
          }),
        };
      },
    },
  });

  const res = await service.askEngine('openai', 'senior fitness St Petersburg');
  assert.equal(res.ok, true);
  assert.equal(res.searchExecuted, true, 'search execution evidence captured');
  assert.match(res.answer, /Best Day Fitness/);
  // Inline citations are kept separate from searchSources
  assert.deepEqual(res.citations, [
    { title: 'Consultation', uri: 'https://bestdayfitness.com/consultation' },
  ]);
  assert.deepEqual(res.searchSources, [
    { title: 'Gym Directory', uri: 'https://competitor.example/directory' },
  ]);
  assert.deepEqual(res.sources, [
    { title: 'Consultation', uri: 'https://bestdayfitness.com/consultation' },
  ]);

  assert.equal(fetchCalls[0][0], 'openai');
  assert.equal(fetchCalls[0][1], 'https://api.openai.com/v1/responses');
  const reqBody = JSON.parse(fetchCalls[0][2].body);
  assert.equal(reqBody.model, 'gpt-4o');
  assert.equal(reqBody.input, 'senior fitness St Petersburg');
  assert.deepEqual(reqBody.tools, [{ type: 'web_search' }]);
  assert.deepEqual(reqBody.include, ['web_search_call.action.sources']);

  // Provider error test: 429 rate limit error propagation
  const errorFixture = serviceFixture({
    env: { OPENAI_API_KEY: 'openai-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Rate limit exceeded' } }),
      }),
    },
  });
  const errRes = await errorFixture.service.askEngine('openai', 'query');
  assert.equal(errRes.ok, false);
  assert.equal(errRes.code, 'PROVIDER_USAGE_LIMIT_REACHED');
  assert.match(errRes.error, /Rate limit exceeded|OpenAI HTTP error|usage limit/i);
});

test('recommendation classification regression: missing GEMINI_API_KEY marks recommendation unavailable and excludes from denominator', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret' }, // Missing GEMINI_API_KEY
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          output_text: 'Best Day Fitness is mentioned here, but it was noisy and crowded.',
          output: [],
        }),
      }),
    },
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.brandMentions, 1, 'brand mention detected via stringHit');
  assert.equal(snapshot.brandRecommendations, 0, 'missing key must NOT invent a recommendation from stringHit');
  assert.equal(snapshot.recommendationClassifiedCount, 0, 'zero answers had recommendation classification');
  assert.equal(snapshot.visibilityScore, null, 'visibility score is null when classification is unavailable');
  assert.equal(snapshot.recommendationRate, null, 'recommendation rate is null when classification is unavailable');
  assert.equal(snapshot.answers[0].recommended, null, 'recommended is explicitly null, not boolean stringHit');
  assert.equal(snapshot.answers[0].classificationStatus, 'unavailable');
  assert.equal(snapshot.answers[0].sentiment, 'unclassified');
});

test('recommendation classification regression: classification timeout/error marks recommendation unavailable', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({ output_text: 'Best Day Fitness is in St. Petersburg.', output: [] }),
      }),
    },
    geminiGenerate: async () => {
      throw new Error('ETIMEDOUT');
    },
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.brandMentions, 1);
  assert.equal(snapshot.brandRecommendations, 0);
  assert.equal(snapshot.recommendationClassifiedCount, 0);
  assert.equal(snapshot.visibilityScore, null, 'timeout excludes answer from recommendation denominator');
  assert.equal(snapshot.answers[0].recommended, null);
  assert.equal(snapshot.answers[0].classificationStatus, 'unavailable');
});

test('recommendation classification regression: malformed classification JSON marks recommendation unavailable', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({ output_text: 'Best Day Fitness is in St. Petersburg.', output: [] }),
      }),
    },
    geminiGenerate: async () => ({ text: 'Not valid JSON at all!' }),
    parseJson: () => null,
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.brandMentions, 1);
  assert.equal(snapshot.brandRecommendations, 0);
  assert.equal(snapshot.recommendationClassifiedCount, 0);
  assert.equal(snapshot.visibilityScore, null);
  assert.equal(snapshot.answers[0].recommended, null);
  assert.equal(snapshot.answers[0].classificationStatus, 'unavailable');
});

test('recommendation classification regression: neutral mentions do NOT become recommendations (visibility score: 0%)', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          output_text: 'Best Day Fitness is located at 6619 1st Ave S.',
          output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://bestdayfitness.com' }] } }],
        }),
      }),
    },
    geminiGenerate: async () => ({
      text: JSON.stringify({
        mentioned: true,
        recommended: false,
        sentiment: 'neutral',
        competitors: [],
      }),
    }),
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.brandMentions, 1, 'brand was mentioned');
  assert.equal(snapshot.brandRecommendations, 0, 'neutral mention is NOT a recommendation');
  assert.equal(snapshot.recommendationClassifiedCount, 1);
  assert.equal(snapshot.visibilityScore, 0, 'visibility score is 0% for neutral mention');
  assert.equal(snapshot.answers[0].mentioned, true);
  assert.equal(snapshot.answers[0].recommended, false);
  assert.equal(snapshot.answers[0].sentiment, 'neutral');
});

test('recommendation classification regression: negative mentions strictly produce recommended: false and 0% score', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          output_text: 'Avoid Best Day Fitness, the coaching was disappointing.',
          output: [{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://bestdayfitness.com' }] } }],
        }),
      }),
    },
    geminiGenerate: async () => ({
      text: JSON.stringify({
        mentioned: true,
        recommended: true, // Erroneously claims true, must be strictly overridden by sentiment: negative
        sentiment: 'negative',
        competitors: ['Better Gym'],
      }),
    }),
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.brandMentions, 1, 'brand was mentioned');
  assert.equal(snapshot.brandRecommendations, 0, 'negative mention must NEVER become a recommendation');
  assert.equal(snapshot.recommendationClassifiedCount, 1);
  assert.equal(snapshot.visibilityScore, 0, 'negative mention produces 0%, never 100%');
  assert.equal(snapshot.answers[0].mentioned, true);
  assert.equal(snapshot.answers[0].recommended, false);
  assert.equal(snapshot.answers[0].sentiment, 'negative');
});

test('citation URL matching uses validated hostnames rather than brand substrings in paths or titles', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Visit Rival Fitness.' } }],
          citations: [
            'https://competitor.example/articles/bestdayfitness-review',
          ],
        }),
      }),
    },
    geminiGenerate: async () => ({
      text: JSON.stringify({
        mentioned: false,
        recommended: false,
        sentiment: 'absent',
        competitors: ['Rival Fitness'],
      }),
    }),
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.answers[0].cited, false, 'brandRoot in path on competitor domain must NOT count as citation');

  // Now verify with authorized domain
  const state2 = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service: service2 } = serviceFixture({
    state: state2,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Best Day Fitness is at 6619 1st Ave S.' } }],
          citations: ['https://bestdayfitness.com/about'],
        }),
      }),
    },
    geminiGenerate: async () => ({
      text: JSON.stringify({
        mentioned: true,
        recommended: true,
        sentiment: 'positive',
        competitors: [],
      }),
    }),
  });

  const res2 = await service2.runVisibility(['openai']);
  assert.equal(res2.snapshot.answers[0].cited, true, 'validated hostname matches citation');
  assert.equal(res2.snapshot.answers[0].citedSources[0].uri, 'https://bestdayfitness.com/about');
});

test('OpenAI responses rejects empty answers appropriately', async () => {
  const { service } = serviceFixture({
    env: { OPENAI_API_KEY: 'openai-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          output_text: '   ',
          output: [],
        }),
      }),
    },
  });

  const res = await service.askEngine('openai', 'query');
  assert.equal(res.ok, false);
  assert.match(res.error, /Empty or invalid answer/i);
});

test('classifier validation rejects arbitrary JSON objects lacking boolean mentioned or valid sentiment', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({ output_text: 'Best Day Fitness is in St. Petersburg.', output: [] }),
      }),
    },
    // Classifier returns arbitrary JSON lacking mentioned or valid sentiment
    geminiGenerate: async () => ({
      text: JSON.stringify({ randomField: 123, status: 'ok' }),
    }),
  });

  const { snapshot } = await service.runVisibility(['openai']);
  assert.equal(snapshot.brandMentions, 1);
  assert.equal(snapshot.brandRecommendations, 0);
  assert.equal(snapshot.recommendationClassifiedCount, 0);
  assert.equal(snapshot.visibilityScore, null, 'malformed classifier object excluded from denominator');
  assert.equal(snapshot.answers[0].recommended, null);
  assert.equal(snapshot.answers[0].classificationStatus, 'unavailable');
});

test('uncited search action sources do NOT falsely trigger brand citation metric', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          id: 'resp_456',
          output: [
            {
              type: 'web_search_call',
              status: 'completed',
              action: {
                sources: [
                  // Search inspected bestdayfitness.com during browsing
                  { url: 'https://bestdayfitness.com/programs', title: 'Programs' },
                ],
              },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  // But the actual generated answer only cites a competitor directory
                  text: 'Check out local fitness studios in the Tampa Bay area.',
                  annotations: [
                    { type: 'url_citation', url: 'https://tampabaygyms.example/list', title: 'Tampa Gyms' },
                  ],
                },
              ],
            },
          ],
        }),
      }),
    },
    geminiGenerate: async () => ({
      text: JSON.stringify({
        mentioned: false,
        recommended: false,
        sentiment: 'absent',
        competitors: [],
      }),
    }),
  });

  const { snapshot } = await service.runVisibility(['openai']);
  // Only actual answer citations count toward cited!
  assert.equal(snapshot.answers[0].cited, false, 'search action source does not count as answer citation');
  assert.equal(snapshot.brandCitations, 0);
});

test('failed search call with action object is NOT searchExecuted: true and is excluded from search visibility denominator', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          id: 'resp_failed_search',
          output: [
            {
              type: 'web_search_call',
              status: 'failed', // Search execution failed!
              action: {
                query: 'best gyms in st petersburg',
                sources: [{ url: 'https://example.com/source', title: 'Source' }],
              },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Best Day Fitness is a top gym in St. Petersburg.',
                },
              ],
            },
          ],
        }),
      }),
    },
    geminiGenerate: async () => ({
      text: JSON.stringify({
        mentioned: true,
        recommended: true,
        sentiment: 'positive',
        competitors: [],
      }),
    }),
  });

  const { snapshot } = await service.runVisibility(['openai']);
  const answer = snapshot.answers[0];
  assert.equal(answer.searchExecuted, false, 'failed search status must NOT be marked searchExecuted: true');
  assert.equal(answer.searchFailed, true);
  assert.equal(answer.measurementType, 'model_only');
  assert.equal(snapshot.searchGroundedCount, 0, 'failed search excluded from search-grounded count');
  assert.equal(snapshot.searchVisibilityScore, null, 'failed search excluded from search visibility denominator');
  assert.equal(snapshot.visibilityScore, null, 'primary search visibility metric must be unavailable when search fails');
  assert.equal(snapshot.modelOnlyCount, 1, 'failed search labeled and retained as model-only evaluation');
  assert.equal(snapshot.modelOnlyVisibilityScore, 100, 'scored separately under model-only visibility');
  assert.equal(snapshot.perEngine[0].score, null, 'per-engine primary score must be unavailable when search fails');
  assert.equal(snapshot.perEngine[0].searchScore, null);
  assert.equal(snapshot.perEngine[0].modelScore, 100);
});

test('absent search without search call is labeled model_only and scored separately', async () => {
  const state = { prompts: ['prompt one'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { OPENAI_API_KEY: 'openai-secret', GEMINI_API_KEY: 'gemini-secret' },
    providerRuntime: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          id: 'resp_direct_model',
          output_text: 'Best Day Fitness is located on 1st Ave S in St. Petersburg.',
          output: [],
        }),
      }),
    },
    geminiGenerate: async () => ({
      text: JSON.stringify({
        mentioned: true,
        recommended: true,
        sentiment: 'positive',
        competitors: [],
      }),
    }),
  });

  const { snapshot } = await service.runVisibility(['openai']);
  const answer = snapshot.answers[0];
  assert.equal(answer.searchExecuted, false);
  assert.equal(answer.measurementType, 'model_only');
  assert.equal(snapshot.searchGroundedCount, 0);
  assert.equal(snapshot.searchVisibilityScore, null, 'absent search excluded from search visibility denominator');
  assert.equal(snapshot.visibilityScore, null, 'primary search visibility metric must be unavailable when search is absent');
  assert.equal(snapshot.modelOnlyCount, 1);
  assert.equal(snapshot.modelOnlyVisibilityScore, 100);
  assert.equal(snapshot.perEngine[0].score, null, 'per-engine primary score must be unavailable when search is absent');
  assert.equal(snapshot.perEngine[0].searchScore, null);
  assert.equal(snapshot.perEngine[0].modelScore, 100);
});

test('service executes approved service questions by category and records promptSetVersion & categories in snapshot metadata', async () => {
  const executedPrompts = [];
  const state = { prompts: ['custom prompt'], snapshots: [], updatedAt: null, lastRun: null };
  const { service } = serviceFixture({
    state,
    env: { GEMINI_API_KEY: 'test-key' },
    geminiGenerate: async request => {
      if (request.config?.tools) {
        executedPrompts.push(request.contents);
        return {
          text: 'Best Day Fitness & Wellness in St. Petersburg offers private training and consultations.',
          candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: 'Best Day Fitness', uri: 'https://bestdayfitness.com/' } }] } }],
        };
      }
      return {
        text: JSON.stringify({
          mentioned: true,
          recommended: true,
          sentiment: 'positive',
          competitors: [],
        }),
      };
    },
  });

  const { snapshot } = await service.runVisibility(['google'], {
    serviceCategories: ['consultation', 'haloredRecovery'],
  });

  assert.ok(snapshot, 'Must return snapshot');
  assert.equal(snapshot.promptSetVersion, PROMPT_SET_VERSION);
  assert.deepEqual(snapshot.serviceCategories, ['consultation', 'haloredRecovery']);
  assert.equal(snapshot.prompts.length, APPROVED_SERVICE_PROMPTS.consultation.length + APPROVED_SERVICE_PROMPTS.haloredRecovery.length);

  for (const answer of snapshot.answers) {
    assert.ok(answer.serviceCategory === 'consultation' || answer.serviceCategory === 'haloredRecovery',
      `serviceCategory must be consultation or haloredRecovery, got ${answer.serviceCategory}`);
    assert.equal(answer.mentioned, true);
    assert.equal(answer.recommended, true);
  }

  // Verify all consultation and haloredRecovery prompts were passed to the engine
  for (const expected of [...APPROVED_SERVICE_PROMPTS.consultation, ...APPROVED_SERVICE_PROMPTS.haloredRecovery]) {
    assert.ok(executedPrompts.some(p => p.includes(expected)), `Engine must receive prompt: ${expected}`);
  }
});

test('routes preserve user-defined prompts when adding or refreshing approved service prompts', () => {
  const { registerAiVisibilityRoutes } = require('../lib/ai-visibility-routes.js');
  const routes = {};
  const mockApp = {
    get: (path, ...handlers) => { routes['GET ' + path] = handlers[handlers.length - 1]; },
    post: (path, ...handlers) => { routes['POST ' + path] = handlers[handlers.length - 1]; },
  };

  const state = {
    prompts: ['my proprietary user query about balance', 'my custom senior mobility test'],
    snapshots: [],
    updatedAt: null,
    lastRun: null,
  };
  let saved = false;

  registerAiVisibilityRoutes(mockApp, {
    requireAuth: (req, res, next) => next(),
    state,
    nudgeSchedule: () => {},
    brandName: () => 'Best Day Fitness',
    enginesStatus: () => [{ id: 'google', label: 'Google', configured: true }],
    trend: () => ({ series: [], metricLines: {}, dates: [] }),
    anyConfigured: () => true,
    runVisibility: async () => ({ ok: true }),
    usageOverBudget: () => false,
    budgetBlock: () => {},
    save: () => { saved = true; },
    defaultPrompts: DEFAULT_VIS_PROMPTS,
    approvedServicePrompts: APPROVED_SERVICE_PROMPTS,
    promptSetVersion: PROMPT_SET_VERSION,
  });

  // Test 1: Adding a category with mode="merge" preserves user's custom prompts
  const req1 = {
    body: {
      category: 'consultation',
      mode: 'merge',
    },
  };
  let jsonResult1 = null;
  const res1 = { json: data => { jsonResult1 = data; return data; } };

  routes['POST /api/ai-visibility/prompts'](req1, res1);

  assert.equal(jsonResult1.success, true);
  assert.equal(jsonResult1.promptSetVersion, PROMPT_SET_VERSION);
  // User's custom prompts MUST be preserved!
  assert.ok(state.prompts.includes('my proprietary user query about balance'));
  assert.ok(state.prompts.includes('my custom senior mobility test'));
  // Consultation prompts MUST be added!
  for (const q of APPROVED_SERVICE_PROMPTS.consultation) {
    assert.ok(state.prompts.includes(q), `Expected consultation query "${q}" in state.prompts`);
  }
  assert.equal(saved, true);
});


