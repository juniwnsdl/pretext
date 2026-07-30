import test from 'node:test';
import assert from 'node:assert/strict';

import { getHelpTab } from './help-guide-layout.ts';

test('keeps conceptual and file decision guidance together', () => {
  const understanding = getHelpTab('understanding');

  assert.deepEqual(understanding.sectionIds, [
    'necessity',
    'handling-guide',
  ]);
});

test('places one combined document rules section after file handling guidance', () => {
  const usage = getHelpTab('usage');

  assert.deepEqual(usage.sectionIds, [
    'tool-purpose',
    'steps',
    'file-routing',
    'support-scope',
    'document-rules',
    'review-cautions',
  ]);
});
