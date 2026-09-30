'use strict';

const { publicProviderError } = require('./public-provider-error');

const DEFAULT_AI_ENGINES = Object.freeze([
  Object.freeze({ id: 'google', label: 'Google (Gemini)', env: 'GEMINI_API_KEY', color: '#6366f1' }),
  Object.freeze({ id: 'openai', label: 'ChatGPT', env: 'OPENAI_API_KEY', color: '#10b981' }),
  Object.freeze({ id: 'perplexity', label: 'Perplexity', env: 'PERPLEXITY_API_KEY', color: '#06b6d4' }),
]);

const DEFAULT_BRAND_DOMAINS = Object.freeze([
  'bestdayfitness.com',
  'bestdayfitnessreviews.com',
]);

function matchesBrandHostname(uri, domains = DEFAULT_BRAND_DOMAINS) {
  if (!uri || typeof uri !== 'string') return false;
  try {
    const parsed = new URL(uri);
    const hostname = parsed.hostname.toLowerCase();
    const targetDomains = Array.isArray(domains) && domains.length ? domains : DEFAULT_BRAND_DOMAINS;
    return targetDomains.some(domain => {
      const d = String(domain || '').toLowerCase().trim();
      if (!d) return false;
      return hostname === d || hostname.endsWith(`.${d}`);
    });
  } catch {
    return false;
  }
}

const DEFAULT_VIS_PROMPTS = Object.freeze([
  'best senior fitness in St. Petersburg FL',
  'personal trainer for adults over 50 in St. Petersburg',
  'senior gym St. Petersburg Florida',
  'best fitness studio for injury recovery in St. Petersburg',
  'balance and mobility training for older adults St. Petersburg',
]);

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sentimentToScore(sentiment) {
  return sentiment === 'positive' ? 100 : sentiment === 'negative' ? 0 : 50;
}

function visibilityPrompt(query) {
  return `A person searching online asks: "${query}".
Acting as a helpful AI answer engine, recommend the best specific local businesses that fit this search in and around St. Petersburg, Florida. Name the actual businesses and briefly say why each is a good fit.`;
}

function createAiVisibilityService(options) {
  const {
    state,
    save,
    geminiGenerate,
    geminiModel,
    providerRuntime,
    parseJson,
    brandName,
    meterUsage,
    env = process.env,
    engines = DEFAULT_AI_ENGINES,
    defaultPrompts = DEFAULT_VIS_PROMPTS,
    openAiModel = env.OPENAI_MODEL || 'gpt-4o',
    perplexityModel = env.PERPLEXITY_MODEL || 'sonar',
    brandRoot = 'bestdayfitness',
    brandDomains = options?.authorizedDomains || DEFAULT_BRAND_DOMAINS,
    nowIso = () => new Date().toISOString(),
    daysSince = value => value ? (Date.now() - new Date(value).getTime()) / 86400000 : Infinity,
    logger = console,
  } = options || {};

  if (!state || !Array.isArray(state.snapshots)) throw new TypeError('AI visibility state with a snapshots array is required.');
  if (typeof save !== 'function') throw new TypeError('AI visibility save callback is required.');
  if (typeof geminiGenerate !== 'function') throw new TypeError('geminiGenerate is required.');
  if (!providerRuntime || typeof providerRuntime.fetch !== 'function') throw new TypeError('providerRuntime.fetch is required.');
  if (typeof parseJson !== 'function') throw new TypeError('parseJson is required.');
  if (typeof brandName !== 'function') throw new TypeError('brandName is required.');
  if (typeof meterUsage !== 'function') throw new TypeError('meterUsage is required.');
  if (typeof daysSince !== 'function') throw new TypeError('daysSince is required.');
  if (!logger || typeof logger.error !== 'function') throw new TypeError('logger.error is required.');

  const engineById = new Map(engines.map(engine => [engine.id, engine]));
  let running = false;

  function engineConfigured(id) {
    const engine = engineById.get(id);
    return !!(engine && env[engine.env]);
  }

  function enginesStatus() {
    return engines.map(engine => ({
      id: engine.id,
      label: engine.label,
      color: engine.color,
      configured: engineConfigured(engine.id),
    }));
  }

  function isBrandName(value) {
    const normalized = normalizeName(value);
    return normalized.includes(normalizeName(brandName()))
      || normalized.includes(brandRoot)
      || normalized.includes('best day fitness');
  }

  async function askGoogleEngine(promptText) {
    if (!env.GEMINI_API_KEY) return { ok: false, answer: '', sources: [], error: 'no key' };
    try {
      const response = await geminiGenerate({
        model: geminiModel,
        contents: promptText,
        config: { tools: [{ googleSearch: {} }] },
      });
      const answer = (response.text || '').trim();
      const grounding = response.candidates?.[0]?.groundingMetadata || {};
      const sources = (grounding.groundingChunks || [])
        .map(chunk => ({ title: chunk.web?.title || '', uri: chunk.web?.uri || '' }))
        .filter(source => source.title || source.uri);
      return { ok: true, answer, sources };
    } catch (error) {
      const failure = publicProviderError(error, {
        provider: 'Gemini',
        operation: 'The Google AI visibility check',
        setupPath: 'Settings → Your connections → Gemini',
      });
      return { ok: false, answer: '', sources: [], code: failure.code, error: failure.error };
    }
  }

  async function askOpenAiEngine(promptText) {
    const key = env.OPENAI_API_KEY;
    if (!key) return { ok: false, answer: '', sources: [], error: 'no key' };
    try {
      const response = await providerRuntime.fetch('openai', 'https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: openAiModel || 'gpt-4o',
          input: promptText,
          tools: [{ type: 'web_search' }],
          include: ['web_search_call.action.sources'],
        }),
      }, { retries: 0 });

      if (response.ok === false) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error?.message || errorPayload.message || `OpenAI HTTP error! status: ${response.status}`);
      }

      const payload = await response.json();

      let answer = '';
      if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
        answer = payload.output_text.trim();
      } else if (Array.isArray(payload.output)) {
        const textParts = [];
        for (const item of payload.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const c of item.content) {
              if ((c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') {
                textParts.push(c.text);
              }
            }
          }
        }
        answer = textParts.join('\n').trim();
      } else if (payload.choices?.[0]?.message?.content) {
        answer = payload.choices[0].message.content.trim();
      }

      if (!answer) {
        return { ok: false, answer: '', sources: [], citations: [], searchSources: [], searchExecuted: false, error: 'Empty or invalid answer received from OpenAI.' };
      }

      // 1. Extract actual inline answer citations
      const rawCitations = [];
      if (Array.isArray(payload.citations)) {
        rawCitations.push(...payload.citations);
      }
      if (Array.isArray(payload.output)) {
        for (const item of payload.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const c of item.content) {
              if (Array.isArray(c.annotations)) {
                rawCitations.push(...c.annotations);
              }
            }
          }
        }
      }
      const annotations = payload.choices?.[0]?.message?.annotations || payload.choices?.[0]?.message?.citations;
      if (Array.isArray(annotations)) {
        rawCitations.push(...annotations);
      }

      const seenCitationUris = new Set();
      const citations = rawCitations
        .map(c => {
          if (typeof c === 'string') return { title: '', uri: c };
          const uri = c.url || c.uri || c.url_citation?.url || c.web_search_result?.url || '';
          const title = c.title || c.url_citation?.title || c.web_search_result?.title || '';
          return { title, uri };
        })
        .filter(s => {
          if (!s.uri || seenCitationUris.has(s.uri)) return false;
          seenCitationUris.add(s.uri);
          return true;
        });

      // 2. Extract Web Search Call Sources (search candidate actions)
      const rawSearchSources = [];
      let searchCompleted = false;
      let searchFailed = false;
      let searchCallStatus = null;
      let searchCallId = null;

      if (Array.isArray(payload.output)) {
        for (const item of payload.output) {
          if (item.type === 'web_search_call') {
            searchCallId = item.id || searchCallId;
            searchCallStatus = item.status || searchCallStatus;
            if (item.status === 'completed') {
              searchCompleted = true;
            } else if (item.status === 'failed' || item.status === 'error' || item.status === 'cancelled') {
              searchFailed = true;
            }
            if (Array.isArray(item.action?.sources)) {
              rawSearchSources.push(...item.action.sources);
            }
          }
        }
      }
      if (payload.web_search_call) {
        searchCallId = payload.web_search_call.id || searchCallId;
        searchCallStatus = payload.web_search_call.status || searchCallStatus;
        if (payload.web_search_call.status === 'completed') {
          searchCompleted = true;
        } else if (payload.web_search_call.status === 'failed' || payload.web_search_call.status === 'error' || payload.web_search_call.status === 'cancelled') {
          searchFailed = true;
        }
        if (Array.isArray(payload.web_search_call.action?.sources)) {
          rawSearchSources.push(...payload.web_search_call.action.sources);
        }
      }

      const seenSearchUris = new Set();
      const searchSources = rawSearchSources
        .map(c => {
          if (typeof c === 'string') return { title: '', uri: c };
          const uri = c.url || c.uri || '';
          const title = c.title || '';
          return { title, uri };
        })
        .filter(s => {
          if (!s.uri || seenSearchUris.has(s.uri)) return false;
          seenSearchUris.add(s.uri);
          return true;
        });

      // Strict enforcement: A completed search requires status === 'completed'.
      // An action object without completed status is NOT searchExecuted: true.
      const searchExecuted = searchCompleted === true;
      const searchEvidence = searchExecuted
        ? { status: 'completed', sourcesCount: searchSources.length, searchSources, callId: searchCallId }
        : (searchCallStatus || searchFailed ? { status: searchCallStatus || 'failed', callId: searchCallId } : null);

      return {
        ok: true,
        answer,
        sources: citations, // actual answer citations count toward citation metric
        citations,
        searchSources,
        searchExecuted,
        searchEvidence,
        searchFailed,
      };
    } catch (error) {
      const failure = publicProviderError(error, {
        provider: 'OpenAI',
        operation: 'The ChatGPT visibility check',
        setupPath: 'Settings → Your connections → OpenAI',
      });
      return { ok: false, answer: '', sources: [], code: failure.code, error: failure.error };
    }
  }

  async function askPerplexityEngine(promptText) {
    const key = env.PERPLEXITY_API_KEY;
    if (!key) return { ok: false, answer: '', sources: [], error: 'no key' };
    try {
      const response = await providerRuntime.fetch('perplexity', 'https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: perplexityModel, messages: [{ role: 'user', content: promptText }] }),
      }, { retries: 0 });
      const payload = await response.json();
      const answer = (payload.choices?.[0]?.message?.content || '').trim();
      const sources = Array.isArray(payload.citations)
        ? payload.citations.map(uri => ({ title: '', uri }))
        : [];
      const searchExecuted = sources.length > 0;
      const searchEvidence = searchExecuted ? { status: 'completed', sourcesCount: sources.length } : null;
      return { ok: true, answer, sources, searchExecuted, searchEvidence };
    } catch (error) {
      const failure = publicProviderError(error, {
        provider: 'Perplexity',
        operation: 'The Perplexity visibility check',
        setupPath: 'Settings → Your connections → Perplexity',
      });
      return { ok: false, answer: '', sources: [], code: failure.code, error: failure.error };
    }
  }

  async function askEngine(id, promptText) {
    if (id === 'google') return askGoogleEngine(promptText);
    if (id === 'openai') return askOpenAiEngine(promptText);
    if (id === 'perplexity') return askPerplexityEngine(promptText);
    return { ok: false, answer: '', sources: [], error: 'unknown engine' };
  }

  async function analyzeAnswer(query, answerText, sources) {
    const currentBrand = brandName();
    const haystack = `${answerText} ${(sources || []).map(source => `${source.title} ${source.uri}`).join(' ')}`.toLowerCase();
    const stringHit = haystack.includes(currentBrand.toLowerCase()) || haystack.includes(brandRoot);
    const brandHitsInSources = (sources || []).filter(s => matchesBrandHostname(s.uri, brandDomains));
    const cited = brandHitsInSources.length > 0;
    if (!env.GEMINI_API_KEY || !answerText) {
      return {
        mentioned: stringHit,
        recommended: null,
        classificationStatus: 'unavailable',
        cited,
        sentiment: stringHit ? 'unclassified' : 'absent',
        competitors: [],
        citedSources: brandHitsInSources,
      };
    }

    try {
      const prompt = `An AI answer engine responded to the query "${query}" with:
"""
${answerText.slice(0, 4000)}
"""
The brand we care about is "${currentBrand}". Return ONLY raw JSON, no markdown:
{
  "mentioned": true or false (is ${currentBrand} mentioned or referenced in the response?),
  "recommended": true or false (is ${currentBrand} explicitly recommended, endorsed, or suggested as a positive option? Must be false if ${currentBrand} is criticized, cautioned against, or merely referenced negatively or neutrally without endorsement),
  "sentiment": "positive" | "neutral" | "negative" (tone toward ${currentBrand}; use "neutral" if merely listed; ignore if not mentioned),
  "competitors": ["names of OTHER businesses the answer recommends or mentions, excluding ${currentBrand}"]
}`;
      const response = await geminiGenerate({ model: geminiModel, contents: prompt });
      const parsed = parseJson(response.text);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Malformed classification response from Gemini');
      }

      // Validate required classifier fields
      if (typeof parsed.mentioned !== 'boolean') {
        throw new Error('Malformed classification: missing boolean mentioned field');
      }
      if (!['positive', 'neutral', 'negative'].includes(parsed.sentiment)) {
        throw new Error('Malformed classification: missing or invalid sentiment field');
      }
      if (parsed.recommended !== undefined && typeof parsed.recommended !== 'boolean') {
        throw new Error('Malformed classification: recommended field must be boolean when present');
      }

      const mentioned = parsed.mentioned;
      let sentiment = parsed.sentiment;
      if (!mentioned) sentiment = 'absent';

      // Classify recommendations independently; negative and neutral mentions must NEVER become recommendations
      let recommended = false;
      if (mentioned && sentiment === 'positive') {
        recommended = typeof parsed.recommended === 'boolean' ? parsed.recommended : true;
      }

      const seen = new Set();
      const competitors = (Array.isArray(parsed.competitors) ? parsed.competitors : [])
        .filter(Boolean)
        .filter(candidate => !isBrandName(candidate))
        .filter(candidate => {
          const normalized = normalizeName(candidate);
          if (!normalized || seen.has(normalized)) return false;
          seen.add(normalized);
          return true;
        });
      return {
        mentioned: !!mentioned,
        recommended: !!recommended,
        classificationStatus: 'classified',
        cited,
        sentiment,
        competitors,
        citedSources: brandHitsInSources,
      };
    } catch {
      return {
        mentioned: stringHit,
        recommended: null,
        classificationStatus: 'unavailable',
        cited,
        sentiment: stringHit ? 'unclassified' : 'absent',
        competitors: [],
        citedSources: brandHitsInSources,
      };
    }
  }

  async function performVisibility(engineIds) {
    const requested = engineIds?.length ? engineIds : engines.map(engine => engine.id);
    const enabled = requested.filter(engineConfigured);
    if (!enabled.length) {
      return { error: 'No AI engines are configured. Add GEMINI_API_KEY (and optionally OPENAI_API_KEY / PERPLEXITY_API_KEY).' };
    }
    const prompts = (state.prompts?.length ? state.prompts : defaultPrompts).slice(0, 25);
    const currentBrand = brandName();
    const answers = [];

    for (const engine of enabled) {
      for (const prompt of prompts) {
        const result = await askEngine(engine, visibilityPrompt(prompt));
        if (!result.ok) {
          answers.push({
            engine,
            prompt,
            measurementType: 'error',
            searchExecuted: false,
            searchEvidence: null,
            mentioned: false,
            recommended: false,
            classificationStatus: 'unavailable',
            cited: false,
            sentiment: 'error',
            competitors: [],
            snippet: '',
            error: result.error || 'failed',
            rawEvidence: null
          });
          continue;
        }
        if (engine !== 'google') meterUsage(engine);
        const analysis = await analyzeAnswer(prompt, result.answer, result.sources);
        const searchExecuted = result.searchExecuted === true;
        const searchFailed = result.searchFailed === true;
        const measurementType = searchExecuted ? 'search_grounded' : 'model_only';

        answers.push({
          engine,
          prompt,
          measurementType,
          searchExecuted,
          searchFailed,
          searchEvidence: result.searchEvidence || null,
          mentioned: analysis.mentioned,
          recommended: analysis.recommended,
          classificationStatus: analysis.classificationStatus,
          cited: analysis.cited,
          sentiment: analysis.sentiment,
          competitors: analysis.competitors,
          snippet: result.answer.length > 320 ? `${result.answer.slice(0, 317)}…` : result.answer,
          sources: (result.sources || []).slice(0, 6),
          citedSources: analysis.citedSources || [],
          rawEvidence: {
            answer: result.answer,
            sources: result.sources || [],
            searchExecuted,
            searchEvidence: result.searchEvidence || null,
          },
        });
      }
    }

    const scored = answers.filter(answer => answer.sentiment !== 'error');
    const totalAnswers = scored.length;

    // Separate search-grounded measurements (completed search evidence required)
    // from model-only evaluations (absent or failed search)
    const searchGroundedAnswers = scored.filter(answer => answer.searchExecuted === true);
    const modelOnlyAnswers = scored.filter(answer => answer.searchExecuted !== true);

    // Search-rate calculations (strictly require completed search evidence)
    const searchClassified = searchGroundedAnswers.filter(
      answer => answer.classificationStatus === 'classified' && typeof answer.recommended === 'boolean'
    );
    const searchRecommendations = searchClassified.filter(answer => answer.recommended === true).length;
    const searchRecommendationRate = searchClassified.length
      ? Math.round((searchRecommendations / searchClassified.length) * 100)
      : null;
    const searchVisibilityScore = searchRecommendationRate;

    // Model-only calculations (labeled and scored separately)
    const modelOnlyClassified = modelOnlyAnswers.filter(
      answer => answer.classificationStatus === 'classified' && typeof answer.recommended === 'boolean'
    );
    const modelOnlyRecommendations = modelOnlyClassified.filter(answer => answer.recommended === true).length;
    const modelOnlyRecommendationRate = modelOnlyClassified.length
      ? Math.round((modelOnlyRecommendations / modelOnlyClassified.length) * 100)
      : null;
    const modelOnlyVisibilityScore = modelOnlyRecommendationRate;

    // The primary visibilityScore represents search-grounded visibility whenever search answers exist,
    // otherwise fallback to model-only score so existing tests or mock runs without search mocks retain a score.
    const visibilityScore = searchClassified.length > 0 ? searchVisibilityScore : modelOnlyVisibilityScore;
    const recommendationRate = visibilityScore;
    const brandRecommendations = searchClassified.length > 0 ? searchRecommendations : modelOnlyRecommendations;
    const recommendationClassified = searchClassified.length > 0 ? searchClassified : modelOnlyClassified;

    const brandMentions = searchGroundedAnswers.length > 0
      ? searchGroundedAnswers.filter(answer => answer.mentioned).length
      : scored.filter(answer => answer.mentioned).length;
    const brandCitations = searchGroundedAnswers.length > 0
      ? searchGroundedAnswers.filter(answer => answer.cited).length
      : scored.filter(answer => answer.cited).length;

    const mentions = {};
    const bump = (name, isBrand) => {
      const normalized = normalizeName(name);
      if (!normalized) return;
      if (!mentions[normalized]) mentions[normalized] = { name, count: 0, isBrand: !!isBrand };
      mentions[normalized].count += 1;
    };
    scored.forEach(answer => {
      if (answer.recommended === true) bump(currentBrand, true);
      answer.competitors.forEach(competitor => bump(competitor, false));
    });
    const totalMentions = Object.values(mentions).reduce((sum, mention) => sum + mention.count, 0);
    const shareOfVoice = totalMentions ? Math.round((brandRecommendations / totalMentions) * 100) : 0;
    const brandAnswers = scored.filter(answer => answer.recommended === true);
    const sentimentScore = brandAnswers.length
      ? Math.round(brandAnswers.reduce((sum, answer) => sum + sentimentToScore(answer.sentiment), 0) / brandAnswers.length)
      : null;
    const leaderboard = Object.values(mentions)
      .map(mention => ({
        name: mention.name,
        isBrand: mention.isBrand,
        mentions: mention.count,
        score: totalAnswers ? Math.round((mention.count / totalAnswers) * 100) : 0,
      }))
      .sort((left, right) => right.mentions - left.mentions);
    if (!leaderboard.some(row => row.isBrand)) leaderboard.push({ name: currentBrand, isBrand: true, mentions: 0, score: 0 });

    const perEngine = enabled.map(engine => {
      const engineAnswers = scored.filter(answer => answer.engine === engine);
      const searchEngineAnswers = engineAnswers.filter(answer => answer.searchExecuted === true);
      const searchClassifiedAnswers = searchEngineAnswers.filter(
        answer => answer.classificationStatus === 'classified' && typeof answer.recommended === 'boolean'
      );
      const engineSearchRecs = searchClassifiedAnswers.filter(answer => answer.recommended === true).length;
      const searchScore = searchClassifiedAnswers.length
        ? Math.round((engineSearchRecs / searchClassifiedAnswers.length) * 100)
        : null;

      const modelEngineAnswers = engineAnswers.filter(answer => answer.searchExecuted !== true);
      const modelClassifiedAnswers = modelEngineAnswers.filter(
        answer => answer.classificationStatus === 'classified' && typeof answer.recommended === 'boolean'
      );
      const engineModelRecs = modelClassifiedAnswers.filter(answer => answer.recommended === true).length;
      const modelScore = modelClassifiedAnswers.length
        ? Math.round((engineModelRecs / modelClassifiedAnswers.length) * 100)
        : null;

      const score = searchScore !== null ? searchScore : modelScore;

      return {
        engine,
        label: engineById.get(engine)?.label || engine,
        score,
        answers: engineAnswers.length,
        classifiedAnswers: searchClassifiedAnswers.length || modelClassifiedAnswers.length,
      };
    });
    const today = nowIso().slice(0, 10);
    const snapshot = {
      date: today,
      ranAt: nowIso(),
      measurementSurface: 'api_model_evaluation',
      methodology: 'Developer API model evaluation with web search and grounding tools. Reflects model API outputs, not direct consumer web interfaces (such as consumer ChatGPT or Google AI Overviews).',
      engines: enabled,
      prompts,
      visibilityScore,
      searchVisibilityScore,
      modelOnlyVisibilityScore,
      searchGroundedCount: searchGroundedAnswers.length,
      modelOnlyCount: modelOnlyAnswers.length,
      recommendationRate,
      brandMentions,
      brandCitations,
      brandRecommendations,
      recommendationClassifiedCount: recommendationClassified.length,
      totalAnswers,
      shareOfVoice,
      sentimentScore,
      perEngine,
      leaderboard,
      answers,
    };

    const sameDayIndex = state.snapshots.findIndex(existing => existing.date === today);
    if (sameDayIndex >= 0) state.snapshots[sameDayIndex] = snapshot;
    else state.snapshots.push(snapshot);
    state.snapshots = state.snapshots.slice(-60);
    state.updatedAt = snapshot.ranAt;
    state.lastRun = snapshot.ranAt;
    save();
    return { snapshot };
  }

  async function runVisibility(engineIds) {
    if (running) return { busy: true };
    running = true;
    try {
      return await performVisibility(engineIds);
    } finally {
      running = false;
    }
  }

  async function maybeRun(force) {
    if (running) return;
    if (!force && !state.autoEnabled) return;
    if (!engines.some(engine => engineConfigured(engine.id))) return;
    if (!force && daysSince(state.lastRun) < (state.intervalDays || 7)) return;
    try {
      await runVisibility(null);
    } catch (error) {
      logger.error('[AI Visibility Autopilot] auto-run failed:', error.message);
    }
  }

  function trend() {
    const snapshots = state.snapshots.slice(-24);
    const brandKey = normalizeName(brandName());
    const latest = snapshots[snapshots.length - 1];
    const topNames = latest ? latest.leaderboard.slice(0, 6).map(row => row.name) : [brandName()];
    const series = topNames.map(name => {
      const nameKey = normalizeName(name);
      return {
        name,
        isBrand: nameKey === brandKey,
        points: snapshots.map(snapshot => {
          const row = (snapshot.leaderboard || []).find(item => normalizeName(item.name) === nameKey);
          return { date: snapshot.date, score: row ? row.score : 0 };
        }),
      };
    });
    return {
      series,
      metricLines: {
        visibility: snapshots.map(snapshot => ({ date: snapshot.date, value: snapshot.visibilityScore })),
        shareOfVoice: snapshots.map(snapshot => ({ date: snapshot.date, value: snapshot.shareOfVoice })),
        sentiment: snapshots.map(snapshot => ({ date: snapshot.date, value: snapshot.sentimentScore })),
      },
      dates: snapshots.map(snapshot => snapshot.date),
    };
  }

  return {
    askEngine,
    engineConfigured,
    enginesStatus,
    maybeRun,
    runVisibility,
    trend,
    get running() { return running; },
  };
}

module.exports = {
  DEFAULT_AI_ENGINES,
  DEFAULT_VIS_PROMPTS,
  createAiVisibilityService,
  normalizeName,
  sentimentToScore,
  visibilityPrompt,
};
