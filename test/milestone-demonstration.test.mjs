import test from 'node:test';
import assert from 'node:assert/strict';
import { runDemonstration } from 'file:///C:/Users/chris/.gemini/antigravity/brain/902d0ef8-80e1-4892-97e0-44fe87437e0d/scratch/demonstrate-milestone.mjs';

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

test('positive demonstration test: succeeds and satisfies all gates when fetch returns preview response', async () => {
  const result = await runDemonstration();
  assert.equal(result, true, 'Demonstration must satisfy all gates and return true');
});
