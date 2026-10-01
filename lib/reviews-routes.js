'use strict';

const { upsertDailySnapshot } = require('./daily-snapshot');
const { publicProviderError } = require('./public-provider-error');
const {
  normalizeDomain,
  findBusinessUnitUrl,
  normalizeBusinessUnit,
  comparePageClaim,
  negativeCount,
  trustpilotTrend,
} = require('./trustpilot');

function parseReviewCards(html) {
  const reviews = [];
  const cardPattern = /<div class="rev" data-plat="([a-z]+)">([\s\S]*?)<\/p><\/div>/g;
  let match;
  while ((match = cardPattern.exec(html))) {
    const [, platform, body] = match;
    const author = (body.match(/<b>([^<]*)<\/b>/) || [])[1] || '';
    const date = (body.match(/<div class="d">([^<]*)<\/div>/) || [])[1] || '';
    let rating = Number((body.match(/aria-label="(\d) out of 5 stars"/) || [])[1]);
    if (!rating) {
      const ratingRow = (body.match(/<div class="rs"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
      const off = ((ratingRow.match(/<span class="off">([★]*)<\/span>/) || [])[1] || '').length;
      rating = ((ratingRow.match(/★/g) || []).length) - off || null;
    }
    reviews.push({ platform, author, date, rating: rating || null });
  }
  return reviews;
}

function parseJsonLd(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (error) { return { __parseError: error.message }; }
}

function metaContent(html, attribute, value) {
  const pattern = new RegExp(`<meta[^>]*${attribute}=["']${value}["'][^>]*content=["']([^"']*)["']`, 'i');
  const alternate = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${value}["']`, 'i');
  return (html.match(pattern) || html.match(alternate) || [])[1] || null;
}

function monthlyGrowth(cards) {
  const byMonth = {};
  for (const card of cards) {
    if (/^\d{4}-\d{2}$/.test(card.date)) byMonth[card.date] = (byMonth[card.date] || 0) + 1;
  }
  const months = Object.keys(byMonth).sort();
  if (!months.length) return [];
  const series = [];
  let cursor = months[0];
  const last = months[months.length - 1];
  let total = 0;
  let guard = 0;
  while (cursor <= last && guard++ < 400) {
    total += byMonth[cursor] || 0;
    series.push({ month: cursor, added: byMonth[cursor] || 0, total });
    let [year, month] = cursor.split('-').map(Number);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    cursor = `${year}-${String(month).padStart(2, '0')}`;
  }
  return series;
}

function createReviewsService(options) {
  const {
    providerRuntime,
    initialSnapshots = [],
    saveSnapshots,
    getReviewsUrl,
    getReviewsApiUrl,
    getTrustpilotSettings,
    nowMs = () => Date.now(),
    nowIso = () => new Date().toISOString(),
    cacheTtlMs = 5 * 60 * 1000,
    trustpilotCacheTtlMs = 15 * 60 * 1000,
  } = options;
  let reviewsSnapshots = Array.isArray(initialSnapshots) ? initialSnapshots : [];
  let trustpilotCache = null;
  let statsCache = null;
  let statsPromise = null;

  const reviewsUrl = () => String(getReviewsUrl() || 'https://bestdayfitnessreviews.com').replace(/\/+$/, '');
  const reviewsApiUrl = () => (typeof getReviewsApiUrl === 'function' && getReviewsApiUrl() ? String(getReviewsApiUrl()).replace(/\/+$/, '') : null);
  const fetchPage = (url, requestOptions = {}, timeoutMs = 12000) => providerRuntime.fetch('reviews-site', url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBuddyBot/1.0)' },
    ...requestOptions,
  }, { throwOnHttpError: false, policy: { timeoutMs }, retries: 1 });

  async function fetchTrustpilot() {
    const settings = getTrustpilotSettings();
    const apiKey = String(settings.apiKey || '').trim();
    const domain = normalizeDomain(settings.domain || '');
    const configured = !!(apiKey && domain);
    if (!configured) return { configured: false };
    if (trustpilotCache && nowMs() - trustpilotCache.at < trustpilotCacheTtlMs) return trustpilotCache.data;

    const remember = data => {
      trustpilotCache = { at: nowMs(), data };
      return data;
    };
    const fail = error => remember({ configured: true, ok: false, domain, error });
    try {
      const response = await providerRuntime.fetch('trustpilot', findBusinessUnitUrl(domain, settings.apiBase), {
        headers: { apikey: apiKey, Accept: 'application/json', 'User-Agent': 'SEOBuddyBot/1.0' },
      }, { policy: { timeoutMs: 8000 }, retries: 1 });
      const parsed = normalizeBusinessUnit(await response.json());
      if (!parsed) return fail('Trustpilot replied with a profile this version does not recognise.');
      return remember({ configured: true, ok: true, fetchedAt: nowIso(), ...parsed });
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) return fail('Trustpilot rejected the API key. Check TRUSTPILOT_API_KEY, and that your Trustpilot plan includes API access.');
      if (error.statusCode === 404) return fail(`Trustpilot has no business profile for ${domain}.`);
      if (error.statusCode === 429) return fail('Trustpilot rate-limited this key. It will retry on the next audit.');
      return fail(publicProviderError(error, {
        provider: 'Trustpilot',
        operation: 'The Trustpilot review check',
        setupPath: 'Settings → Your connections → Trustpilot',
      }).error);
    }
  }

  async function computeReviewsStats() {
    const base = reviewsUrl();
    const checks = [];
    const add = (id, label, ok, detail, severity = 'error') => {
      checks.push({ id, label, status: ok === null ? 'unknown' : ok ? 'pass' : 'fail', detail, severity });
    };

    const startedAt = nowMs();
    let html = '';
    let status = 0;
    let ok = false;
    try {
      const response = await fetchPage(`${base}/`);
      status = response.status;
      ok = response.ok;
      html = await response.text();
    } catch (error) {
      const failure = publicProviderError(error, {
        provider: 'the review website',
        operation: 'The review-site audit',
      });
      return {
        url: base,
        reachable: false,
        error: failure.error,
        checks: [{ id: 'reachable', label: 'Site responds', status: 'fail', detail: failure.error, severity: 'error' }],
      };
    }
    const loadMs = nowMs() - startedAt;
    add('reachable', 'Site responds', ok, `HTTP ${status} in ${loadMs}ms`);
    add('https', 'Served over HTTPS', base.startsWith('https://'), base);
    add('speed', 'Responds under 1.5s', loadMs < 1500, `${loadMs}ms`, 'warn');

    let structuredApi = null;
    let structuredApiAttempted = false;
    let structuredApiError = null;
    const apiUrl = reviewsApiUrl();
    if (apiUrl) {
      structuredApiAttempted = true;
      try {
        const apiResponse = await fetchPage(apiUrl, {}, 5000);
        if (apiResponse && apiResponse.ok) {
          structuredApi = await apiResponse.json();
        } else if (apiResponse) {
          structuredApiError = `HTTP ${apiResponse.status}`;
        }
      } catch (err) {
        structuredApiError = err.message;
      }
    }

    let cards = [];
    if (structuredApi) {
      const isExpired = structuredApi.version === 'expired' || structuredApi.unavailable === true;
      const isIncomplete = structuredApi.completeGoogle === false;

      if (isExpired) {
        add('review-api-freshness', 'Review collection fresh', false,
          'Review collection has expired past the 30-day retention window or is marked unavailable.', 'warn');
      } else {
        add('review-api-freshness', 'Review collection fresh', true,
          structuredApi.checkedAt ? `Verified ${structuredApi.checkedAt}` : 'Active collection');
      }

      if (isIncomplete) {
        add('review-google-complete', 'Complete Google collection', false,
          'Google review collection is incomplete or awaiting re-verification.', 'warn');
      }

      cards = (Array.isArray(structuredApi.reviews) ? structuredApi.reviews : []).map(r => ({
        platform: r.source || 'google',
        author: r.author || 'Client',
        date: r.createdAt ? r.createdAt.slice(0, 7) : '',
        rating: typeof r.rating === 'number' ? r.rating : null,
      }));
    } else {
      if (structuredApiAttempted && structuredApiError) {
        add('review-api-status', 'Review Buddy API responds', false, structuredApiError, 'warn');
      }
      cards = parseReviewCards(html);
    }
    const byPlatform = cards.reduce((result, card) => ({ ...result, [card.platform]: (result[card.platform] || 0) + 1 }), {});
    const rated = cards.filter(card => card.rating);
    const averageRating = rated.length ? Math.round((rated.reduce((sum, card) => sum + card.rating, 0) / rated.length) * 10) / 10 : null;
    const dates = cards.map(card => card.date).filter(date => /^\d{4}-\d{2}$/.test(date)).sort();

    const jsonLd = parseJsonLd(html);
    if (!jsonLd) {
      add('jsonld', 'JSON-LD block present', false, 'No application/ld+json script found — the page is invisible to review rich-results.');
    } else if (jsonLd.__parseError) {
      add('jsonld', 'JSON-LD parses', false, jsonLd.__parseError);
    } else {
      add('jsonld', 'JSON-LD present and parses', true, `${(jsonLd.review || []).length} review objects`);
      const jsonLdCount = (jsonLd.review || []).length;
      add('ld-match', 'JSON-LD matches visible cards', jsonLdCount === cards.length,
        jsonLdCount === cards.length ? `${cards.length} both sides` : `${cards.length} cards vs ${jsonLdCount} in JSON-LD`);
      const ratings = (jsonLd.review || []).map(review => review?.reviewRating?.ratingValue).filter(value => typeof value === 'number');
      const mean = ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null;
      const aggregate = jsonLd.aggregateRating || {};
      add('agg-honest', 'aggregateRating equals the real mean', mean != null && aggregate.ratingValue === mean,
        `declared ${aggregate.ratingValue ?? '—'}, actual ${mean ?? '—'}`);
      add('agg-count', 'aggregateRating count is at least what is shown',
        typeof aggregate.reviewCount === 'number' && aggregate.reviewCount >= cards.length,
        `declared ${aggregate.reviewCount ?? '—'} vs ${cards.length} published`, 'warn');
      const belowFive = ratings.filter(value => value < 5).length;
      add('five-star', 'Every published review is 5★', belowFive === 0,
        belowFive ? `${belowFive} review(s) below 5★ are published` : `all ${ratings.length} are 5★`, 'warn');
    }

    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const description = metaContent(html, 'name', 'description') || '';
    const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i) || [])[1] || '';
    add('title', 'Title tag is a sensible length', title.length >= 30 && title.length <= 65, `${title.length} chars`, 'warn');
    add('desc', 'Meta description is a sensible length', description.length >= 70 && description.length <= 165, `${description.length} chars`, 'warn');
    add('canonical', 'Canonical URL present', !!canonical, canonical || 'missing');

    const ogImage = metaContent(html, 'property', 'og:image');
    if (!ogImage) {
      add('og-image', 'Social preview image declared', false, 'no og:image meta tag');
    } else {
      try {
        const response = await fetchPage(ogImage, { method: 'GET' }, 10000);
        const contentType = response.headers.get('content-type') || '';
        add('og-image', 'Social preview image resolves', response.ok && contentType.startsWith('image/'),
          response.ok ? `HTTP ${response.status}, content-type ${contentType || 'unknown'}` : `HTTP ${response.status}`);
      } catch (error) {
        add('og-image', 'Social preview image resolves', false, error.message);
      }
    }

    let sitemapLastmod = null;
    try {
      const response = await fetchPage(`${base}/sitemap.xml`, {}, 8000);
      const body = response.ok ? await response.text() : '';
      const isXml = body.trim().startsWith('<?xml') || body.includes('<urlset');
      sitemapLastmod = (body.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || null;
      add('sitemap', 'sitemap.xml served', response.ok && isXml, response.ok ? (isXml ? `lastmod ${sitemapLastmod || 'absent'}` : 'served, but not XML') : `HTTP ${response.status}`, 'warn');
      if (sitemapLastmod) {
        const ageDays = Math.floor((nowMs() - new Date(sitemapLastmod).getTime()) / 86400000);
        add('sitemap-fresh', 'sitemap lastmod is recent', ageDays <= 60, `${ageDays} days old`, 'warn');
      }
    } catch (error) {
      add('sitemap', 'sitemap.xml served', false, error.message, 'warn');
    }
    try {
      const response = await fetchPage(`${base}/robots.txt`, {}, 8000);
      const body = response.ok ? await response.text() : '';
      const blocksAll = /Disallow:\s*\/\s*$/m.test(body) && !/Allow:\s*\//m.test(body);
      add('robots', 'robots.txt allows crawling', response.ok && !blocksAll, response.ok ? (blocksAll ? 'Disallow: / is blocking crawlers' : 'crawlable') : `HTTP ${response.status}`);
    } catch (error) {
      add('robots', 'robots.txt allows crawling', null, error.message, 'warn');
    }

    const headerTotal = Number(((html.match(/<b id="rev-count">([\d,]+)\+?<\/b>/) || [])[1] || '').replace(/,/g, '')) || null;
    const platformTotals = {};
    const googleMatch = html.match(/<b>Google<\/b><div class="s">[^<]*?([\d.]+)\s*·\s*(\d+)/);
    if (googleMatch) platformTotals.google = { avgRating: Number(googleMatch[1]), reviewCount: Number(googleMatch[2]) };
    const facebookMatch = html.match(/<b>Facebook<\/b><div class="s">[^<]*?(\d+)%\s*·\s*(\d+)/);
    if (facebookMatch) platformTotals.facebook = { recommendPercent: Number(facebookMatch[1]), reviewCount: Number(facebookMatch[2]) };
    const yelpMatch = html.match(/<b>Yelp<\/b><div class="s">[^<]*?(\d+)\s*reviews/);
    if (yelpMatch) platformTotals.yelp = { reviewCount: Number(yelpMatch[1]) };
    const trustpilotMatch = html.match(/<b>Trustpilot<\/b><div class="s">[^<]*?([\d.]+)\s*·\s*(\d+)/);
    if (trustpilotMatch) platformTotals.trustpilot = { avgRating: Number(trustpilotMatch[1]), reviewCount: Number(trustpilotMatch[2]), source: 'page' };

    const trustpilot = await fetchTrustpilot();
    if (trustpilot.configured && trustpilot.ok) {
      const claim = comparePageClaim(platformTotals.trustpilot, trustpilot);
      platformTotals.trustpilot = {
        avgRating: trustpilot.trustScore,
        stars: trustpilot.stars,
        reviewCount: trustpilot.reviewCount,
        source: 'api',
        profileUrl: trustpilot.profileUrl,
      };
      add('trustpilot', 'Trustpilot profile reachable', true,
        trustpilot.reviewCount
          ? `TrustScore ${trustpilot.trustScore ?? '—'} from ${trustpilot.reviewCount} review${trustpilot.reviewCount === 1 ? '' : 's'}`
          : 'Profile is live but has no reviews yet.');
      if (claim) {
        add('trustpilot-drift', 'Trustpilot count on the page is current', claim.matches,
          claim.matches ? `${claim.actual} both sides` : `page says ${claim.claimed}, Trustpilot says ${claim.actual}`, 'warn');
      }
    } else if (trustpilot.configured) {
      add('trustpilot', 'Trustpilot profile reachable', false, trustpilot.error, 'warn');
    }

    const today = nowIso().split('T')[0];
    const row = { date: today, published: cards.length, byPlatform, headerTotal };
    if (trustpilot.configured && trustpilot.ok) {
      row.trustpilot = {
        trustScore: trustpilot.trustScore ?? null,
        reviewCount: trustpilot.reviewCount ?? null,
        negative: negativeCount(trustpilot.distribution),
      };
    }
    const update = upsertDailySnapshot(reviewsSnapshots, row, 365);
    reviewsSnapshots = update.snapshots;
    if (update.changed) saveSnapshots(reviewsSnapshots);

    let delta30 = null;
    const cutoff = nowMs() - 30 * 86400000;
    const older = reviewsSnapshots.filter(snapshot => new Date(`${snapshot.date}T00:00:00Z`).getTime() <= cutoff);
    if (older.length) delta30 = cards.length - older[older.length - 1].published;

    let trustpilotOutput = trustpilot;
    if (trustpilot.configured && trustpilot.ok) {
      const trend = trustpilotTrend(reviewsSnapshots, trustpilot, today, 30);
      trustpilotOutput = { ...trustpilot, trend };
      const window = trend.partial ? `since ${trend.since}` : 'in 30 days';
      if (!trend.comparable) {
        add('trustpilot-trend', 'Trustpilot trend', null, 'Recording starts today — movement shows up here from tomorrow.', 'warn');
      } else {
        add('trustpilot-score', 'TrustScore is holding or rising', trend.scoreDelta == null || trend.scoreDelta >= 0,
          trend.scoreDelta == null ? 'no earlier score to compare'
            : (trend.scoreDelta === 0 ? `unchanged at ${trend.now.trustScore} ${window}` : `${trend.scoreDelta > 0 ? '+' : ''}${trend.scoreDelta} ${window}, now ${trend.now.trustScore}`), 'warn');
        add('trustpilot-negative', 'No new one- or two-star reviews', trend.negativeDelta == null || trend.negativeDelta <= 0,
          trend.negativeDelta == null ? 'no star breakdown available'
            : (trend.negativeDelta > 0 ? `${trend.negativeDelta} new low rating${trend.negativeDelta === 1 ? '' : 's'} ${window} — worth replying to` : `none ${window}`), 'warn');
        add('trustpilot-flow', 'Still collecting new reviews', trend.reviewDelta == null || trend.reviewDelta > 0,
          trend.reviewDelta == null ? 'no earlier count to compare'
            : (trend.reviewDelta > 0 ? `+${trend.reviewDelta} ${window}` : `nothing new ${window} — recent reviews carry the most weight`), 'warn');
      }
    }

    const failed = checks.filter(check => check.status === 'fail');
    const score = checks.length
      ? Math.round((checks.filter(check => check.status === 'pass').length / checks.filter(check => check.status !== 'unknown').length) * 100)
      : null;
    return {
      url: base,
      reachable: true,
      checkedAt: nowIso(),
      loadMs,
      score,
      inventory: {
        published: cards.length,
        byPlatform,
        avgRating: averageRating,
        newest: dates.length ? dates[dates.length - 1] : null,
        oldest: dates.length ? dates[0] : null,
        delta30,
      },
      growth: monthlyGrowth(cards),
      platformTotals,
      trustpilot: trustpilotOutput,
      headerTotal,
      checks,
      problems: failed.length,
      snapshots: reviewsSnapshots.slice(-90),
      reviews: cards,
    };
  }

  async function getStats() {
    const fresh = statsCache && nowMs() - statsCache.cachedAt < cacheTtlMs;
    if (!fresh) {
      if (!statsPromise) {
        statsPromise = computeReviewsStats()
          .then(data => {
            statsCache = { cachedAt: nowMs(), data };
            return data;
          })
          .finally(() => { statsPromise = null; });
      }
      await statsPromise;
    }
    return statsCache.data;
  }

  return {
    computeReviewsStats,
    fetchTrustpilot,
    getSnapshots: () => reviewsSnapshots,
    getStats,
  };
}

function registerReviewsRoutes(app, options) {
  const { service, logger = console } = options;
  app.get('/api/reviews-stats', async (req, res) => {
    try {
      return res.json({ success: true, ...(await service.getStats()) });
    } catch (error) {
      const failure = publicProviderError(error, {
        provider: 'the review service',
        operation: 'The reviews dashboard',
      });
      logger.error('[Reviews] stats failed:', failure.code);
      return res.status(500).json({ success: false, code: failure.code, error: failure.error });
    }
  });
}

module.exports = {
  createReviewsService,
  metaContent,
  monthlyGrowth,
  parseJsonLd,
  parseReviewCards,
  registerReviewsRoutes,
};
