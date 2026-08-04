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
  assert.equal(
    result.issues.find((entry) => entry.code === 'source-separator-replaced')?.message,
    '원문에 포함된 MISO 구분자(@@@)를 다른 문자로 바꿨습니다.',
  );
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

test('page decoration removal keeps an identical business phrase away from page boundaries', () => {
  const source = [
    '1-1', '공통 안내 문구', '첫 페이지 본문', '첫 페이지 상세',
    '2-2', '공통 안내 문구', '둘째 페이지 본문', '둘째 페이지 상세',
    '업무 절차', '세부 단계', '승인 기준', '공통 안내 문구',
  ].join('\n');
  const prepared = prepareSourceText(source);

  assert.equal(prepared.text.match(/공통 안내 문구/g)?.length, 2);
  assert.equal(prepared.text.endsWith('공통 안내 문구'), true);
  assert.equal(
    prepared.warnings.find((entry) => entry.code === 'page-decoration-removed')?.message,
    '반복되는 페이지 머리말·꼬리말을 제거했습니다.',
  );
});

test('duplicate source-block consumption blocks finalization', () => {
  const result = finalizeChunkDrafts({
    originalLength: 8,
    expectedSourceBlockIds: ['p1'],
    drafts: [
      { body: '첫 청크', contextLines: [], sourceBlockIds: ['p1'], warnings: [] },
      { body: '중복 청크', contextLines: [], sourceBlockIds: ['p1'], warnings: [] },
    ],
  });

  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.canDownload, false);
  assert.equal(
    result.issues.some((entry) => entry.code === 'source-block-consumption-mismatch'),
    true,
  );
});

test('Korean dash-style page numbers are recognized and dropped with their headers', () => {
  const source = [
    '규정 본문 첫 단락입니다.',
    '발전처 운영규정', '- 1 -',
    '규정 본문 둘째 단락입니다.',
    '발전처 운영규정', '- 2 -',
    '규정 본문 셋째 단락입니다.',
  ].join('\n');
  const prepared = prepareSourceText(source);

  assert.equal(prepared.text.match(/발전처 운영규정/g)?.length, 1);
  assert.equal(prepared.text.includes('- 1 -'), false);
  assert.equal(prepared.text.includes('- 2 -'), false);
  assert.ok(prepared.text.includes('규정 본문 셋째 단락입니다.'));
});
