'use strict';

const { publicProviderError } = require('./public-provider-error');

const DEFAULT_AI_CRAWLERS = Object.freeze([
  Object.freeze({ ua: 'GPTBot', label: 'GPTBot', purpose: 'OpenAI — trains & feeds ChatGPT' }),
  Object.freeze({ ua: 'OAI-SearchBot', label: 'OAI-SearchBot', purpose: 'ChatGPT Search index' }),
  Object.freeze({ ua: 'ChatGPT-User', label: 'ChatGPT-User', purpose: 'ChatGPT live browsing' }),
  Object.freeze({ ua: 'PerplexityBot', label: 'PerplexityBot', purpose: 'Perplexity index' }),
  Object.freeze({ ua: 'ClaudeBot', label: 'ClaudeBot', purpose: 'Anthropic Claude' }),
  Object.freeze({ ua: 'Google-Extended', label: 'Google-Extended', purpose: 'Gemini / Google AI' }),
  Object.freeze({ ua: 'Applebot-Extended', label: 'Applebot-Extended', purpose: 'Apple Intelligence' }),
  Object.freeze({ ua: 'Amazonbot', label: 'Amazonbot', purpose: 'Amazon (Alexa / Rufus)' }),
  Object.freeze({ ua: 'meta-externalagent', label: 'Meta-ExternalAgent', purpose: 'Meta AI' }),
  Object.freeze({ ua: 'Bytespider', label: 'Bytespider', purpose: 'ByteDance / TikTok AI' }),
  Object.freeze({ ua: 'CCBot', label: 'CCBot', purpose: 'Common Crawl — feeds many LLMs' }),
]);

function parseRobots(text) {
  const groups = [];
  let current = null;
  String(text || '').split(/\r?\n/).forEach(line => {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) return;
    const match = clean.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) return;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      if (!current || current._started) {
        current = { agents: [], allow: [], disallow: [], _started: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' && current) {
      current._started = true;
      current.disallow.push(value);
    } else if (field === 'allow' && current) {
      current._started = true;
      current.allow.push(value);
    }
  });
  return groups;
}

function crawlerVerdict(groups, userAgent) {
  const normalizedAgent = userAgent.toLowerCase();
  let group = groups.find(candidate => candidate.agents.some(agent => agent !== '*'
    && (agent === normalizedAgent || normalizedAgent.includes(agent) || agent.includes(normalizedAgent))));
  let matchedBy = group ? 'specific rule' : '';
  if (!group) {
    group = groups.find(candidate => candidate.agents.includes('*'));
    matchedBy = group ? 'the * (all bots) rule' : '';
  }
  if (!group) return { status: 'allowed', reason: 'not restricted', matchedBy: 'no matching rule' };
  const blocksAll = group.disallow.includes('/');
  const allowsRoot = group.allow.includes('/');
  if (blocksAll && !allowsRoot) return { status: 'blocked', reason: 'Disallow: /', matchedBy };
  const somePaths = group.disallow.filter(path => path && path !== '/').length;
  return { status: 'allowed', reason: somePaths ? 'allowed (some paths blocked)' : 'allowed', matchedBy };
}

function createAiCrawlerService(options) {
  const {
    state,
    save,
    getSiteDomain,
    providerRuntime,
    crawlers = DEFAULT_AI_CRAWLERS,
    nowIso = () => new Date().toISOString(),
  } = options || {};

  if (!state || typeof state !== 'object') throw new TypeError('AI crawler state is required.');
  if (typeof save !== 'function') throw new TypeError('AI crawler save callback is required.');
  if (typeof getSiteDomain !== 'function') throw new TypeError('getSiteDomain is required.');
  if (!providerRuntime || typeof providerRuntime.fetch !== 'function') throw new TypeError('providerRuntime.fetch is required.');
  if (!Array.isArray(crawlers)) throw new TypeError('AI crawler catalog is required.');

  async function run() {
    const site = getSiteDomain();
    const robotsUrl = `${site}/robots.txt`;
    let robotsText = '';
    let hadRobots = false;
    let status = 0;
    let fetchError = '';
    try {
      const response = await providerRuntime.fetch('web-audit', robotsUrl, {
        headers: { 'User-Agent': 'SEO-Buddy-AI-Readiness/1.0' },
      }, {
        throwOnHttpError: false,
        retries: 1,
        policy: { timeoutMs: 15000 },
      });
      status = response.status;
      if (response.ok) {
        robotsText = await response.text();
        hadRobots = true;
      }
    } catch (error) {
      fetchError = publicProviderError(error, {
        provider: 'The website',
        operation: 'The AI crawler check',
      }).error;
    }

    const groups = parseRobots(robotsText);
    const bots = crawlers.map(crawler => ({
      ...crawler,
      ...(hadRobots
        ? crawlerVerdict(groups, crawler.ua)
        : (fetchError || (status !== 404 && status !== 200))
        ? { status: 'unknown', reason: fetchError || `robots.txt could not be fetched (HTTP ${status})`, matchedBy: 'fetch-error' }
        : { status: 'allowed', reason: 'no robots.txt found (site is open to all)', matchedBy: 'none' }),
    }));
    const blocked = bots.filter(bot => bot.status === 'blocked').length;
    const snapshot = {
      ranAt: nowIso(),
      site,
      robotsUrl,
      hadRobots,
      status,
      fetchError,
      blocked,
      total: bots.length,
      bots,
      robotsSnippet: robotsText.slice(0, 1500),
    };
    state.latest = snapshot;
    state.updatedAt = snapshot.ranAt;
    save();
    return { snapshot };
  }

  return { run };
}

module.exports = { DEFAULT_AI_CRAWLERS, createAiCrawlerService, crawlerVerdict, parseRobots };
