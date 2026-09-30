'use strict';

function textOnly(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return textOnly(value).split(/\s+/).filter(Boolean);
}

function assessArticleQuality(html, options = {}) {
  const source = String(html || '');
  const wordCount = words(source).length;
  const firstParagraph = (source.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
  const firstParagraphWords = words(firstParagraph).length;
  const headings = [...source.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map(match => textOnly(match[1]));
  const questionHeadings = headings.filter(heading => /\?$/.test(heading)).length;
  const brandViolations = Array.isArray(options.brandViolations) ? options.brandViolations.filter(Boolean) : [];
  const claimsToCheck = Array.isArray(options.claimsToCheck) ? options.claimsToCheck.filter(Boolean) : [];
  const claimsViolations = Array.isArray(options.claimsViolations) ? [...options.claimsViolations.filter(Boolean)] : [];
  const prohibitedClaimsPatterns = [
    /\bmedical-?grade\b/i,
    /\bcures?\s+(?:disease|pain|arthritis|cancer|diabetes)\b/i,
    /\bguaranteed\s+weight\s+loss\b/i,
    /\bsemi-?private\s+training\b/i,
  ];
  for (const pattern of prohibitedClaimsPatterns) {
    const match = source.match(pattern);
    if (match && !claimsViolations.includes(match[0])) {
      claimsViolations.push(match[0]);
    }
  }
  const checks = [
    { key: 'substantive', label: 'Substantive depth', weight: 20, pass: wordCount >= 700, detail: `${wordCount} words` },
    { key: 'answerFirst', label: 'Answer-first opening', weight: 15, pass: firstParagraphWords >= 25 && firstParagraphWords <= 100, detail: `${firstParagraphWords} words in opening answer` },
    { key: 'questionHeadings', label: 'Question-style sections', weight: 15, pass: questionHeadings >= 2, detail: `${questionHeadings} question heading${questionHeadings === 1 ? '' : 's'}` },
    { key: 'structure', label: 'Scannable structure', weight: 10, pass: headings.length >= 4, detail: `${headings.length} H2/H3 sections` },
    { key: 'lists', label: 'Actionable lists', weight: 8, pass: /<(?:ul|ol)\b/i.test(source), detail: /<(?:ul|ol)\b/i.test(source) ? 'List present' : 'No list found' },
    { key: 'comparison', label: 'Extractable comparison', weight: 7, pass: /<table\b/i.test(source), detail: /<table\b/i.test(source) ? 'Table present' : 'No table found' },
    { key: 'faq', label: 'FAQ coverage', weight: 10, pass: /faq|frequently asked/i.test(source), detail: /faq|frequently asked/i.test(source) ? 'FAQ present' : 'FAQ not found' },
    { key: 'cta', label: 'Clear next step', weight: 10, pass: /<a\b[^>]*href=/i.test(source), detail: /<a\b[^>]*href=/i.test(source) ? 'Linked call to action present' : 'No linked call to action' },
    { key: 'brandSafety', label: 'Brand-language safety', weight: 5, pass: brandViolations.length === 0 && claimsViolations.length === 0, detail: (brandViolations.length + claimsViolations.length) ? `${brandViolations.length + claimsViolations.length} blocked phrase(s) or claim(s) found` : 'No blocked phrases found' },
  ];
  const score = Math.round(checks.reduce((sum, check) => sum + (check.pass ? check.weight : 0), 0));
  const blockingIssues = [];
  if (wordCount < 300) blockingIssues.push('Article is too short to publish safely.');
  if (headings.length < 2) blockingIssues.push('Article lacks enough section structure.');
  if (brandViolations.length) blockingIssues.push('Article contains blocked brand phrases.');
  if (claimsViolations.length) blockingIssues.push(`Article contains prohibited factual claims: ${claimsViolations.join(', ')}.`);
  return {
    version: 1,
    score,
    status: score >= 85 ? 'excellent' : score >= 70 ? 'ready' : 'needs-review',
    publishable: blockingIssues.length === 0,
    wordCount,
    claimsToCheck: claimsToCheck.length,
    brandViolations: brandViolations.length,
    claimsViolations: claimsViolations.length,
    blockingIssues,
    checks,
    topFixes: checks.filter(check => !check.pass).sort((a, b) => b.weight - a.weight).slice(0, 3).map(check => check.label),
  };
}

module.exports = { assessArticleQuality, textOnly };
