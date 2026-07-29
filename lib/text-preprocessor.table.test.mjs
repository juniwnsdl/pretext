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

test('splits a 4,100-character cell into labelled fragments under the safe limit', () => {
  const block = {
    id: 'long-cell', kind: 'table', order: 0, headingPath: [],
    rows: [['ID', '내용'], ['R-1', '가'.repeat(4100)]],
  };

  const result = finalize(chunkTableBlock(block, ['[표] 긴 값']));

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.ok(result.chunks.every((chunk) => chunk.includes('| ID | 내용 |\n| --- | --- |')));
  assert.ok(result.chunks.every((chunk) => chunk.includes('행 분할: R-1')));
  assert.equal(result.processedText.match(/가/g)?.length, 4100);
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
