'use strict';

/**
 * End-to-End Browser Acceptance Test for SEO Buddy Website Audit & GHL Schema Engine
 *
 * Verifies:
 * 1. UI Navigation & Tab Switching to Site Optimization (onsite-tab)
 * 2. Approved-Fact GHL Schema Generation & 4-Tier Validation Badges
 * 3. Clipboard copy interaction for GHL header tracking code
 * 4. Live Audit of Hosted GHL Preview with Protected Staging (noindex active) detection
 * 5. Intentionally Failed Audit with Truthful "Audit Unavailable (Fetch Failed)" rendering
 *    and assertion of ZERO fabricated metadata defects ("✗ MISSING") or false warnings
 * 6. Evidence import & verified persistence across server restart
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-buddy-audit-accept-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getOpenPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

function startServer(port, sharedDataDir) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|RAILWAY|DATABASE|GOOGLE_APPLICATION/i.test(k))
  );

  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      PORT: String(port),
      DATA_DIR: sharedDataDir,
      APP_MODE: 'development',
      STATE_BACKEND: 'filesystem',
      DATABASE_URL: '',
      ADMIN_PASSWORD: 'browser-audit-test-password',
      REVIEWS_URL: `http://127.0.0.1:${port}`,
    },
  });

  let logs = '';
  child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-10000); });
  child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-10000); });

  const readyPromise = (async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) {
        throw new Error(`Server process exited prematurely with code ${child.exitCode}: ${logs}`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
        if (res.ok) return child;
      } catch (_) {}
      await pause(150);
    }
    child.kill();
    throw new Error(`Server on port ${port} failed to become ready within deadline. Logs:\n${logs}`);
  })();

  return { child, readyPromise, getLogs: () => logs };
}

async function runBrowserAcceptance() {
  console.log('================================================================');
  console.log('BEST DAY FITNESS: BROWSER ACCEPTANCE AUTOMATION (PLAYWRIGHT)');
  console.log('================================================================');
  console.log(`Working temporary data directory: ${dataDir}`);

  let serverInstance = null;
  let serverInstance2 = null;
  let browser = null;

  try {
    const port1 = await getOpenPort();
    console.log(`\n[Step 1] Starting ephemeral backend server on port ${port1}...`);
    serverInstance = startServer(port1, dataDir);
    await serverInstance.readyPromise;
    console.log(`Backend server ready at http://127.0.0.1:${port1}`);

    console.log('\n[Step 2] Launching Chromium browser with clipboard permissions...');
    const launchOpts = { headless: true };
    try {
      browser = await chromium.launch({ channel: 'chrome', ...launchOpts });
      console.log('Chromium browser launched using Chrome channel.');
    } catch (_) {
      browser = await chromium.launch({ channel: 'msedge', ...launchOpts });
      console.log('Chromium browser launched using Edge channel.');
    }
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });

    await context.addInitScript(() => {
      localStorage.setItem('seo_wizard_seen', '1');
      localStorage.setItem('seo_admin_password', 'browser-audit-test-password');
    });

    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    const baseUrl1 = `http://127.0.0.1:${port1}`;
    console.log(`Navigating to ${baseUrl1}...`);
    await page.goto(baseUrl1, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchTab === 'function');

    console.log('\n[Step 3] Navigating to Site Optimization tab (onsite-tab)...');
    await page.evaluate(() => window.switchTab('onsite-tab'));
    await page.waitForSelector('#website-audit-card', { state: 'visible' });
    await page.waitForSelector('#ghl-schema-card', { state: 'visible' });
    console.log('Site Optimization tab and audit/schema cards are visible.');

    // -------------------------------------------------------------
    // CHECK 1: Schema Generator & 4-Tier Validation Badges
    // -------------------------------------------------------------
    console.log('\n[Step 4] Verifying GHL Schema Generator & 4-Tier Validation Badges...');
    await page.waitForSelector('#ghl-snippet-output');
    await page.waitForFunction(() => {
      const el = document.getElementById('ghl-snippet-output');
      return el && el.value.length > 100;
    });

    const snippetText = await page.$eval('#ghl-snippet-output', el => el.value);
    assert.ok(snippetText.includes('application/ld+json'), 'Snippet must include JSON-LD script block');
    assert.ok(snippetText.includes('https://bestdayfitness.com'), 'Snippet must contain canonical domain');
    assert.ok(snippetText.includes('HealthClub'), 'Snippet must include HealthClub schema');
    assert.ok(snippetText.includes('ExerciseGym'), 'Snippet must include ExerciseGym schema');
    assert.ok(snippetText.includes('"Monday"') && snippetText.includes('"Saturday"'), 'Snippet must specify Monday through Saturday');
    assert.ok(snippetText.includes('"04:00"') && snippetText.includes('"22:00"'), 'Snippet must specify 04:00 to 22:00');
    assert.ok(snippetText.includes('"Sunday"') && snippetText.includes('"09:00"') && snippetText.includes('"17:00"'), 'Snippet must specify Sunday 09:00 to 17:00');
    assert.ok(!snippetText.includes('aggregateRating'), 'Self-serving review aggregateRating must be excluded');

    const badgeTexts = await page.$$eval('#ghl-schema-validation-badges > div', badges =>
      badges.map(b => b.innerText.trim())
    );
    console.log('Observed validation badges:', badgeTexts);
    assert.equal(badgeTexts.length, 4, 'Must display all 4 validation badges');
    assert.ok(badgeTexts.some(t => t.includes('JSON Syntax')), 'Badge 1: JSON Syntax');
    assert.ok(badgeTexts.some(t => t.includes('Approved Facts')), 'Badge 2: Approved Facts');
    assert.ok(badgeTexts.some(t => t.includes('Schema.org Vocabulary')), 'Badge 3: Schema.org Vocabulary');
    assert.ok(badgeTexts.some(t => t.includes('Google Policy')), 'Badge 4: Google Policy');

    // Test copy button
    console.log('Testing "Copy Tracking Code" button...');
    await page.click('#btn-copy-ghl-snippet');
    await page.waitForFunction(() => {
      const btn = document.getElementById('btn-copy-ghl-snippet');
      return btn && btn.innerText.includes('Copied!');
    });
    console.log('Copy Tracking Code button changed to "Copied!" successfully.');

    // -------------------------------------------------------------
    // CHECK 2: Live Hosted Preview Audit
    // -------------------------------------------------------------
    console.log('\n[Step 5] Running Live Audit of Hosted GHL Preview...');
    const previewBtn = await page.$('#btn-audit-preset-preview');
    assert.ok(previewBtn, 'Preset preview button must exist');
    await previewBtn.click();

    const targetUrl = await page.$eval('#audit-target-url', el => el.value);
    console.log(`Target URL populated: ${targetUrl}`);
    assert.ok(targetUrl.includes('link.bestdayfitness.com/preview/VRsgFMkoL8fUwW9W4ckU'), 'Must target GHL preview');

    const runBtn = await page.$('#btn-run-website-audit');
    await runBtn.click();
    console.log('Triggered audit run. Waiting for audit engine to complete (may take ~5-15s for 19.5MB payload)...');

    // Wait until button is re-enabled and results container does not contain placeholder
    await page.waitForFunction(() => {
      const btn = document.getElementById('btn-run-website-audit');
      const res = document.getElementById('website-audit-results');
      return btn && !btn.disabled && res && !res.innerText.includes('Fetching') && !res.innerText.includes('Click “Run Audit”');
    }, { timeout: 35000 });

    const auditResultsHtml = await page.$eval('#website-audit-results', el => el.innerHTML);
    const auditResultsText = await page.$eval('#website-audit-results', el => el.innerText);

    assert.ok(auditResultsText.includes('Protected Staging (noindex active)'),
      'Must identify protected staging environment with noindex active');
    assert.ok(auditResultsText.includes('GEO Optimizer: Not Run (Score: None)') || auditResultsText.includes('GEO Optimizer: Unavailable'),
      'GEO Optimizer must report truthful status (never invented fallback 34 or 78)');
    assert.ok(auditResultsText.includes('Payload size:'), 'Must report payload size');
    assert.ok(auditResultsText.includes('MB'), 'Payload size must be measured in MB');
    assert.ok(auditResultsText.includes('Inlined scripts:'), 'Must report inlined script count');
    assert.ok(auditResultsText.includes('Actionable Audit Recommendations'), 'Must include recommendations section');
    console.log('Hosted GHL preview audit passed with Protected Staging badge verified.');

    // -------------------------------------------------------------
    // CHECK 3: Intentionally Failed Audit & Truthful UI State
    // -------------------------------------------------------------
    console.log('\n[Step 6] Running Intentionally Failed Audit to verify truthful error state in UI...');
    // We target a local endpoint that returns 404
    const failingUrl = `http://127.0.0.1:${port1}/broken-nonexistent-audit-endpoint`;
    await page.fill('#audit-target-url', failingUrl);
    await page.click('#btn-run-website-audit');

    await page.waitForFunction(() => {
      const btn = document.getElementById('btn-run-website-audit');
      const res = document.getElementById('website-audit-results');
      return btn && !btn.disabled && res && !res.innerText.includes('Fetching');
    }, { timeout: 15000 });

    const failedAuditText = await page.$eval('#website-audit-results', el => el.innerText);

    console.log('Failed audit displayed text summary:');
    console.log(failedAuditText.split('\n').filter(Boolean).slice(0, 8).join('\n'));

    // Assert truthful unavailable badges and placeholders
    assert.ok(failedAuditText.includes('Audit Unavailable (Fetch Failed)'),
      'Must display "Audit Unavailable (Fetch Failed)" badge');
    assert.ok(!failedAuditText.includes('Production Noindex Warning'),
      'Must NOT display "Production Noindex Warning" when fetch failed');
    assert.ok(!failedAuditText.includes('✗ MISSING'),
      'Must NOT fabricate metadata defects ("✗ MISSING") when page was not fetched');
    assert.ok(failedAuditText.includes('Unavailable (fetch failed)'),
      'Strict head metadata fields must display "Unavailable (fetch failed)"');
    console.log('Truthful failed UI rendering verified: no fabricated defects or false warnings.');

    // -------------------------------------------------------------
    // CHECK 4: Import Real GEO Tool Evidence & Verify UI Display
    // -------------------------------------------------------------
    console.log('\n[Step 7] Importing real GEO tool evidence via API...');
    const evidenceArtifactPath = path.resolve(
      'C:/Users/chris/.gemini/antigravity/brain/902d0ef8-80e1-4892-97e0-44fe87437e0d/geo-audits/baseline-staging-preview.json'
    );
    assert.ok(fs.existsSync(evidenceArtifactPath), `Artifact must exist at ${evidenceArtifactPath}`);
    const rawArtifact = JSON.parse(fs.readFileSync(evidenceArtifactPath, 'utf8'));

    const importResponse = await fetch(`${baseUrl1}/api/website-audit/geo-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer browser-audit-test-password',
      },
      body: JSON.stringify({
        targetUrl: rawArtifact.url,
        evidence: rawArtifact,
      }),
    });

    assert.equal(importResponse.status, 200, 'Import API must return HTTP 200');
    const importData = await importResponse.json();
    assert.equal(importData.success, true, 'Import API must succeed');
    console.log('GEO tool evidence imported successfully.');

    // Re-audit the preview URL to combine website fetch with the imported GEO evidence
    console.log('Re-auditing preview URL to evaluate with imported GEO evidence...');
    await page.fill('#audit-target-url', rawArtifact.url);
    await page.click('#btn-run-website-audit');

    await page.waitForFunction(() => {
      const btn = document.getElementById('btn-run-website-audit');
      const res = document.getElementById('website-audit-results');
      return btn && !btn.disabled && res && !res.innerText.includes('Fetching');
    }, { timeout: 35000 });

    const combinedAuditText = await page.$eval('#website-audit-results', el => el.innerText);
    assert.ok(combinedAuditText.includes('GEO Optimizer: Unavailable (Score: None)'),
      'Must truthfully show GEO Optimizer: Unavailable (Score: None) due to CLI 10MB limit failure');
    assert.ok(combinedAuditText.includes('Response too large'),
      'Must display the genuine error reason: Response too large');
    console.log('Combined audit with imported GEO evidence verified.');

    // -------------------------------------------------------------
    // CHECK 5: Verify Persistence Across Server Restart
    // -------------------------------------------------------------
    console.log('\n[Step 8] Testing persistence across server restart...');
    console.log(`Stopping initial backend server on port ${port1}...`);
    serverInstance.child.kill();
    await pause(1000);

    const possiblePaths = [
      path.join(dataDir, 'website-audit.json'),
      path.join(dataDir, 'best-day-fitness', 'website-audit.json'),
      path.join(dataDir, 'tenants', 'best-day-fitness', 'website-audit.json'),
    ];
    const auditDbFile = possiblePaths.find(p => fs.existsSync(p));
    assert.ok(auditDbFile, `website-audit.json must exist in ${dataDir} or tenant subdirectory`);
    const savedStateOnDisk = JSON.parse(fs.readFileSync(auditDbFile, 'utf8'));
    assert.ok(savedStateOnDisk.latest != null, 'Saved state must have latest audit snapshot');
    assert.ok(savedStateOnDisk.evidence != null, 'Saved state must have evidence map');
    console.log(`Confirmed disk persistence: ${auditDbFile} has ${savedStateOnDisk.history.length} history entries.`);

    const port2 = await getOpenPort();
    console.log(`Starting new backend server instance on port ${port2} using the same DATA_DIR...`);
    const serverInstance2 = startServer(port2, dataDir);
    await serverInstance2.readyPromise;
    console.log(`Second backend server ready at http://127.0.0.1:${port2}`);

    const baseUrl2 = `http://127.0.0.1:${port2}`;
    console.log(`Navigating browser to restarted server at ${baseUrl2}...`);
    await page.goto(baseUrl2, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchTab === 'function');
    await page.evaluate(() => window.switchTab('onsite-tab'));

    // Wait for the restored state to be rendered from GET /api/website-audit
    await page.waitForFunction(() => {
      const res = document.getElementById('website-audit-results');
      return res && !res.innerText.includes('Click “Run Audit”') && !res.innerText.includes('No audit results yet');
    }, { timeout: 10000 });

    const restartedAuditText = await page.$eval('#website-audit-results', el => el.innerText);
    assert.ok(restartedAuditText.includes('Protected Staging (noindex active)'),
      'Restored UI must preserve Protected Staging crawl status');
    assert.ok(restartedAuditText.includes('GEO Optimizer: Unavailable (Score: None)'),
      'Restored UI must preserve imported GEO Optimizer evidence state');
    assert.ok(restartedAuditText.includes('Response too large'),
      'Restored UI must preserve exact error string');
    console.log('Persistence across server restart verified in browser UI.');

    console.log('\n================================================================');
    console.log('ALL BROWSER ACCEPTANCE CHECKS PASSED PERFECTLY!');
    console.log('================================================================\n');

  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverInstance && serverInstance.child && serverInstance.child.exitCode == null) {
      serverInstance.child.kill();
    }
    if (serverInstance2 && serverInstance2.child && serverInstance2.child.exitCode == null) {
      serverInstance2.child.kill();
    }
    await pause(500);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runBrowserAcceptance().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\nFAIL: Browser acceptance test failed:');
  console.error(err.stack || err.message);
  process.exit(1);
});
