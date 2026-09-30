'use strict';

const GHL_POSTS_URL = 'https://services.leadconnectorhq.com/blogs/posts';

function jsonForHtml(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function articleSlug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function validateFactualPublication(title, content) {
  const text = `${title || ''} ${content || ''}`.replace(/<[^>]*>/g, ' ');

  // 1. Prohibited claims: medical-grade
  if (/\bmedical[- ]grade\b/i.test(text)) {
    const error = new Error('Factual validation failed: Prohibited claim "medical-grade" found.');
    error.code = 'FACTUAL_VALIDATION_FAILED';
    throw error;
  }

  // 2. Prohibited claims: cure / cures / curing
  if (/\b(?:cure|cures|curing)\b/i.test(text)) {
    const error = new Error('Factual validation failed: Prohibited medical cure claim found.');
    error.code = 'FACTUAL_VALIDATION_FAILED';
    throw error;
  }

  // 3. Prohibited personal training models: semi-private or group classes (1-on-1 private training only)
  if (/\bsemi[- ]private\b/i.test(text) || /\bgroup (?:fitness )?classes\b/i.test(text)) {
    const error = new Error('Factual validation failed: Best Day Fitness personal training must be 1-on-1 private training only.');
    error.code = 'FACTUAL_VALIDATION_FAILED';
    throw error;
  }

  // 4. Consultation duration: strictly 45 minutes
  // Specific to consultation; personal training sessions are normally 60m (with 30m available)
  const invalidConsultDurationPatterns = [
    /\b(?:60|30|90|120)[- ]min(?:ute)?s?\s+(?:initial\s+)?consultations?\b/i,
    /\b(?:1|one|2|two)[- ]hours?\s+(?:initial\s+)?consultations?\b/i,
    /\bconsultations?\s+(?:is|are|lasts?|taking?|takes?)\s+(?:for\s+)?(?:60|30|90|120)\s*min(?:ute)?s?\b/i,
    /\bconsultations?\s+(?:is|are|lasts?|taking?|takes?)\s+(?:for\s+)?(?:1|one|2|two)\s*hours?\b/i,
    /\bconsultations?\s+of\s+(?:60|30|90|120)\s*min(?:ute)?s?\b/i,
    /\b(?:lasts?|take|takes)\s+(?:60|30|90|120)\s*min(?:ute)?s?\s+for\s+(?:the|your|a)?\s*consultations?\b/i,
  ];

  for (const pattern of invalidConsultDurationPatterns) {
    if (pattern.test(text)) {
      const error = new Error('Factual validation failed: Consultation duration must be 45 minutes.');
      error.code = 'FACTUAL_VALIDATION_FAILED';
      throw error;
    }
  }

  // 5. Consultation price: $99 (normally $200)
  if (/\b(?:free|complimentary|\$0)\s+consultations?\b/i.test(text) ||
      /\bconsultations?\s+(?:is|are|for)?\s*(?:free|complimentary|\$0)\b/i.test(text)) {
    const error = new Error('Factual validation failed: Consultations are not free ($99 fee applies).');
    error.code = 'FACTUAL_VALIDATION_FAILED';
    throw error;
  }

  const consultPricePatterns = [
    /\$(\d+)(?:\.\d{2})?\s+(?:initial\s+)?consultations?\b/i,
    /\bconsultations?\s+(?:cost|costs|is|are|priced at|fee is|fee of|for|at)\s+\$(\d+)(?:\.\d{2})?\b/i,
    /\bconsultations?\s+(?:fee|rate|cost|price)\s+(?:of|is)?\s*\$(\d+)(?:\.\d{2})?\b/i,
    /\bfee\s+(?:for|of)\s+(?:the|your|a)?\s*consultations?\s+(?:is|at)?\s*\$(\d+)(?:\.\d{2})?\b/i,
  ];

  for (const pattern of consultPricePatterns) {
    const match = text.match(pattern);
    if (match) {
      const price = match[1];
      if (price !== '99' && price !== '200') {
        const error = new Error(`Factual validation failed: Consultation price must be $99 (normally $200), found $${price}.`);
        error.code = 'FACTUAL_VALIDATION_FAILED';
        throw error;
      }
    }
  }
}

function createArticlePublishingService(options) {
  const {
    getHistory,
    sanitizeArticleHtml,
    safeHttpUrl,
    escapeHtml,
    buildLocalBusinessSchema,
    getBusinessName,
    providerRuntime,
    env,
    allowMockIntegrations,
    integrationUnavailable,
    now = () => new Date(),
  } = options;

  for (const [name, dependency] of Object.entries({
    getHistory,
    sanitizeArticleHtml,
    safeHttpUrl,
    escapeHtml,
    buildLocalBusinessSchema,
    getBusinessName,
    integrationUnavailable,
  })) {
    if (typeof dependency !== 'function') throw new TypeError(`${name} is required.`);
  }
  if (!providerRuntime || typeof providerRuntime.fetch !== 'function') throw new TypeError('providerRuntime.fetch is required.');
  if (!env || typeof env !== 'object') throw new TypeError('env is required.');

  async function publish(title, content, status, config = {}) {
    validateFactualPublication(title, content);

    const locationId = config.locationId || env.GHL_LOCATION_ID;
    const accessToken = config.accessToken || env.GHL_ACCESS_TOKEN;
    const blogId = config.blogId || env.GHL_BLOG_ID;
    const author = config.authorId || env.GHL_AUTHOR_ID || 'default-author';
    const siteUrl = config.siteUrl || env.GSC_SITE_URL || 'https://bestdayfitness.com';
    const blogPrefix = config.blogPrefix || env.GHL_BLOG_PATH_PREFIX || '/post';
    const authorName = config.authorName || env.GHL_AUTHOR_NAME || '';
    const authorUrl = config.authorUrl || env.GHL_AUTHOR_URL || '';

    let baseDomain = String(siteUrl || '').trim();
    if (baseDomain.startsWith('sc-domain:')) baseDomain = `https://${baseDomain.substring(10)}`;
    baseDomain = (safeHttpUrl(baseDomain, 'https://bestdayfitness.com') || 'https://bestdayfitness.com').replace(/\/$/, '');

    const cleanPrefix = blogPrefix.startsWith('/') ? blogPrefix : `/${blogPrefix}`;
    const formattedPrefix = cleanPrefix.endsWith('/') ? cleanPrefix.slice(0, -1) : cleanPrefix;
    const slug = articleSlug(title);

    let resolvedContent = sanitizeArticleHtml(content);
    resolvedContent = resolvedContent.replace(/\[Link:\s*([^\]]+)\]/gi, (match, label) => {
      const term = label.trim().toLowerCase();
      const matchedPost = getHistory().find(item =>
        item.keyword.toLowerCase().includes(term)
        || item.title.toLowerCase().includes(term)
        || term.includes(item.keyword.toLowerCase()));
      const href = matchedPost
        ? safeHttpUrl(matchedPost.url, `${baseDomain}${formattedPrefix}`)
        : `${baseDomain}${formattedPrefix}`;
      return `<a href="${escapeHtml(href)}" class="internal-link" style="color: #1a73e8; text-decoration: underline;">${escapeHtml(label.trim())}</a>`;
    });

    const faqItems = [];
    const faqPattern = /(?:<strong>|<b>)Q:\s*([\s\S]*?)(?:<\/strong>|<\/b>)[\s\S]*?<p>(?:A:\s*)?([\s\S]*?)<\/p>/gi;
    let faqMatch;
    while ((faqMatch = faqPattern.exec(resolvedContent)) !== null) {
      if (faqMatch[1] && faqMatch[2]) {
        faqItems.push({
          question: faqMatch[1].replace(/<[^>]*>/g, '').trim(),
          answer: faqMatch[2].replace(/<[^>]*>/g, '').trim(),
        });
      }
    }

    let schemaScripts = '';
    if (faqItems.length > 0) {
      const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems.map(item => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      };
      schemaScripts += `\n<script type="application/ld+json">\n${jsonForHtml(faqSchema)}\n</script>`;
    }

    schemaScripts += `\n<script type="application/ld+json">\n${jsonForHtml(buildLocalBusinessSchema(baseDomain))}\n</script>`;

    if (authorName) {
      const authorSchema = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: title,
        url: `${baseDomain}${formattedPrefix}/${slug}`,
        datePublished: now().toISOString(),
        author: { '@type': 'Person', name: authorName, url: authorUrl || undefined },
        publisher: {
          '@type': 'Organization',
          name: 'Best Day Fitness',
          logo: { '@type': 'ImageObject', url: `${baseDomain}/assets/logo.png` },
        },
      };
      schemaScripts += `\n<script type="application/ld+json">\n${jsonForHtml(authorSchema)}\n</script>`;

      const authorBio = config.authorBio || env.GHL_AUTHOR_BIO || '';
      let authorHtml = '\n<div class="article-author-card" style="margin-top: 40px; padding: 20px; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.01); border-radius: 8px; display: flex; align-items: center; gap: 15px;">';
      authorHtml += '<div class="author-info">';
      authorHtml += '<span style="font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Published By Expert Coach</span>';
      if (authorUrl) {
        authorHtml += `<a href="${escapeHtml(safeHttpUrl(authorUrl, baseDomain))}" target="_blank" rel="noopener noreferrer" style="font-size: 16px; font-weight: bold; color: #1a73e8; text-decoration: none;">${escapeHtml(authorName)}</a>`;
      } else {
        authorHtml += `<strong style="font-size: 16px; font-weight: bold; color: #fff;">${escapeHtml(authorName)}</strong>`;
      }
      if (authorBio) {
        authorHtml += `<p style="font-size: 13px; color: #aaa; margin: 6px 0 0 0; line-height: 1.4;">${escapeHtml(authorBio)}</p>`;
      }
      authorHtml += '</div></div>';
      resolvedContent += authorHtml;
    }

    const reviewsUrl = safeHttpUrl(env.REVIEWS_URL || 'https://bestdayfitnessreviews.com');
    if (reviewsUrl) {
      resolvedContent += `\n<p style="margin-top: 28px; font-size: 15px;">Curious what our clients say? <a href="${escapeHtml(reviewsUrl)}" style="color: #1a73e8; text-decoration: underline;">Read ${escapeHtml(getBusinessName())} reviews</a>.</p>`;
    }
    resolvedContent += schemaScripts;

    // Validate the final assembled publication (including author information, links, and schema)
    validateFactualPublication(title, resolvedContent);

    if (!accessToken || !locationId || !blogId) {
      if (!allowMockIntegrations) {
        throw integrationUnavailable(
          'gohighlevel',
          'GoHighLevel publishing is not fully configured. GHL_ACCESS_TOKEN, GHL_LOCATION_ID, and GHL_BLOG_ID are required.',
        );
      }
      return {
        success: true,
        source: 'mock_ghl',
        postId: `mock-post-${now().getTime()}`,
        url: `${baseDomain}${formattedPrefix}/${slug}`,
        content: resolvedContent,
        message: 'Article saved in mock mode. Setup GHL keys to go live!',
      };
    }

    const payload = {
      locationId,
      blogId,
      title,
      description: content.replace(/<[^>]*>/g, '').substring(0, 150).trim() + '...',
      rawHTML: resolvedContent,
      status: (status || 'draft').toUpperCase(),
      categories: [],
      imageUrl: '',
      imageAltText: '',
      urlSlug: slug,
      publishedAt: now().toISOString(),
    };
    if (author && author !== 'default-author') payload.author = author;

    const response = await providerRuntime.fetch('gohighlevel', GHL_POSTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-04-15',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, { retries: 0 });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `GHL HTTP error! status: ${response.status}`);

    return {
      success: true,
      source: 'live_ghl',
      postId: data.id || data.postId,
      url: data.url || `${baseDomain}${formattedPrefix}/${slug}`,
      content: resolvedContent,
      message: 'Article successfully published to GoHighLevel!',
    };
  }

  return { publish };
}

module.exports = {
  GHL_POSTS_URL,
  articleSlug,
  createArticlePublishingService,
  jsonForHtml,
  validateFactualPublication,
};
