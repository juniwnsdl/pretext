import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_CHUNK_LIMIT } from './preprocessing/contracts.ts';
import { finalizeChunkDrafts } from './preprocessing/core.ts';
import { chunkWorkbookDocument } from './preprocessing/excel-chunker.ts';
import { preprocessByDocType, preprocessExtractedDocument } from './text-preprocessor.ts';

function workbookDocument(blocks, warnings = []) {
  return {
    version: 1,
    fileName: '점검.xlsx',
    sourceFormat: 'xlsx',
    extractionMethod: 'local-excel',
    blocks,
    warnings,
  };
}

function table(id, sheetName, rows, merges = undefined) {
  return {
    id,
    kind: 'table',
    order: Number(id.replace(/\D/g, '')) - 1,
    headingPath: [],
    sheetName,
    tableId: id,
    rows,
    ...(merges ? { merges } : {}),
  };
}

test('keeps sheets and blank-row table regions as hard chunk boundaries', () => {
  const document = workbookDocument([
    table('sheet-1', '일일점검', [
      ['설비', '상태'], ['P-1', '정상'], ['', ''],
      ['설비', '압력'], ['P-2', '10'],
    ]),
    table('sheet-2', '운전값', [['항목', '값'], ['V-1', '20']]),
  ]);

  const result = preprocessExtractedDocument(document, 'excel');

  assert.equal(result.chunks.length, 3);
  assert.deepEqual(result.chunks.map((chunk) => chunk.split('\n').slice(0, 3)), [
    ['[파일] 점검.xlsx', '[시트] 일일점검', '[표] 1'],
    ['[파일] 점검.xlsx', '[시트] 일일점검', '[표] 2'],
    ['[파일] 점검.xlsx', '[시트] 운전값', '[표] 1'],
  ]);
  assert.equal(result.chunks[0].includes('P-2'), false);
  assert.equal(result.chunks[1].includes('P-1'), false);
  assert.equal(result.chunks[2].includes('P-1') || result.chunks[2].includes('P-2'), false);
  assert.equal(result.issues.some((issue) => issue.code === 'MULTIPLE_TABLES'), true);
});

test('uses detected header rows and keeps Item sections in separate Excel chunks', () => {
  const mechanicalRows = Array.from({ length: 14 }, (_, index) => [
    `M-${index + 1}`,
    `Mechanical equipment ${index + 1}`,
    `Vendor ${index + 1} ${'M'.repeat(220)}`,
    'Korea',
    '',
  ]);
  const electricalRows = Array.from({ length: 14 }, (_, index) => [
    `E-${index + 1}`,
    `Electrical equipment ${index + 1}`,
    `Vendor ${index + 1} ${'E'.repeat(220)}`,
    'Korea',
    '',
  ]);
  const block = table('sheet-1', 'Sub-Supplier List', [
    ['Attachment 6', '', '', '', ''],
    ['Anyang Plant', '', '', '', ''],
    ['No.', 'Description', 'Vendor Name', 'Origin', 'Remarks'],
    ['', '', '', '', ''],
    ['Item : Mechanical', '', '', '', ''],
    ...mechanicalRows,
    ['Item : Electrical', '', '', '', ''],
    ...electricalRows,
  ]);
  block.excelLayout = {
    usedRange: { startRow: 1, endRow: 34 },
    headerRows: { startRow: 1, endRow: 4, source: 'print-titles' },
  };
  const document = workbookDocument([block]);

  const result = preprocessExtractedDocument(document, 'excel');

  const mechanicalChunks = result.chunks.filter((chunk) => chunk.includes('[항목] Mechanical'));
  const electricalChunks = result.chunks.filter((chunk) => chunk.includes('[항목] Electrical'));
  assert.ok(mechanicalChunks.length > 1);
  assert.ok(electricalChunks.length > 1);
  assert.equal(result.chunks.length, mechanicalChunks.length + electricalChunks.length);
  assert.ok(result.chunks.every((chunk) =>
    chunk.includes('| No. | Description | Vendor Name | Origin | Remarks |\n| --- | --- | --- | --- | --- |'),
  ));
  assert.ok(mechanicalChunks.every((chunk) => !chunk.includes('E-1')));
  assert.ok(electricalChunks.every((chunk) => !chunk.includes('M-1')));
  assert.ok(result.chunks.every((chunk) => !chunk.includes('| Item : Mechanical |')));
  assert.ok(result.chunks.every((chunk) => !chunk.includes('| Item : Electrical |')));
});

test('repeats headers while safely fragmenting a 4,100-character Excel cell once', () => {
  const document = workbookDocument([
    table('sheet-1', '장문', [['ID', '열 이름'], ['ROW-4100', '값'.repeat(4100)]]),
  ]);

  const result = preprocessExtractedDocument(document, 'excel');

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.ok(result.chunks.every((chunk) => chunk.includes('| ID | 열 이름 |\n| --- | --- |')));
  assert.equal(result.processedText.match(/ROW-4100/g)?.length, 1);
  assert.equal(result.processedText.match(/값/g)?.length, 4100);
  assert.equal(result.processedText.includes('행 분할: 열 이름: 값'), true);
});

test('retains extraction, merged-range, and irregular-column warnings', () => {
  const extractionWarning = {
    code: 'SOURCE_NOTE', severity: 'warning', message: '원본 경고', locations: ['점검.xlsx'],
  };
  const document = workbookDocument([
    table('sheet-1', '병합', [
      ['설비', '상태'], ['P-1', '정상'], ['P-2', '주의', '비고'],
    ], [{
      range: 'A1:B1', start: { row: 0, column: 0 }, end: { row: 0, column: 1 },
    }]),
  ], [extractionWarning]);

  const output = chunkWorkbookDocument(document);
  const warningCodes = output.warnings.map((issue) => issue.code);

  assert.ok(warningCodes.includes('SOURCE_NOTE'));
  assert.ok(warningCodes.includes('MERGED_CELLS'));
  assert.ok(warningCodes.includes('IRREGULAR_COLUMNS'));
  assert.deepEqual(
    output.warnings.find((issue) => issue.code === 'IRREGULAR_COLUMNS')?.locations,
    ['row 3'],
  );
});

test('does not duplicate an extractor merge warning while chunking regions', () => {
  const merge = {
    range: 'A1:B1', start: { row: 0, column: 0 }, end: { row: 0, column: 1 },
  };
  const document = workbookDocument([
    table('sheet-1', '병합', [['설비', ''], ['P-1', '정상']], [merge]),
  ], [{
    code: 'MERGED_CELLS',
    severity: 'warning',
    message: 'Sheet "병합" contains merged cells; covered cells remain empty.',
    count: 1,
    locations: ['병합!A1:B1'],
  }]);

  const output = chunkWorkbookDocument(document);

  assert.equal(output.warnings.filter((issue) => issue.code === 'MERGED_CELLS').length, 1);
  assert.deepEqual(
    output.warnings.find((issue) => issue.code === 'MERGED_CELLS')?.locations,
    ['병합!A1:B1'],
  );
});

test('consumes every non-empty workbook row identifier exactly once in body content', () => {
  const identifiers = ['R-001', 'R-002', 'R-003', 'R-004'];
  const document = workbookDocument([
    table('sheet-1', '목록', [
      ['ID', '내용'],
      ...identifiers.map((id, index) => [id, index === 2 ? '긴 값 '.repeat(1200) : `값 ${index}`]),
    ]),
  ]);

  const output = chunkWorkbookDocument(document);
  const body = output.drafts.map((draft) => draft.body).join('\n');

  for (const identifier of identifiers) {
    assert.equal(body.match(new RegExp(identifier, 'g'))?.length, 1);
  }
  const result = finalizeChunkDrafts({ originalLength: 1, ...output });
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('structured workbook blocks take precedence over flat preview text', () => {
  const document = workbookDocument([
    table('sheet-1', '구조', [['ID', '값'], ['STRUCTURED-1', '정상']]),
    {
      id: 'preview', kind: 'raw-text', order: 1, headingPath: [],
      text: 'ID,값\nFLAT-1,무시',
    },
  ]);

  const result = preprocessExtractedDocument(document, 'excel');

  assert.equal(result.processedText.includes('STRUCTURED-1'), true);
  assert.equal(result.processedText.includes('FLAT-1'), false);
});

test('keeps CSV and Markdown flat-text compatibility for edited Excel previews', () => {
  const csv = preprocessByDocType('ID,설명\nC-1,"A,B"', 'excel', { documentName: '수정.csv' });
  const markdown = preprocessByDocType([
    '| ID | 상태 |',
    '| --- | --- |',
    '| M-1 | 정상 |',
  ].join('\n'), 'excel', { documentName: '수정.md' });

  assert.match(csv.processedText, /\| C-1 \| A,B \|/);
  assert.match(markdown.processedText, /\| M-1 \| 정상 \|/);
  assert.equal(csv.chunks[0].startsWith('[파일] 수정.csv\n[시트] 수정.csv\n[표] 1\n'), true);
});
