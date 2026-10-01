import test from 'node:test';
import assert from 'node:assert/strict';
import { runDemonstration } from '../scripts/demonstrate-milestone.mjs';

test('negative demonstration test: fails and throws AssertionError when website audit fetch fails', async () => {
  let threwExpectedAssertion = false;

  try {
    // Inject a failing fetch implementation simulating network outage / DNS failure
    await runDemonstration({
      fetchFn: async () => {
        throw new Error('Synthetic network outage: ENOTFOUND link.bestdayfitness.com');
      },
    });
  } catch (err) {
    threwExpectedAssertion = true;
    assert.ok(
      err.name === 'AssertionError' || err.message.includes('Website audit must succeed'),
      `Expected AssertionError for audit failure, got: ${err.message}`
    );
  }

  assert.equal(threwExpectedAssertion, true, 'Demonstration must NOT exit successfully when website audit fails');
});

test('positive deterministic demonstration test: satisfies all 5 gates without requiring external network connectivity', async () => {
  const deterministicPreviewHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta name="robots" content="noindex, nofollow">
    <title>Best Day Fitness & Wellness Preview</title>
  </head>
  <body>
    <h1>Best Day Fitness & Wellness</h1>
    <p>Private barefoot training studio for adults 50+ in St. Petersburg, FL.</p>
  </body>
</html>`;

  const deterministicFetch = async () => ({
    status: 200,
    headers: {
      get: (header) => (header.toLowerCase() === 'x-robots-tag' ? 'noindex' : null),
    },
    body: deterministicPreviewHtml,
    text: async () => deterministicPreviewHtml,
  });

  const result = await runDemonstration({ fetchFn: deterministicFetch });
  assert.equal(result, true, 'Deterministic demonstration must satisfy all gates and return true');
});

// Explicit live-network verification (invoked with RUN_LIVE_TESTS=1)
if (process.env.RUN_LIVE_TESTS === '1' || process.env.LIVE_AUDIT === '1') {
  test('positive live-network demonstration test: validates live hosted GHL preview over network', async () => {
    const result = await runDemonstration();
    assert.equal(result, true, 'Live demonstration must satisfy all gates and return true');
  });
}
