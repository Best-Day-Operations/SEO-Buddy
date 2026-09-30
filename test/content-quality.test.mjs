import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessArticleQuality,
  assessPageQuality,
  extractRenderedContent,
  inspectClaimContext,
  textOnly,
  PROHIBITED_CLAIMS_PATTERNS,
} from '../lib/content-quality.js';
import { APPROVED_SERVICE_PROMPTS } from '../lib/ai-visibility-service.js';
import { evaluateWebsiteAudit } from '../lib/website-audit-service.js';

test('assessArticleQuality detects depth, structure, and blocks prohibited claims', () => {
  const goodBody = `<div><h1>Guide</h1><p>${'direct answer '.repeat(30)}</p><h2>What matters?</h2><p>${'useful detail '.repeat(360)}</p><h2>How does it work?</h2><h2>Practical steps</h2><h2>Frequently Asked Questions</h2><ul><li>One</li></ul><table><tr><td>A</td></tr></table><a href="https://example.com">Book now</a></div>`;
  const quality = assessArticleQuality(goodBody);
  assert.equal(quality.score, 100);
  assert.equal(quality.publishable, true);

  const claimsUnsafe = assessArticleQuality(`<div><h1>Guide</h1><p>${'direct answer '.repeat(30)}</p><h2>What matters?</h2><p>${'useful detail '.repeat(360)} We offer medical-grade red light therapy and guaranteed weight loss.</p><h2>How does it work?</h2></div>`);
  assert.equal(claimsUnsafe.publishable, false);
  assert.ok(claimsUnsafe.blockingIssues.some(i => /prohibited factual claims/i.test(i)));
});

test('assessPageQuality validates approved consultation page structure, facts, and CTA', () => {
  const consultationHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Fitness Consultation | Best Day Fitness St. Petersburg FL</title></head>
      <body>
        <h1>Comprehensive Fitness Consultation</h1>
        <p>Best Day Fitness & Wellness in St. Petersburg, FL provides a 45-minute comprehensive initial fitness consultation conducted by our Client Experience Team for $99 ($200 normal value). We assess your mobility, balance, posture, and 3D body composition in a private barefoot studio setting by appointment only.</p>
        <h2>What is included in the consultation?</h2>
        <ul>
          <li>45-minute consultation with the Client Experience Team</li>
          <li>Movement, balance, and joint mobility evaluation</li>
          <li>Complete 3D body scan and posture review</li>
        </ul>
        <h2>Who is this assessment for?</h2>
        <p>This assessment is designed for adults over 50 seeking safe, trainer-led private fitness progression.</p>
        <h2>Frequently Asked Questions</h2>
        <p>Do I need special shoes? No, we are a barefoot studio environment.</p>
        <div>
          <a href="https://bestdayfitness.com/consultation#schedule">Schedule Your 45-Minute Consultation</a>
        </div>
      </body>
    </html>
  `;

  const quality = assessPageQuality(consultationHtml, { pageType: 'consultation' });
  assert.equal(quality.publishable, true);
  assert.equal(quality.status, 'excellent');
  assert.ok(quality.score >= 85, `Expected score >= 85, got ${quality.score}`);
  assert.equal(quality.blockingIssues.length, 0);
  assert.ok(quality.verifiedFacts.length >= 4);
});

test('page with business facts only inside application/json or application/ld+json script must NOT mark facts as verified in visible content', () => {
  const jsonOnlyHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "HealthClub",
          "address": "6619 1st Ave S",
          "telephone": "+1-727-334-1472",
          "openingHours": "Mo-Sa 04:00-22:00, Su 09:00-17:00",
          "description": "By appointment only barefoot studio in St. Petersburg, FL"
        }
        </script>
      </head>
      <body>
        <h1>Welcome to our studio</h1>
        <p>We are a private wellness space. Learn more about what we do below.</p>
        <h2>Our story</h2>
        <p>Dedicated to helping clients move and recover better every single day in Florida.</p>
      </body>
    </html>
  `;
  const result = assessPageQuality(jsonOnlyHtml, { pageType: 'home' });
  // None of the facts hidden inside the json script should be marked as verified in visible page copy!
  assert.equal(result.verifiedFacts.includes('6619 1st Ave S address'), false);
  assert.equal(result.verifiedFacts.includes('(727) 334-1472 phone number'), false);
  assert.equal(result.verifiedFacts.includes('Appointment-only studio'), false);
  assert.equal(result.verifiedFacts.includes('Barefoot training environment'), false);
  assert.ok(result.missingFacts.length > 0);
});

test('page stating "By appointment only in St. Petersburg. HaloRed sessions $39.99. Member plan $299. Public plan $999." must NOT verify public pricing and MUST flag $999 as prohibited claim', () => {
  const badHaloHtml = `
    <div>
      <h1>HaloRed Recovery Lounge</h1>
      <p>By appointment only in St. Petersburg. HaloRed sessions $39.99. Member plan $299. Public plan $999.</p>
      <h2>How does HaloRed work?</h2>
      <p>Combines full-body photobiomodulation with dry salt halotherapy for cellular recovery.</p>
      <ul><li>Red light</li><li>Salt aerosol</li></ul>
      <a href="/book">Book session</a>
    </div>
  `;
  const result = assessPageQuality(badHaloHtml, { pageType: 'halored' });
  assert.equal(result.publishable, false);
  assert.ok(result.claimsViolations.some(v => v.includes('$999')), `Expected $999 violation, got: ${result.claimsViolations.join(', ')}`);
  assert.equal(result.verifiedFacts.includes('Public guest recovery plan ($399/mo)'), false);
  assert.ok(result.blockingIssues.some(i => i.includes('$999') || i.includes('prohibited factual claims')));
});

test('page stating "We do not promise guaranteed weight loss" must NOT be flagged as a prohibited guarantee', () => {
  const disclaimerHtml = `
    <div>
      <h1>Sustainable Strength for Older Adults</h1>
      <p>Best Day Fitness & Wellness in St. Petersburg, FL is a private barefoot studio open by appointment only. We focus on mobility, balance, and joint longevity. We do not promise guaranteed weight loss or extreme crash diets. Our approach centers on sustainable functional movement, joint preservation, and long-term vitality for older adults who want to maintain their independence and stay active for life.</p>
      <h2>What can you expect from our program?</h2>
      <p>Individualized strength, stability, and personalized progression designed for adults 50+. Every session is customized to your biomechanics and movement history so that you train safely without joint irritation.</p>
      <h2>How do we work together?</h2>
      <p>We work one-on-one in a calm, private environment where your goals, safety, and comfort always come first.</p>
      <ul><li>Mobility</li><li>Stability</li><li>Balance</li></ul>
      <a href="/consultation">Schedule assessment</a>
    </div>
  `;
  const result = assessPageQuality(disclaimerHtml, { pageType: 'home' });
  // Must NOT declare a prohibited claims violation for guaranteed weight loss when explicitly negated!
  assert.equal(result.claimsViolations.some(v => v.includes('guaranteed weight loss')), false);
  assert.equal(result.publishable, true);
  // May note it in flaggedForReview with reason
  assert.ok(result.flaggedForReview.some(f => f.claim === 'guaranteed weight loss'));
});

test('associating prices with service and audience: $99 introductory consultation does not verify $200 normal value without explicit mention', () => {
  const consultationOnly99 = `
    <div>
      <h1>Fitness Consultation</h1>
      <p>Best Day Fitness in St. Petersburg, FL offers an introductory 45-minute fitness consultation for $99 conducted by the Client Experience Team by appointment only.</p>
      <h2>What is covered?</h2>
      <p>Comprehensive assessment of mobility and movement.</p>
      <ul><li>3D body scan</li></ul>
      <a href="/book">Book now</a>
    </div>
  `;
  const result = assessPageQuality(consultationOnly99, { pageType: 'consultation' });
  assert.ok(result.verifiedFacts.includes('$99 initial consultation'));
  // $200 normal value is NOT verified because it was not explicitly claimed
  assert.equal(result.verifiedFacts.includes('$200 standard consultation value'), false);

  // But if an incorrect regular price is claimed, e.g. "normally $500", it must be flagged
  const badValueHtml = `
    <div>
      <h1>Fitness Consultation</h1>
      <p>Best Day Fitness in St. Petersburg, FL offers a 45-minute fitness consultation for $99 (normally $500) conducted by the Client Experience Team by appointment only.</p>
      <h2>What is covered?</h2>
      <p>Assessment.</p>
      <ul><li>Scan</li></ul>
      <a href="/book">Book</a>
    </div>
  `;
  const badResult = assessPageQuality(badValueHtml, { pageType: 'consultation' });
  assert.ok(badResult.claimsViolations.some(v => v.includes('$500') && v.includes('$200 approved')));
});

test('editorial heuristics are explicitly labeled as heuristics and distinguished from factual compliance', () => {
  const sampleHtml = `
    <div>
      <h1>Title</h1>
      <p>${'word '.repeat(35)}</p>
      <h2>Question one?</h2>
      <h2>Question two?</h2>
      <a href="#">Link</a>
    </div>
  `;
  const result = assessPageQuality(sampleHtml);
  const heuristicChecks = result.checks.filter(c => c.category === 'editorial_heuristic');
  const factualChecks = result.checks.filter(c => c.category === 'factual_compliance');

  assert.ok(heuristicChecks.length >= 3, 'Must have editorial heuristic checks');
  assert.ok(factualChecks.length >= 2, 'Must have factual compliance checks');
  assert.ok(result.heuristicDisclaimer.includes('Editorial heuristic scores measure structural scannability'));
});

test('assessPageQuality blocks pages containing prohibited claims or obsolete schedules', () => {
  // Obsolete schedule and prohibited medical claim
  const badHtml = `
    <div>
      <h1>Fitness Consultation</h1>
      <p>We are open Monday-Friday 6:00 AM - 7:00 PM for all training programs. Our studio offers medical-grade red light therapy and semi-private training sessions.</p>
      <h2>What we do</h2>
      <p>Consultations are handled by the Membership Experience Team and take a 90-minute consultation slot.</p>
      <a href="/book">Book</a>
    </div>
  `;

  const quality = assessPageQuality(badHtml, { pageType: 'consultation' });
  assert.equal(quality.publishable, false);
  assert.ok(quality.blockingIssues.length > 0);
  assert.ok(quality.claimsViolations.includes('medical-grade'));
  assert.ok(quality.claimsViolations.includes('semi-private training (only 1-on-1 private training is offered)'));
  assert.ok(quality.claimsViolations.includes('obsolete studio schedule (6 AM–7 PM)'));
  assert.ok(quality.claimsViolations.includes('obsolete team naming (Membership Experience Team instead of Client Experience Team)'));
  assert.ok(quality.claimsViolations.includes('incorrect consultation duration (45 minutes approved)'));
});

test('APPROVED_SERVICE_PROMPTS exposes non-empty query arrays for all approved studio services', () => {
  assert.ok(APPROVED_SERVICE_PROMPTS);
  const services = ['personalTraining', 'consultation', 'haloredRecovery', 'wellnessCoaching', 'physicalTherapy'];

  for (const service of services) {
    assert.ok(Array.isArray(APPROVED_SERVICE_PROMPTS[service]), `Must have array for ${service}`);
    assert.ok(APPROVED_SERVICE_PROMPTS[service].length >= 2, `Must have at least 2 queries for ${service}`);
    for (const query of APPROVED_SERVICE_PROMPTS[service]) {
      assert.equal(typeof query, 'string');
      assert.ok(query.length > 10, `Query too short: ${query}`);
      assert.ok(query.toLowerCase().includes('st. petersburg') || query.toLowerCase().includes('st pete'),
        `Query must target local market: ${query}`);
    }
  }
});

test('evaluateWebsiteAudit integrates contentQuality check and surfaces content recommendations', () => {
  const dummyMeta = {
    bytes: 1500,
    httpStatus: 200,
    title: 'Consultation | Best Day Fitness',
    description: '45-minute comprehensive initial fitness consultation in St. Petersburg, FL.',
    canonical: 'https://bestdayfitness.com/consultation',
    rawHtml: `
      <html>
        <head><title>Consultation</title></head>
        <body>
          <h1>Consultation</h1>
          <p>We are open Monday-Friday 6:00 AM - 7:00 PM offering medical-grade recovery.</p>
          <a href="/book">Book</a>
        </body>
      </html>
    `,
    headings: { h1Texts: ['Consultation'] },
    assets: {},
    schemaBlocks: [],
    malformedJsonLd: [],
  };

  const audit = evaluateWebsiteAudit('https://bestdayfitness.com/consultation', dummyMeta);
  assert.ok(audit.checks.contentQuality, 'Must contain checks.contentQuality');
  assert.equal(audit.checks.contentQuality.publishable, false);
  assert.ok(audit.recommendations.some(r => r.area === 'Content Quality & Governance'));
  assert.ok(audit.recommendations.some(r => r.action.includes('medical-grade') || r.action.includes('Resolve content blocker')));
});

test('distinguishes single-session and monthly pricing: approved statement verifies all three offers independently without violations', () => {
  const statementHtml = `
    <div>
      <h1>HaloRed Recovery Lounge</h1>
      <p>By appointment only in St. Petersburg, FL. Public HaloRed single sessions cost $39.99 for 15 minutes. Active member monthly plan $299. Public monthly plan $399.</p>
      <h2>What is HaloRed recovery?</h2>
      <p>A private recovery booth combining full-body red light and dry salt aerosol halotherapy. Our dedicated recovery environment helps seniors and active adults relax, recover cellular energy, and improve respiratory wellness in a comfortable barefoot environment.</p>
      <h2>How do appointments work?</h2>
      <p>All sessions must be scheduled in advance with our Client Experience Team. Base sessions run fifteen minutes, and members can add time as needed during their scheduled visit.</p>
      <ul><li>15-minute sessions</li><li>Active member savings</li></ul>
      <a href="/book">Book Your Recovery Session</a>
    </div>
  `;
  const result = assessPageQuality(statementHtml, { pageType: 'halored' });

  // Zero prohibited claims violations
  assert.deepEqual(result.claimsViolations, []);
  assert.equal(result.publishable, true);

  // All three offers verified independently
  assert.ok(result.verifiedFacts.some(f => f.includes('$39.99')), 'Must verify $39.99 single session');
  assert.ok(result.verifiedFacts.includes('Member recovery plan ($299/mo)'), 'Must verify $299 member monthly plan');
  assert.ok(result.verifiedFacts.includes('Public guest recovery plan ($399/mo)'), 'Must verify $399 public monthly plan');
});

test('ambiguous recovery pricing reports needs review instead of an incorrect factual violation', () => {
  const ambiguousHtml = `
    <div>
      <h1>HaloRed Recovery Lounge</h1>
      <p>By appointment only in St. Petersburg, FL. Public HaloRed sessions cost $50 per visit.</p>
      <h2>What is HaloRed recovery?</h2>
      <p>A private recovery booth combining full-body red light and dry salt aerosol halotherapy.</p>
      <ul><li>Drop-in sessions</li></ul>
      <a href="/book">Book Now</a>
    </div>
  `;
  const result = assessPageQuality(ambiguousHtml, { pageType: 'halored' });

  // Not a hard claims violation (does not assert an incorrect monthly plan)
  assert.equal(result.claimsViolations.some(v => v.includes('incorrect public recovery plan pricing')), false);
  // Reported in flaggedForReview for editorial review
  assert.ok(result.flaggedForReview.some(f => f.reason === 'ambiguous_pricing_context'),
    'Expected flaggedForReview with ambiguous_pricing_context');
});

