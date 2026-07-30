import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_CHUNK_LIMIT } from './preprocessing/contracts.ts';
import { finalizeChunkDrafts } from './preprocessing/core.ts';
import {
  chunkTableBlock,
  escapeMarkdownCell,
  extractMarkdownTableBlocks,
} from './preprocessing/table-chunker.ts';

function finalize(output) {
  return finalizeChunkDrafts({ originalLength: 1, ...output });
}

test('split tables repeat headers and preserve special cell content', () => {
  const block = {
    id: 'table-1', kind: 'table', order: 0, headingPath: [],
    rows: [
      ['상품', '설명'],
      ...Array.from({ length: 90 }, (_, index) => [
        `P-${index + 1}`,
        index === 0
          ? 'A|B, "인용"\n둘째 줄 : 상세 '.repeat(35)
          : `설명 ${index + 1}: 상세 정보 `.repeat(5),
      ]),
    ],
  };

  const result = finalize(chunkTableBlock(block, ['[시트] 원본목록']));

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.ok(result.chunks.every((chunk) => chunk.includes('| 상품 | 설명 |\n| --- | --- |')));
  assert.match(result.processedText, /A\\\|B, "인용"<br>둘째 줄/);
  assert.equal(result.processedText.match(/P-1(?!\d)/g)?.length, 1);
  assert.equal(result.resultStatus, 'ready');
});

test('extracts two adjacent markdown tables as distinct table blocks', () => {
  const blocks = extractMarkdownTableBlocks([
    '| 이름 | 값 |',
    '| --- | --- |',
    '| 첫째 | 1 |',
    '',
    '| 이름 | 값 |',
    '| --- | --- |',
    '| 둘째 | 2 |',
  ].join('\n'), 'doc');

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((block) => block.id), ['doc-table-1', 'doc-table-2']);
  assert.deepEqual(blocks.map((block) => block.rows), [
    [['이름', '값'], ['첫째', '1']],
    [['이름', '값'], ['둘째', '2']],
  ]);
});

test('keeps literal backslashes while parsing markdown table cells', () => {
  const [block] = extractMarkdownTableBlocks([
    '| 경로 | 값 |',
    '| --- | --- |',
    '| C:\\temp\\file | A\\|B |',
  ].join('\n'), 'paths');

  assert.deepEqual(block.rows, [['경로', '값'], ['C:\\temp\\file', 'A|B']]);
});

test('reports multiple table regions separated by a fully empty row', () => {
  const output = chunkTableBlock({
    id: 'combined', kind: 'table', order: 0, headingPath: [],
    rows: [
      ['첫째', '값'], ['A', '1'], ['', ''],
      ['둘째', '값'], ['B', '2'],
    ],
  }, []);

  assert.equal(output.warnings.some((issue) => issue.code === 'MULTIPLE_TABLES'), true);
  assert.deepEqual(finalize(output).chunks, [
    '| 첫째 | 값 |\n| --- | --- |\n| A | 1 |',
    '| 둘째 | 값 |\n| --- | --- |\n| B | 2 |',
  ]);
});

test('reports irregular column locations without inventing merged cells', () => {
  const block = {
    id: 'irregular', kind: 'table', order: 0, headingPath: [],
    rows: [['구분', '값'], ['정상', '1'], ['불규칙', '2', '추가']],
    merges: [{
      range: 'A1:B1', start: { row: 0, column: 0 }, end: { row: 0, column: 1 },
    }],
  };

  const output = chunkTableBlock(block, []);
  const result = finalize(output);

  assert.equal(output.warnings.some((issue) => issue.code === 'IRREGULAR_COLUMNS'), true);
  assert.deepEqual(
    output.warnings.find((issue) => issue.code === 'IRREGULAR_COLUMNS')?.locations,
    ['row 3'],
  );
  assert.equal(output.warnings.some((issue) => issue.code === 'MERGED_CELLS'), true);
  assert.match(result.processedText, /\| 불규칙 \| 2 \| 추가 \|/);
  assert.equal(result.resultStatus, 'review');
});

test('splits a 4,100-character cell without repeating row body values', () => {
  const block = {
    id: 'long-cell', kind: 'table', order: 0, headingPath: [],
    rows: [['ID', '내용'], ['R-1', '가'.repeat(4100)]],
  };

  const result = finalize(chunkTableBlock(block, ['[표] 긴 값']));

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.ok(result.chunks.every((chunk) => chunk.includes('| ID | 내용 |\n| --- | --- |')));
  assert.equal(result.processedText.match(/R-1/g)?.length, 1);
  assert.equal(result.processedText.match(/가/g)?.length, 4100);
});

test('fragments an oversized sole first cell through its column label and consumes its source once', () => {
  const output = chunkTableBlock({
    id: 'sole-first', kind: 'table', order: 0, headingPath: [],
    rows: [['내용'], ['가'.repeat(4100)]],
  }, ['[표] 단일 열']);
  const result = finalize(output);

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.ok(result.chunks.every((chunk) => chunk.includes('| 내용 |\n| --- |')));
  assert.equal(result.processedText.includes('행 분할: 내용: '), true);
  assert.equal(result.processedText.match(/가/g)?.length, 4100);
  assert.deepEqual(output.expectedSourceBlockIds, ['sole-first']);
  assert.deepEqual(output.drafts[0].sourceBlockIds, ['sole-first']);
  assert.equal(output.drafts.slice(1).every((draft) => draft.sourceBlockIds.length === 0), true);
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('fragments an oversized first cell without promoting a short later cell to identifier', () => {
  const result = finalize(chunkTableBlock({
    id: 'long-first', kind: 'table', order: 0, headingPath: [],
    rows: [['주요', '보조'], ['가'.repeat(4100), '짧음']],
  }, ['[표] 첫 열 초과']));

  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.processedText.includes('행 분할: 주요: '), true);
  assert.equal(result.processedText.includes('행 분할: 보조: 짧음'), true);
  assert.equal(result.processedText.includes('행 분할: 짧음'), false);
  assert.equal(result.processedText.match(/가/g)?.length, 4100);
  assert.equal(result.processedText.match(/짧음/g)?.length, 1);
});

test('normalizes and escapes an oversized first cell before bounded fragmentation', () => {
  const value = `A\\|B\r\n${'z'.repeat(4100)}`;
  const result = finalize(chunkTableBlock({
    id: 'escaped-first', kind: 'table', order: 0, headingPath: [],
    rows: [['경로'], [value]],
  }, ['[표] 특수 문자']));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.equal(result.processedText.includes('\r'), false);
  assert.equal(result.processedText.includes('A\\\\\\|B<br>'), true);
  assert.equal(result.processedText.match(/<br>/g)?.length, 1);
  assert.equal(result.processedText.match(/z/g)?.length, 4100);
});

test('keeps a short first cell as the row identifier when a later cell is oversized', () => {
  const result = finalize(chunkTableBlock({
    id: 'short-id', kind: 'table', order: 0, headingPath: [],
    rows: [['ID', '내용'], ['R-1', '가'.repeat(4100)]],
  }, ['[표] 짧은 ID']));

  assert.equal(result.processedText.includes('행 분할: R-1'), true);
  assert.equal(result.processedText.includes('행 분할: ID: R-1'), false);
  assert.equal(result.processedText.match(/R-1/g)?.length, 1);
});

test('blocks oversized first-cell fragmentation when the framing leaves too little body budget', () => {
  const tableStart = '| 내용 |\n| --- |';
  const context = ['x'.repeat(APP_CHUNK_LIMIT - tableStart.length - 11)];
  const result = finalize(chunkTableBlock({
    id: 'first-cell-framing', kind: 'table', order: 0, headingPath: [],
    rows: [['내용'], ['가'.repeat(4100)]],
  }, context));

  assert.equal(result.resultStatus, 'blocked');
  assert.deepEqual(result.chunks, []);
  assert.equal(result.issues.some((issue) => issue.code === 'TABLE_FRAMING_EXCEEDS_LIMIT'), true);
});

test('blocks a table when context and framing leave no body budget', () => {
  const tableStart = '| ID | 값 |\n| --- | --- |';
  const row = '| R-1 | 1 |';
  const nearLimit = finalize(chunkTableBlock({
    id: 'near-limit', kind: 'table', order: 0, headingPath: [],
    rows: [['ID', '값'], ['R-1', '1']],
  }, ['x'.repeat(APP_CHUNK_LIMIT - tableStart.length - row.length - 2)]));
  const overLimit = finalize(chunkTableBlock({
    id: 'over-limit', kind: 'table', order: 0, headingPath: [],
    rows: [['ID', '값'], ['R-1', '1']],
  }, ['x'.repeat(APP_CHUNK_LIMIT - tableStart.length)]));

  assert.equal(nearLimit.resultStatus, 'ready');
  assert.equal(nearLimit.chunks[0].length, APP_CHUNK_LIMIT);
  assert.equal(overLimit.resultStatus, 'blocked');
  assert.equal(overLimit.chunks.length, 0);
  assert.equal(
    overLimit.issues.some((issue) => issue.code === 'TABLE_FRAMING_EXCEEDS_LIMIT'),
    true,
  );
});

test('normalizes CRLF before oversized value fragmentation', () => {
  const tableStart = '| ID | 내용 |\n| --- | --- |';
  const valuePrefix = '행 분할: 내용: ';
  const context = ['x'.repeat(APP_CHUNK_LIMIT - tableStart.length - valuePrefix.length - 22)];
  const result = finalize(chunkTableBlock({
    id: 'crlf', kind: 'table', order: 0, headingPath: [],
    rows: [['ID', '내용'], ['CR-1', `aaaa\r\n${'z'.repeat(200)}`]],
  }, context));

  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.equal(result.processedText.includes('\r'), false);
  assert.equal(result.processedText.match(/<br>/g)?.length, 1);
  assert.equal(result.processedText.match(/a/g)?.length, 4);
  assert.equal(result.processedText.match(/z/g)?.length, 200);
});

test('renders a header-only table once without producing an empty chunk', () => {
  const block = {
    id: 'header-only', kind: 'table', order: 0, headingPath: [],
    rows: [['항목', '내용']],
  };

  const result = finalize(chunkTableBlock(block, []));

  assert.deepEqual(result.chunks, ['| 항목 | 내용 |\n| --- | --- |']);
  assert.equal(result.stats.emptyChunkCount, 0);
  assert.equal(result.resultStatus, 'ready');
});

test('escapes backslashes, pipes, and cell line breaks for markdown', () => {
  assert.equal(escapeMarkdownCell('C:\\temp|value\r\nnext'), 'C:\\\\temp\\|value<br>next');
});
