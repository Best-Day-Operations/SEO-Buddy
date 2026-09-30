import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessArticleQuality,
  assessPageQuality,
  textOnly,
  PROHIBITED_CLAIMS_PATTERNS,
  APPROVED_FACTS_PATTERNS,
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
  assert.ok(quality.claimsViolations.includes('incorrect consultation duration (90 min instead of 45 min)'));
});

test('assessPageQuality blocks halored pages with $999 price', () => {
  const badHaloHtml = `
    <div>
      <h1>HaloRed Recovery</h1>
      <p>HaloRed dry salt and red light therapy booth in St. Petersburg, FL by appointment only. $39.99 for single session.</p>
      <p>Our monthly public halored plan is $999 for recovery access.</p>
      <h2>How it works</h2>
      <ul><li>Red light</li><li>Dry salt</li></ul>
      <a href="/recovery">Book recovery</a>
    </div>
  `;

  const quality = assessPageQuality(badHaloHtml, { pageType: 'halored' });
  assert.equal(quality.publishable, false);
  assert.ok(quality.claimsViolations.includes('incorrect HaloRed price ($999 instead of $399)'));
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
