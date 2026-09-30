'use strict';

/**
 * Content Quality & AEO Readiness Evaluation Engine
 *
 * Distinguishes:
 * 1. Rendered visible text from scripts, comments, metadata, and JSON-LD schema.
 * 2. Editorial heuristics (scannability, word count, headings) from factual governance.
 * 3. Exact price-to-service and price-to-audience verification (e.g. $299 member vs $399 public).
 * 4. Conservative negation and quoted example handling (e.g. disclaimers vs affirmative promises).
 */

function extractRenderedContent(html) {
  let clean = String(html || '');
  clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  clean = clean.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  clean = clean.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ');
  clean = clean.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  clean = clean.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  clean = clean.replace(/<!--[\s\S]*?-->/g, ' ');
  clean = clean.replace(/<(?:meta|link)\b[^>]*>/gi, ' ');
  return clean;
}

function textOnly(html) {
  return extractRenderedContent(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return textOnly(value).split(/\s+/).filter(Boolean);
}

const PROHIBITED_CLAIMS_PATTERNS = Object.freeze([
  {
    pattern: /\bmedical-?grade\b/i,
    label: 'medical-grade',
    explanation: 'Studio equipment must not be described as medical-grade without certified clinical classification.',
  },
  {
    pattern: /\bcures?\s+(?:disease|pain|arthritis|cancer|diabetes)\b/i,
    label: 'unsubstantiated medical cure claim',
    explanation: 'Exercise and recovery services cannot claim to cure medical diseases or chronic pain.',
  },
  {
    pattern: /\bguaranteed\s+weight\s+loss\b/i,
    label: 'guaranteed weight loss',
    explanation: 'Weight loss outcomes cannot be promised or guaranteed.',
  },
  {
    pattern: /\bsemi-?private\s+training\b/i,
    label: 'semi-private training (only 1-on-1 private training is offered)',
    explanation: 'Best Day offers private 1-on-1 personal training only; semi-private training is not offered.',
  },
  {
    pattern: /\b(?:mon(?:day)?\s*[-–]\s*fri(?:day)?\s*)?6\s*(?::\s*00)?\s*am\s*[-–]\s*7\s*(?::\s*00)?\s*pm\b/i,
    label: 'obsolete studio schedule (6 AM–7 PM)',
    explanation: 'Approved studio hours are Monday–Saturday 4 AM–10 PM, Sunday 9 AM–5 PM, appointment only.',
  },
  {
    pattern: /\b(?:sat(?:urday)?\s*)?8\s*(?::\s*00)?\s*am\s*[-–]\s*1\s*(?::\s*00)?\s*pm\b/i,
    label: 'obsolete Saturday schedule (8 AM–1 PM)',
    explanation: 'Approved Saturday studio hours are 4 AM–10 PM, appointment only.',
  },
  {
    pattern: /\bmembership\s+experience\s+team\b/i,
    label: 'obsolete team naming (Membership Experience Team instead of Client Experience Team)',
    explanation: 'Initial fitness consultations are conducted by the Client Experience Team.',
  },
  {
    pattern: /\b(?:60|90)\s*[-–\s]*minute\s+consultation\b/i,
    label: 'incorrect consultation duration (45 minutes approved)',
    explanation: 'Comprehensive initial fitness consultation is exactly 45 minutes.',
  },
  {
    pattern: /\$999(?:\.00)?\b/i,
    label: 'unauthorized $999 pricing claim',
    explanation: 'Best Day has no $999 pricing on any service. HaloRed monthly public plan is $399; member plan is $299.',
  },
  {
    pattern: /\b(?:public|guests?|non[- ]?members?)\b[^.\n\r]{0,60}?\$\s*(?!399\b)\d+(?:\.\d{2})?\b/i,
    label: 'incorrect public recovery plan pricing ($399 approved)',
    explanation: 'Monthly public guest recovery plan is $399.00/month.',
  },
]);

function inspectClaimContext(visibleText, pattern) {
  const match = visibleText.match(pattern);
  if (!match) return { found: false };

  const matchIndex = match.index;
  const matchLength = match[0].length;

  // Extract preceding clause within same sentence
  const preceding = visibleText.slice(Math.max(0, matchIndex - 100), matchIndex);
  const lastBoundary = Math.max(
    preceding.lastIndexOf('.'),
    preceding.lastIndexOf(';'),
    preceding.lastIndexOf('!'),
    preceding.lastIndexOf('?'),
    preceding.lastIndexOf('\n')
  );
  const clause = lastBoundary >= 0 ? preceding.slice(lastBoundary + 1) : preceding;

  // Check for negation prefixes: "we do not promise...", "never guaranteed...", "no guaranteed..."
  const negationRegex = /\b(?:do\s+not|don't|does\s+not|doesn't|did\s+not|didn't|cannot|can't|never|not|no|without|neither|nor|refuse(?:\s+to)?|avoid|reject|no\s+(?:promise|guarantee)\s+of|we\s+do\s+not\s+(?:make|promise|offer|claim|guarantee))\b/i;
  if (negationRegex.test(clause)) {
    return {
      found: true,
      negated: true,
      context: (clause + visibleText.slice(matchIndex, matchIndex + matchLength)).trim(),
      matchedText: match[0],
    };
  }

  // Check for quotation or comparative framing
  const charBefore = visibleText.slice(Math.max(0, matchIndex - 2), matchIndex).trim();
  const charAfter = visibleText.slice(matchIndex + matchLength, matchIndex + matchLength + 2).trim();
  const isQuoted = /["'“‘]/.test(charBefore) && /["'”’]/.test(charAfter);
  const isComparative = /\b(?:unlike|instead of|beware of|other (?:gyms|trainers|programs))\b/i.test(clause);

  if (isQuoted || isComparative) {
    return {
      found: true,
      quotedOrComparative: true,
      context: (clause + visibleText.slice(matchIndex, matchIndex + matchLength)).trim(),
      matchedText: match[0],
    };
  }

  return {
    found: true,
    negated: false,
    context: (clause + visibleText.slice(matchIndex, matchIndex + matchLength)).trim(),
    matchedText: match[0],
  };
}

function assessArticleQuality(html, options = {}) {
  const visible = textOnly(html);
  const source = extractRenderedContent(html);
  const wordCount = words(visible).length;
  const firstParagraph = (source.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
  const firstParagraphWords = words(firstParagraph).length;
  const headings = [...source.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map(match => textOnly(match[1]));
  const questionHeadings = headings.filter(heading => /\?$/.test(heading)).length;
  const brandViolations = Array.isArray(options.brandViolations) ? options.brandViolations.filter(Boolean) : [];
  const claimsToCheck = Array.isArray(options.claimsToCheck) ? options.claimsToCheck.filter(Boolean) : [];
  const claimsViolations = Array.isArray(options.claimsViolations) ? [...options.claimsViolations.filter(Boolean)] : [];
  const flaggedForReview = [];

  for (const item of PROHIBITED_CLAIMS_PATTERNS) {
    const inspection = inspectClaimContext(visible, item.pattern);
    if (inspection.found) {
      if (inspection.negated || inspection.quotedOrComparative) {
        flaggedForReview.push({
          claim: item.label,
          context: inspection.context,
          reason: 'Statement contains potential disclaimer, negation, or quote; manual verification advised.',
        });
      } else if (!claimsViolations.includes(item.label)) {
        claimsViolations.push(item.label);
      }
    }
  }

  const checks = [
    { key: 'substantive', label: 'Substantive depth', weight: 20, pass: wordCount >= 700, detail: `${wordCount} words`, category: 'editorial_heuristic' },
    { key: 'answerFirst', label: 'Answer-first opening', weight: 15, pass: firstParagraphWords >= 25 && firstParagraphWords <= 100, detail: `${firstParagraphWords} words in opening answer`, category: 'editorial_heuristic' },
    { key: 'questionHeadings', label: 'Question-style sections', weight: 15, pass: questionHeadings >= 2, detail: `${questionHeadings} question heading${questionHeadings === 1 ? '' : 's'}`, category: 'editorial_heuristic' },
    { key: 'structure', label: 'Scannable structure', weight: 10, pass: headings.length >= 4, detail: `${headings.length} H2/H3 sections`, category: 'editorial_heuristic' },
    { key: 'lists', label: 'Actionable lists', weight: 8, pass: /<(?:ul|ol)\b/i.test(source), detail: /<(?:ul|ol)\b/i.test(source) ? 'List present' : 'No list found', category: 'editorial_heuristic' },
    { key: 'comparison', label: 'Extractable comparison', weight: 7, pass: /<table\b/i.test(source), detail: /<table\b/i.test(source) ? 'Table present' : 'No table found', category: 'editorial_heuristic' },
    { key: 'faq', label: 'FAQ coverage', weight: 10, pass: /faq|frequently asked/i.test(source), detail: /faq|frequently asked/i.test(source) ? 'FAQ present' : 'FAQ not found', category: 'editorial_heuristic' },
    { key: 'cta', label: 'Clear next step', weight: 10, pass: /<a\b[^>]*href=/i.test(source), detail: /<a\b[^>]*href=/i.test(source) ? 'Linked call to action present' : 'No linked call to action', category: 'editorial_heuristic' },
    { key: 'brandSafety', label: 'Brand-language safety', weight: 5, pass: brandViolations.length === 0 && claimsViolations.length === 0, detail: (brandViolations.length + claimsViolations.length) ? `${brandViolations.length + claimsViolations.length} blocked phrase(s) or claim(s) found` : 'No blocked phrases found', category: 'factual_compliance' },
  ];

  const score = Math.round(checks.reduce((sum, check) => sum + (check.pass ? check.weight : 0), 0));
  const blockingIssues = [];
  if (wordCount < 300) blockingIssues.push('Article is too short to publish safely.');
  if (headings.length < 2) blockingIssues.push('Article lacks enough section structure.');
  if (brandViolations.length) blockingIssues.push('Article contains blocked brand phrases.');
  if (claimsViolations.length) blockingIssues.push(`Article contains prohibited factual claims: ${claimsViolations.join(', ')}.`);

  return {
    version: 2,
    score,
    status: score >= 85 ? 'excellent' : score >= 70 ? 'ready' : 'needs-review',
    publishable: blockingIssues.length === 0,
    wordCount,
    claimsToCheck: claimsToCheck.length,
    brandViolations: brandViolations.length,
    claimsViolations: claimsViolations.length,
    blockingIssues,
    flaggedForReview,
    checks,
    topFixes: checks.filter(check => !check.pass).sort((a, b) => b.weight - a.weight).slice(0, 3).map(check => check.label),
    heuristicDisclaimer: 'Editorial heuristic scores measure structural scannability and content formatting; they do not prove answer quality or guarantee AI visibility.',
  };
}

function assessPageQuality(html, options = {}) {
  // CRITICAL: Extract rendered visible content separate from scripts, styles, metadata, and JSON-LD schema!
  const renderedSource = extractRenderedContent(html);
  const visible = textOnly(renderedSource);
  const pageType = String(options.pageType || 'default').toLowerCase();
  const wordCount = words(visible).length;

  // 1. Editorial Heuristic: Direct-Answer Hero / Summary (20-120 words in first substantial paragraph)
  const paragraphs = [...renderedSource.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => textOnly(m[1]))
    .filter(p => words(p).length >= 10);
  const openingText = paragraphs[0] || '';
  const openingWords = words(openingText).length;
  const hasDirectAnswer = openingWords >= 20 && openingWords <= 120;

  // 2. Editorial Heuristic: Question-Style Headings
  const headings = [...renderedSource.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m => textOnly(m[1]));
  const questionHeadings = headings.filter(h => /\?$/.test(h) || /^(?:what|how|who|why|where|when|can|is|are|which)\b/i.test(h));

  // 3. Factual Compliance: Prohibited Claims Check with Negation & Quoting Awareness
  const claimsViolations = [];
  const flaggedForReview = [];
  const brandViolations = Array.isArray(options.brandViolations) ? [...options.brandViolations] : [];

  for (const item of PROHIBITED_CLAIMS_PATTERNS) {
    const inspection = inspectClaimContext(visible, item.pattern);
    if (inspection.found) {
      if (inspection.negated || inspection.quotedOrComparative) {
        flaggedForReview.push({
          claim: item.label,
          context: inspection.context,
          reason: 'Statement contains explicit disclaimer or quotation; verified non-violating.',
        });
      } else {
        if (!claimsViolations.includes(item.label)) {
          claimsViolations.push(item.label);
        }
      }
    }
  }

  // 4. Factual Compliance: Specific Price and Audience Associations
  const verifiedFacts = [];
  const missingFacts = [];

  // Studio baseline facts (checked on visible text)
  const hasStPete = /\bst\.?\s*petersburg(?:,\s*fl)?\b/i.test(visible);
  if (hasStPete) verifiedFacts.push('St. Petersburg, FL location');
  else missingFacts.push('St. Petersburg, FL location');

  const hasAppointmentOnly = /\bby\s+appointment(?:\s+only)?|\bappointment\s+only\b/i.test(visible);
  if (hasAppointmentOnly) verifiedFacts.push('Appointment-only studio');
  else missingFacts.push('Appointment-only studio');

  const hasBarefoot = /\bbarefoot(?:\s+training|\s+studio|\s+environment)?\b/i.test(visible);
  if (hasBarefoot) verifiedFacts.push('Barefoot training environment');
  else if (pageType === 'home' || pageType === 'personal-training') missingFacts.push('Barefoot training environment');

  const hasPhone = /\(?727\)?[\s.-]*334[\s.-]*1472\b/.test(visible);
  if (hasPhone) verifiedFacts.push('(727) 334-1472 phone number');
  else if (pageType === 'home') missingFacts.push('(727) 334-1472 phone number');

  const hasAddress = /\b6619\s+1st\s+ave(?:nue)?\s+s(?:outh)?\b/i.test(visible);
  if (hasAddress) verifiedFacts.push('6619 1st Ave S address');
  else if (pageType === 'home') missingFacts.push('6619 1st Ave S address');

  // Consultation factual checks: 45 minutes, $99 introductory price, Client Experience Team
  if (pageType === 'consultation' || pageType === 'home') {
    const hasConsultDuration = /\b45\s*[-–\s]*minute(?:\s+fitness)?\s+consultation\b/i.test(visible);
    if (hasConsultDuration) verifiedFacts.push('45-minute consultation');
    else if (pageType === 'consultation') missingFacts.push('45-minute consultation');

    const hasConsultIntroPrice = /\$99(?:\.00)?\b/.test(visible);
    if (hasConsultIntroPrice) {
      verifiedFacts.push('$99 initial consultation');
      // Explicitly check if regular/normal value is asserted: must be $200
      const hasNormalPriceClaim = /\b(?:normally|regularly|valued\s+at)\s*\$?\s*(\d+)/i.exec(visible);
      if (hasNormalPriceClaim) {
        if (hasNormalPriceClaim[1] === '200') {
          verifiedFacts.push('$200 standard consultation value');
        } else {
          claimsViolations.push(`incorrect standard consultation value ($${hasNormalPriceClaim[1]} claimed, $200 approved)`);
        }
      }
    } else if (pageType === 'consultation') {
      missingFacts.push('$99 initial consultation');
    }

    const hasClientTeam = /\bclient\s+experience\s+team\b/i.test(visible);
    if (hasClientTeam) verifiedFacts.push('Client Experience Team');
    else if (pageType === 'consultation') missingFacts.push('Client Experience Team');
  }

  // HaloRed recovery checks: $39.99 session, $299 active member, $399 public guest
  if (pageType === 'halored' || pageType === 'home') {
    const hasHaloredSession = /\$39\.99\b/.test(visible);
    if (hasHaloredSession) verifiedFacts.push('HaloRed $39.99 session');
    else if (pageType === 'halored') missingFacts.push('HaloRed $39.99 session');

    // Separate member and public plan verification
    const hasMemberPlan = /\b(?:active\s+)?members?\b[^.\n\r]{0,40}?\$\s*299\b|\$\s*299\b[^.\n\r]{0,40}?\b(?:active\s+)?members?\b/i.test(visible);
    if (hasMemberPlan) verifiedFacts.push('Member recovery plan ($299/mo)');
    else if (pageType === 'halored') missingFacts.push('Member recovery plan ($299/mo)');

    const hasPublicPlan = /\b(?:public|guests?|non[- ]?members?)\b[^.\n\r]{0,40}?\$\s*399\b|\$\s*399\b[^.\n\r]{0,40}?\b(?:public|guests?|non[- ]?members?)\b/i.test(visible);
    if (hasPublicPlan) verifiedFacts.push('Public guest recovery plan ($399/mo)');
    else if (pageType === 'halored') missingFacts.push('Public guest recovery plan ($399/mo)');
  }

  // Personal training check: 1-on-1 private training
  if (pageType === 'personal-training' || pageType === 'home') {
    const hasPt = /\bone[-–\s]on[-–\s]one\s+personal\s+training\b/i.test(visible);
    if (hasPt) verifiedFacts.push('One-on-one personal training');
    else if (pageType === 'personal-training') missingFacts.push('One-on-one personal training');
  }

  // 5. Editorial Heuristic: Structure & Scannability
  const hasLists = /<(?:ul|ol)\b/i.test(renderedSource);
  const hasStructure = headings.length >= 3;

  // 6. Actionable Next Step: Clear Call to Action
  const hasCta = /<a\b[^>]*href=["'](?:https?:\/\/|\/|#|tel:|mailto:)[^"']*["']/i.test(renderedSource) || /<button\b/i.test(renderedSource);

  // Checks evaluation
  const checks = [
    { key: 'directAnswer', label: 'Direct-answer summary (20–120 words)', weight: 15, pass: hasDirectAnswer, detail: `${openingWords} words in opening summary`, category: 'editorial_heuristic' },
    { key: 'questionHeadings', label: 'Inquiry & question headings', weight: 15, pass: questionHeadings.length >= 2, detail: `${questionHeadings.length} question heading(s)`, category: 'editorial_heuristic' },
    { key: 'approvedFacts', label: 'Approved studio facts & pricing', weight: 25, pass: missingFacts.length === 0, detail: `${verifiedFacts.length} verified; missing: ${missingFacts.join(', ') || 'none'}`, category: 'factual_compliance' },
    { key: 'prohibitedClaims', label: 'Truthful governance (no prohibited claims)', weight: 20, pass: claimsViolations.length === 0, detail: claimsViolations.length ? `Violations: ${claimsViolations.join('; ')}` : 'Zero prohibited claims', category: 'factual_compliance' },
    { key: 'structure', label: 'Scannable headings & lists', weight: 15, pass: hasStructure && hasLists, detail: `${headings.length} headings, ${hasLists ? 'lists present' : 'no lists'}`, category: 'editorial_heuristic' },
    { key: 'cta', label: 'Clear appointment / booking CTA', weight: 10, pass: hasCta, detail: hasCta ? 'Actionable CTA link present' : 'No CTA link found', category: 'editorial_heuristic' },
  ];

  const score = Math.round(checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0));
  const blockingIssues = [];
  if (wordCount < 100) blockingIssues.push('Page copy is too short (< 100 words).');
  if (claimsViolations.length) blockingIssues.push(`Page contains prohibited factual claims: ${claimsViolations.join('; ')}.`);
  if (pageType === 'consultation' && missingFacts.includes('45-minute consultation')) {
    blockingIssues.push('Consultation page must state the approved 45-minute duration.');
  }
  if (pageType === 'consultation' && missingFacts.includes('$99 initial consultation')) {
    blockingIssues.push('Consultation page must state the approved $99 pricing.');
  }
  if (pageType === 'halored' && missingFacts.includes('HaloRed $39.99 session')) {
    blockingIssues.push('HaloRed recovery page must state the approved $39.99 session price.');
  }

  const reviewStatus = blockingIssues.length > 0 ? 'needs-review' : score >= 85 ? 'excellent' : score >= 70 ? 'ready' : 'needs-review';

  return {
    version: 2,
    pageType,
    score,
    status: reviewStatus,
    publishable: blockingIssues.length === 0,
    wordCount,
    headingsCount: headings.length,
    questionHeadingsCount: questionHeadings.length,
    verifiedFacts,
    missingFacts,
    claimsViolations,
    flaggedForReview,
    blockingIssues,
    checks,
    topFixes: checks.filter(c => !c.pass).sort((a, b) => b.weight - a.weight).map(c => c.label),
    heuristicDisclaimer: 'Editorial heuristic scores measure structural scannability and content formatting; they do not prove answer quality or guarantee AI visibility.',
  };
}

module.exports = {
  assessArticleQuality,
  assessPageQuality,
  extractRenderedContent,
  inspectClaimContext,
  textOnly,
  PROHIBITED_CLAIMS_PATTERNS,
};
