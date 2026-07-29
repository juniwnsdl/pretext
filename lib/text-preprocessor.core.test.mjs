import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_CHUNK_LIMIT,
  MISO_SEPARATOR,
} from './preprocessing/contracts.ts';
import {
  finalizeChunkDrafts,
  prepareSourceText,
  revalidateEditedChunks,
} from './preprocessing/core.ts';

test('MISO output uses the fixed separator and stays within 3,800 characters', () => {
  const result = finalizeChunkDrafts({
    originalLength: 4200,
    expectedSourceBlockIds: ['p1'],
    drafts: [{
      body: `원문 @@@ ${'단어 '.repeat(1500).trim()}`,
      contextLines: ['[문서] 안전절차서'],
      sourceBlockIds: ['p1'],
      warnings: [],
    }],
  });

  assert.equal(MISO_SEPARATOR, '@@@');
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.equal(result.processedText.includes('\n@@@\n'), true);
  assert.equal(result.processedText.includes('＠＠＠'), true);
  assert.equal(result.stats.sourceSeparatorCollisionCount, 1);
});

test('normalization preserves indentation and repeated business content', () => {
  const source = [
    '주의 사항', '  - 권한을 차단합니다', '',
    '주의 사항', '  - 권한을 차단합니다', '',
    '주의 사항', '  - 권한을 차단합니다',
  ].join('\n');
  const prepared = prepareSourceText(source);

  assert.equal(prepared.text.match(/주의 사항/g)?.length, 3);
  assert.equal(prepared.text.match(/^  - 권한을 차단합니다$/gm)?.length, 3);
});

test('manual edits with an empty or oversized chunk are blocked', () => {
  const result = revalidateEditedChunks(['정상', '', '가'.repeat(3801)], 3805);
  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.canDownload, false);
  assert.equal(result.stats.emptyChunkCount, 1);
  assert.equal(result.stats.safeLimitExceededCount, 1);
});
