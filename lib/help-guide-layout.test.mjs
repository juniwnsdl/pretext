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

test('places file handling guidance directly after the usage steps', () => {
  const usage = getHelpTab('usage');

  assert.deepEqual(usage.sectionIds, [
    'tool-purpose',
    'steps',
    'file-routing',
    'support-scope',
    'document-types',
    'automatic-rules',
    'review-cautions',
  ]);
});
