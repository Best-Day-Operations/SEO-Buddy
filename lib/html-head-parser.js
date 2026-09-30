'use strict';

/**
 * Token-based parser for HTML head and visible content.
 * Guarantees that tags inside comments or scripts/styles are never misidentified as document metadata.
 */

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Parses <head> content and extracts authentic metadata elements.
 * Ignores any tags or text located within <script>, <style>, or HTML comments.
 */
function parseHeadElements(html, headers = {}) {
  const rawHtml = String(html || '');
  const noComments = stripComments(rawHtml);

  // Extract <head>...</head> region
  const headMatch = noComments.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headText = headMatch ? headMatch[1] : '';

  // Extract JSON-LD scripts before stripping other scripts
  const schemaBlocks = [];
  const malformedJsonLd = [];
  const jsonLdRegex = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonMatch;
  while ((jsonMatch = jsonLdRegex.exec(noComments)) !== null) {
    const rawSnippet = jsonMatch[1].trim();
    try {
      const parsed = JSON.parse(rawSnippet);
      schemaBlocks.push(parsed);
    } catch (err) {
      const entry = {
        valid: false,
        parseError: err.message,
        rawSnippet: rawSnippet.slice(0, 150),
      };
      schemaBlocks.push(entry);
      malformedJsonLd.push(entry);
    }
  }

  // Strip all <script> and <style> tags from headText so their contents can never match title/meta
  const sanitizedHead = headText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // 1. Extract <title>
  const titleMatch = sanitizedHead.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // 2. Extract <meta> tags
  const metaTags = [];
  const metaRegex = /<meta\b([^>]*)\/?>/gi;
  let mMatch;
  while ((mMatch = metaRegex.exec(sanitizedHead)) !== null) {
    const attrsStr = mMatch[1];
    const attrs = parseAttributes(attrsStr);
    metaTags.push(attrs);
  }

  // Meta description
  const descTag = metaTags.find(m => (m.name || '').toLowerCase() === 'description');
  const description = descTag ? (descTag.content || '').trim() : '';

  // Meta robots — merge duplicate directives
  const robotsDirectives = [];
  for (const m of metaTags) {
    if ((m.name || '').toLowerCase() === 'robots') {
      const content = (m.content || '').trim().toLowerCase();
      if (content) robotsDirectives.push(content);
    }
  }

  // HTTP X-Robots-Tag header integration
  const headerRobots = headers['x-robots-tag'] || headers['X-Robots-Tag'] || '';
  if (headerRobots) {
    robotsDirectives.push(`header: ${String(headerRobots).trim().toLowerCase()}`);
  }

  const combinedRobots = robotsDirectives.join(', ');
  const isNoindex = combinedRobots.includes('noindex');

  // 3. Extract <link> tags
  const linkTags = [];
  const linkRegex = /<link\b([^>]*)\/?>/gi;
  let lMatch;
  while ((lMatch = linkRegex.exec(sanitizedHead)) !== null) {
    linkTags.push(parseAttributes(lMatch[1]));
  }

  // Canonical link
  const canonTag = linkTags.find(l => (l.rel || '').toLowerCase() === 'canonical');
  const canonical = canonTag ? (canonTag.href || '').trim() : '';

  // Open Graph
  const ogTitle = (metaTags.find(m => (m.property || '').toLowerCase() === 'og:title')?.content || '').trim();
  const ogDescription = (metaTags.find(m => (m.property || '').toLowerCase() === 'og:description')?.content || '').trim();
  const ogImage = (metaTags.find(m => (m.property || '').toLowerCase() === 'og:image')?.content || '').trim();

  // 4. Visible Content Analysis: strip scripts, styles, templates, comments from full document
  const visibleContent = noComments
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ');

  // Headings from visible content only
  const h1Matches = visibleContent.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  const h1Texts = h1Matches.map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const h2Count = (visibleContent.match(/<h2\b[^>]*>/gi) || []).length;
  const h3Count = (visibleContent.match(/<h3\b[^>]*>/gi) || []).length;

  // Phone and Address in visible text
  const phoneFound = visibleContent.includes('727') &&
    (visibleContent.includes('334-1472') || visibleContent.includes('3341472') || visibleContent.includes('(727) 334-1472'));
  const addressFound = visibleContent.includes('6619 1st Ave') || visibleContent.includes('6619 1st Avenue');

  // Inlined assets
  const scriptTags = noComments.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
  let scriptBytes = 0;
  scriptTags.forEach(s => { scriptBytes += s.length; });
  const base64Matches = noComments.match(/data:[^;]+;base64,[a-zA-Z0-9+/=]+/gi) || [];

  return {
    title,
    description,
    canonical,
    robots: combinedRobots,
    isNoindex,
    metaTags,
    linkTags,
    og: {
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
    },
    schemaBlocks,
    malformedJsonLd,
    headings: {
      h1Count: h1Texts.length,
      h1Texts,
      h2Count,
      h3Count,
    },
    assets: {
      scriptTagCount: scriptTags.length,
      scriptBytes,
      base64Count: base64Matches.length,
    },
    phoneFound,
    addressFound,
    hasExplicitHead: Boolean(headMatch),
  };
}

/**
 * Parses attribute string from an HTML tag into a key-value dictionary.
 */
function parseAttributes(attrStr) {
  const attrs = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = attrRegex.exec(attrStr)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : ''));
    attrs[key] = val;
  }
  return attrs;
}

module.exports = {
  stripComments,
  parseAttributes,
  parseHeadElements,
};
