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

const PROHIBITED_CLAIMS_PATTERNS = Object.freeze([
  { pattern: /\bmedical-?grade\b/i, label: 'medical-grade' },
  { pattern: /\bcures?\s+(?:disease|pain|arthritis|cancer|diabetes)\b/i, label: 'unsubstantiated medical cure claim' },
  { pattern: /\bguaranteed\s+weight\s+loss\b/i, label: 'guaranteed weight loss' },
  { pattern: /\bsemi-?private\s+training\b/i, label: 'semi-private training (only 1-on-1 private training is offered)' },
  { pattern: /\b(?:mon(?:day)?\s*[-–]\s*fri(?:day)?\s*)?6\s*(?::\s*00)?\s*am\s*[-–]\s*7\s*(?::\s*00)?\s*pm\b/i, label: 'obsolete studio schedule (6 AM–7 PM)' },
  { pattern: /\b(?:sat(?:urday)?\s*)?8\s*(?::\s*00)?\s*am\s*[-–]\s*1\s*(?::\s*00)?\s*pm\b/i, label: 'obsolete Saturday schedule (8 AM–1 PM)' },
  { pattern: /\bmembership\s+experience\s+team\b/i, label: 'obsolete team naming (Membership Experience Team instead of Client Experience Team)' },
  { pattern: /\b90\s*[-–\s]*minute\s+consultation\b/i, label: 'incorrect consultation duration (90 min instead of 45 min)' },
  { pattern: /\$999(?:\.00)?\s*(?:for\s+)?(?:public|monthly)?\s*(?:halored|recovery)/i, label: 'incorrect HaloRed price ($999 instead of $399)' },
]);

const APPROVED_FACTS_PATTERNS = Object.freeze([
  { key: 'appointmentOnly', label: 'Appointment-only studio', pattern: /\bby\s+appointment(?:\s+only)?|\bappointment\s+only\b/i },
  { key: 'barefootStudio', label: 'Barefoot training environment', pattern: /\bbarefoot(?:\s+training|\s+studio|\s+environment)?\b/i },
  { key: 'stPeteLocation', label: 'St. Petersburg, FL location', pattern: /\bst\.?\s*petersburg(?:,\s*fl)?\b/i },
  { key: 'streetAddress', label: '6619 1st Ave S address', pattern: /\b6619\s+1st\s+ave(?:nue)?\s+s(?:outh)?\b/i },
  { key: 'phone', label: '(727) 334-1472 phone number', pattern: /\(?727\)?[\s.-]*334[\s.-]*1472\b/ },
  { key: 'consultationDuration', label: '45-minute consultation', pattern: /\b45\s*[-–\s]*minute(?:\s+fitness)?\s+consultation\b/i },
  { key: 'consultationPrice', label: '$99 initial consultation ($200 value)', pattern: /\$99(?:\.00)?\b/ },
  { key: 'clientExperienceTeam', label: 'Client Experience Team', pattern: /\bclient\s+experience\s+team\b/i },
  { key: 'haloredPrice', label: 'HaloRed $39.99 session', pattern: /\$39\.99\b/ },
  { key: 'haloredMembership', label: 'HaloRed $299/$399 monthly recovery plans', pattern: /\$299\b|\$399\b/ },
  { key: 'personalTraining', label: 'One-on-one personal training (60 min / 30 min)', pattern: /\bone[-–\s]on[-–\s]one\s+personal\s+training\b/i },
  { key: 'physicalTherapy', label: 'In-house physical therapy with Dr. George', pattern: /\bdr\.?\s*george\b/i },
  { key: 'wellnessCoaching', label: 'Holistic wellness coaching', pattern: /\bwellness\s+coaching\b/i },
]);

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

  for (const item of PROHIBITED_CLAIMS_PATTERNS) {
    const match = source.match(item.pattern);
    if (match && !claimsViolations.includes(item.label)) {
      claimsViolations.push(item.label);
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

function assessPageQuality(html, options = {}) {
  const source = String(html || '');
  const pageType = String(options.pageType || 'default').toLowerCase();
  const wordCount = words(source).length;

  // 1. Direct-Answer Hero / Summary (20-120 words in first substantial paragraph or lead block)
  const paragraphs = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => textOnly(m[1]))
    .filter(p => words(p).length >= 10);
  const openingText = paragraphs[0] || '';
  const openingWords = words(openingText).length;
  const hasDirectAnswer = openingWords >= 20 && openingWords <= 120;

  // 2. Question-Style Headings (AEO / GEO direct inquiry alignment)
  const headings = [...source.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m => textOnly(m[1]));
  const questionHeadings = headings.filter(h => /\?$/.test(h) || /^(?:what|how|who|why|where|when|can|is|are|which)\b/i.test(h));

  // 3. Prohibited Claims Check (Strict Truthful Governance)
  const claimsViolations = [];
  const brandViolations = Array.isArray(options.brandViolations) ? [...options.brandViolations] : [];

  for (const item of PROHIBITED_CLAIMS_PATTERNS) {
    if (item.pattern.test(source)) {
      claimsViolations.push(item.label);
    }
  }

  // 4. Approved Facts Verification (tailored to pageType)
  const verifiedFacts = [];
  const missingFacts = [];

  const requiredKeys = (pageType === 'consultation')
    ? ['stPeteLocation', 'consultationDuration', 'consultationPrice', 'clientExperienceTeam', 'appointmentOnly']
    : (pageType === 'halored')
    ? ['stPeteLocation', 'haloredPrice', 'haloredMembership', 'appointmentOnly']
    : (pageType === 'personal-training')
    ? ['stPeteLocation', 'personalTraining', 'appointmentOnly', 'barefootStudio']
    : ['stPeteLocation', 'appointmentOnly', 'barefootStudio', 'phone', 'streetAddress'];

  for (const key of requiredKeys) {
    const factDef = APPROVED_FACTS_PATTERNS.find(f => f.key === key);
    if (!factDef) continue;
    if (factDef.pattern.test(source)) {
      verifiedFacts.push(factDef.label);
    } else {
      missingFacts.push(factDef.label);
    }
  }

  // 5. Structure & Scannability (headings >= 3, list or table present)
  const hasLists = /<(?:ul|ol)\b/i.test(source);
  const hasStructure = headings.length >= 3;

  // 6. Clear Call to Action (non-breaking booking/contact action)
  const hasCta = /<a\b[^>]*href=["'](?:https?:\/\/|\/|#|tel:|mailto:)[^"']*["']/i.test(source) || /<button\b/i.test(source);

  // 7. FAQ Coverage
  const hasFaq = /faq|frequently asked|common questions/i.test(source) || questionHeadings.length >= 2;

  // Check scoring
  const checks = [
    { key: 'directAnswer', label: 'Direct-answer summary (20–120 words)', weight: 15, pass: hasDirectAnswer, detail: `${openingWords} words in opening summary` },
    { key: 'questionHeadings', label: 'Inquiry & question headings', weight: 15, pass: questionHeadings.length >= 2, detail: `${questionHeadings.length} question heading(s)` },
    { key: 'approvedFacts', label: 'Approved studio facts & pricing', weight: 25, pass: missingFacts.length === 0, detail: `${verifiedFacts.length}/${requiredKeys.length} verified; missing: ${missingFacts.join(', ') || 'none'}` },
    { key: 'prohibitedClaims', label: 'Truthful governance (no prohibited claims)', weight: 20, pass: claimsViolations.length === 0, detail: claimsViolations.length ? `Violations: ${claimsViolations.join(', ')}` : 'Zero prohibited claims' },
    { key: 'structure', label: 'Scannable headings & lists', weight: 15, pass: hasStructure && hasLists, detail: `${headings.length} headings, ${hasLists ? 'lists present' : 'no lists'}` },
    { key: 'cta', label: 'Clear appointment / booking CTA', weight: 10, pass: hasCta, detail: hasCta ? 'Actionable CTA link present' : 'No CTA link found' },
  ];

  const score = Math.round(checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0));
  const blockingIssues = [];
  if (wordCount < 100) blockingIssues.push('Page copy is too short (< 100 words).');
  if (claimsViolations.length) blockingIssues.push(`Page contains prohibited factual claims: ${claimsViolations.join('; ')}.`);
  if (pageType === 'consultation' && missingFacts.includes('45-minute consultation')) {
    blockingIssues.push('Consultation page must state the approved 45-minute duration.');
  }
  if (pageType === 'consultation' && missingFacts.includes('$99 initial consultation ($200 value)')) {
    blockingIssues.push('Consultation page must state the approved $99 pricing.');
  }
  if (pageType === 'halored' && missingFacts.includes('HaloRed $39.99 session')) {
    blockingIssues.push('HaloRed recovery page must state the approved $39.99 session price.');
  }

  return {
    version: 1,
    pageType,
    score,
    status: score >= 85 ? 'excellent' : score >= 70 ? 'ready' : 'needs-review',
    publishable: blockingIssues.length === 0,
    wordCount,
    headingsCount: headings.length,
    questionHeadingsCount: questionHeadings.length,
    verifiedFacts,
    missingFacts,
    claimsViolations,
    blockingIssues,
    checks,
    topFixes: checks.filter(c => !c.pass).sort((a, b) => b.weight - a.weight).map(c => c.label),
  };
}

module.exports = {
  assessArticleQuality,
  assessPageQuality,
  textOnly,
  PROHIBITED_CLAIMS_PATTERNS,
  APPROVED_FACTS_PATTERNS,
};
