import test from 'node:test';
import assert from 'node:assert/strict';

import { getHelpTab } from './help-guide-layout.ts';

test('keeps conceptual and file decision guidance together', () => {
  const understanding = getHelpTab('understanding');

  assert.deepEqual(understanding.sectionIds, [
    'necessity',
    'handling-guide',
    'file-routing',
    'support-scope',
  ]);
});

test('keeps tool purpose and operating instructions together', () => {
  const usage = getHelpTab('usage');

  assert.deepEqual(usage.sectionIds, [
    'tool-purpose',
    'steps',
    'document-types',
    'automatic-rules',
    'review-cautions',
  ]);
});
