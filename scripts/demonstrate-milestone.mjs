import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWebsiteAuditService } from '../lib/website-audit-service.js';
import { buildGhlTrackingSnippet, validateSchema, VERIFIED_PAGE_CONFIGS } from '../lib/ghl-schema-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs the complete website audit to schema demonstration with strict assertions.
 * Rejects if website audit fails, required results are missing, schema fails, or persistence fails.
 */
export async function runDemonstration(options = {}) {
  const fetchImpl = options.fetchFn || globalThis.fetch;
  console.log('================================================================');
  console.log('BEST DAY FITNESS: COMPLETE AUDIT-TO-SCHEMA WORKFLOW DEMO');
  console.log('================================================================\n');

  // === GATE 1: Persistent Service Initialization ===
  console.log('=== GATE 1: Initialize Persistent Database & Service ===');
  let persistedDb = {
    websiteAudit: {
      latest: null,
      updatedAt: null,
      history: [],
      evidence: {},
    },
  };

  const state1 = { ...persistedDb.websiteAudit };
  const save1 = () => { persistedDb.websiteAudit = JSON.parse(JSON.stringify(state1)); };

  const providerFetch = async (provider, url, opts) => {
    return fetchImpl(url, opts);
  };

  const auditService = createWebsiteAuditService({
    state: state1,
    save: save1,
    providerRuntime: { fetch: providerFetch },
    allowLocalTargets: false,
  });

  assert.ok(auditService, 'Audit service must initialize successfully');
  console.log('Gate 1 Passed: Service initialized with persistent storage.\n');

  // === GATE 2: Import Real Tool Run Failure Evidence ===
  console.log('=== GATE 2: Import Verified GEO Tool Failure Evidence (CLI 10MB Limit) ===');
  const previewArtifactPath = path.resolve(__dirname, '../test/fixtures/geo-audits/baseline-staging-preview.json');
  assert.ok(fs.existsSync(previewArtifactPath), `Artifact must exist at ${previewArtifactPath}`);

  const previewArtifact = JSON.parse(fs.readFileSync(previewArtifactPath, 'utf8'));
  assert.ok(previewArtifact.url, 'Artifact must declare url');
  assert.ok(previewArtifact.error, 'Artifact must declare failure error');
  console.log(`Loading real artifact from: ${previewArtifactPath}`);
  console.log(`Artifact URL: ${previewArtifact.url}`);
  console.log(`Artifact Error: ${previewArtifact.error}`);

  const importResult = auditService.importGeoEvidence(previewArtifact.url, previewArtifact);
  assert.equal(importResult.ok, true, 'Evidence import must succeed');
  assert.equal(importResult.evidenceStored, true, 'Evidence must be stored in persistent state');
  assert.ok(state1.evidence[importResult.targetUrl], 'Target URL must exist in state.evidence');
  console.log('Gate 2 Passed: Real GEO tool failure evidence imported and stored.\n');

  // === GATE 3: Run Audit on Hosted Preview URL ===
  console.log('=== GATE 3: Run Audit on Hosted Staging Preview URL ===');
  const targetUrlMatching = 'https://link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU?t=1790706307044#home';
  console.log(`Auditing target URL: ${targetUrlMatching}`);

  const auditRunResult = await auditService.run(targetUrlMatching);

  // CRITICAL ASSERTION: The website audit itself must NOT fail!
  assert.equal(auditRunResult.ok, true, `Website audit must succeed, but failed: ${auditRunResult.error}`);
  assert.ok(auditRunResult.snapshot, 'Audit run must produce snapshot');

  const auditResult = auditRunResult.snapshot;

  // Verify Actual Returned Fields (No Nonexistent Fields!)
  assert.equal(auditResult.targetUrl, targetUrlMatching, 'Audit target must match requested target');
  assert.ok(auditResult.checks, 'Audit checks object must be present');
  assert.equal(auditResult.checks.url, targetUrlMatching, 'Checks url must match target');
  assert.equal(auditResult.checks.httpStatus, 200, 'HTTP response status must be 200');
  assert.equal(auditResult.checks.crawlability.status, 'PROTECTED_STAGING', 'Crawlability status must be PROTECTED_STAGING');
  assert.equal(auditResult.checks.crawlability.isStagingProtected, true, 'isStagingProtected must be true');
  assert.ok(auditResult.checks.crawlability.observedRobots.includes('noindex'), 'Observed robots must contain noindex');
  assert.ok(auditResult.checks.performance.byteSize > 0, 'Performance byteSize must be greater than 0');
  assert.ok(typeof auditResult.checks.performance.sizeMegabytes === 'string', 'sizeMegabytes must be formatted string');

  // DISTINGUISH EXPECTED GEO CLI FAILURE FROM WEBSITE AUDIT
  // The website audit succeeded (HTTP 200, fetched HTML parsed).
  // The imported GEO CLI measurement reports status="unavailable" and score=null
  // due to the payload exceeding GEO Optimizer's 10MB parser limit.
  assert.equal(auditResult.checks.geoOptimizer.status, 'unavailable', 'GEO Optimizer status must be unavailable');
  assert.equal(auditResult.checks.geoOptimizer.score, null, 'GEO Optimizer score must be null (no invented score)');
  assert.equal(auditResult.score, null, 'Overall score must be null when GEO Optimizer is unavailable');
  assert.ok(auditResult.checks.geoOptimizer.error.includes('Response too large'), 'GEO Optimizer error must report response size limit');

  // Recommendations verification
  assert.ok(Array.isArray(auditResult.recommendations), 'Recommendations must be an array');
  assert.ok(auditResult.recommendations.length > 0, 'Recommendations must not be empty');
  for (const rec of auditResult.recommendations) {
    assert.ok(rec.priority, 'Recommendation must have priority');
    assert.ok(rec.area, 'Recommendation must have area');
    assert.ok(rec.action, 'Recommendation must have action');
    assert.ok(rec.reason, 'Recommendation must have reason');
  }

  console.log('Audit Summary:');
  console.log('  Target:', auditResult.targetUrl);
  console.log('  HTTP Response Code:', auditResult.checks.httpStatus);
  console.log('  Crawlability Status:', auditResult.checks.crawlability.status);
  console.log('  Staging Protection Active:', auditResult.checks.crawlability.isStagingProtected);
  console.log('  Page Size:', `${auditResult.checks.performance.sizeMegabytes} MB (${auditResult.checks.performance.byteSize} bytes)`);
  console.log('  GEO Optimizer Status:', auditResult.checks.geoOptimizer.status);
  console.log('  GEO Optimizer Score:', auditResult.checks.geoOptimizer.score);
  console.log('  GEO Optimizer Reason:', auditResult.checks.geoOptimizer.error);
  console.log('  Schema Blocks Found in Page Head:', auditResult.checks.structuredData.blockCount);
  console.log('  Actionable Recommendations Count:', auditResult.recommendations.length);
  console.log('Gate 3 Passed: Hosted preview audit completed with truthful unavailable status and zero invented scores.\n');

  // === GATE 4: Persistence Across Service Restart ===
  console.log('=== GATE 4: Verify Evidence & History Persistence Across Service Restart ===');
  const state2 = { ...persistedDb.websiteAudit };
  const save2 = () => { persistedDb.websiteAudit = JSON.parse(JSON.stringify(state2)); };

  const restartedAuditService = createWebsiteAuditService({
    state: state2,
    save: save2,
    providerRuntime: { fetch: providerFetch },
    allowLocalTargets: false,
  });

  const latestAudit = restartedAuditService.getLatest();
  assert.ok(latestAudit, 'Restarted service must retain latest audit');
  assert.equal(latestAudit.targetUrl, targetUrlMatching, 'Target must survive restart');
  assert.equal(latestAudit.checks.geoOptimizer.status, 'unavailable', 'GEO status must survive restart');
  assert.equal(latestAudit.checks.geoOptimizer.score, null, 'GEO score null must survive restart');

  const evidenceKeys = Object.keys(persistedDb.websiteAudit.evidence || {});
  assert.ok(evidenceKeys.length >= 1, 'Persisted evidence keys must not be empty');
  assert.ok(persistedDb.websiteAudit.history.length >= 1, 'Persisted history must retain at least 1 record');
  console.log('  Surviving Evidence Keys:', evidenceKeys);
  console.log('  Surviving History Count:', persistedDb.websiteAudit.history.length);
  console.log('Gate 4 Passed: Evidence and history successfully survived service recreation.\n');

  // === GATE 5: Generate & Validate Page-Specific GHL Schema ===
  console.log('=== GATE 5: Generate & Validate 4-Tier Page-Specific GHL Schema ===');
  const pages = ['home', 'consultation', 'halored', 'personal-training'];
  for (const pageKey of pages) {
    const snippet = buildGhlTrackingSnippet(pageKey);
    assert.ok(snippet && snippet.length > 1000, `Snippet for ${pageKey} must have content`);

    const jsonLdMatches = [...snippet.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(jsonLdMatches.length >= 1, `Snippet for ${pageKey} must contain JSON-LD block`);

    for (let i = 0; i < jsonLdMatches.length; i++) {
      const parsed = JSON.parse(jsonLdMatches[i][1]);
      const validation = validateSchema(parsed);

      assert.equal(validation.valid, true, `Schema for page "${pageKey}" block #${i + 1} must be valid`);
      assert.equal(validation.categories.jsonSyntax.pass, true, `JSON Syntax must pass for ${pageKey}`);
      assert.equal(validation.categories.approvedFacts.pass, true, `Approved Facts must pass for ${pageKey}`);
      assert.equal(validation.categories.schemaOrgVocabulary.pass, true, `Schema.org Vocabulary must pass for ${pageKey}`);
      assert.equal(validation.categories.googleFeatureEligibility.eligible, true, `Google Eligibility must pass for ${pageKey}`);
      assert.equal(validation.allIssues.length, 0, `No validation issues allowed for ${pageKey}: ${validation.allIssues.join(', ')}`);

      const entityCount = parsed['@graph'] ? parsed['@graph'].length : 1;
      console.log(`  Page "${pageKey}": Snippet ${snippet.length} chars | Graph with ${entityCount} entities | 4-Tier Valid: true`);
    }
  }
  console.log('Gate 5 Passed: All 4 page schemas generated and passed 4-tier validation.\n');

  console.log('================================================================');
  console.log('DEMONSTRATION COMPLETE: ALL ACCEPTANCE GATES SATISFIED');
  console.log('================================================================');
  return true;
}

// Run directly when called from command line
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDemonstration()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('\nDEMONSTRATION FAILED ACCEPTANCE GATE:');
      console.error(err.stack || err.message);
      process.exit(1);
    });
}
