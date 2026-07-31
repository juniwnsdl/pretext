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

test('composes screenshot-shaped merged headers without changing the seven source columns', () => {
  const block = table('sheet-1', '시간대별(경상)2', [
    ['', '시간', 'SMP\n(수도권)', 'SMP<br>(비 수도권)', '대상 발전기', '', ''],
    ['', '', '', '', 'Generation\n[MW]', 'Fuel Offtake\n[GJ]', 'Available Capacity\n[MW]'],
    ['2025', '2025/01/01 00h', '149.1857255', '149.1857255', '0', '0', '0'],
  ], [
    { range: 'A2:A3', start: { row: 1, column: 0 }, end: { row: 2, column: 0 } },
    { range: 'B2:B3', start: { row: 1, column: 1 }, end: { row: 2, column: 1 } },
    { range: 'C2:C3', start: { row: 1, column: 2 }, end: { row: 2, column: 2 } },
    { range: 'D2:D3', start: { row: 1, column: 3 }, end: { row: 2, column: 3 } },
    { range: 'E2:G2', start: { row: 1, column: 4 }, end: { row: 1, column: 6 } },
  ]);
  block.excelLayout = {
    usedRange: { startRow: 2, endRow: 4, startColumn: 1, endColumn: 7 },
    headerRows: { startRow: 2, endRow: 3, source: 'manual' },
  };

  const result = preprocessExtractedDocument(workbookDocument([block]), 'excel');

  assert.equal(result.chunks.length, 1);
  assert.ok(result.chunks[0].includes([
    '|  | 시간 | SMP (수도권) | SMP (비 수도권) | 대상 발전기 > Generation [MW] | 대상 발전기 > Fuel Offtake [GJ] | 대상 발전기 > Available Capacity [MW] |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 2025 | 2025/01/01 00h | 149.1857255 | 149.1857255 | 0 | 0 | 0 |',
  ].join('\n')));
  assert.equal(result.chunks[0].includes('[머리행] Generation'), false);
  const warning = result.issues.find((issue) => issue.code === 'COMPLEX_EXCEL_HEADER');
  assert.equal(warning?.message, '복잡한 병합·다단 머리행이 감지되었습니다. 일부 열 이름이 데이터와 정확히 연결되지 않을 수 있습니다. 원본과 결과를 비교하거나 ‘엑셀 머리행 설정’에서 머리행 범위를 확인하세요.');
  assert.deepEqual(warning?.locations, [
    '시간대별(경상)2!A2:A3',
    '시간대별(경상)2!B2:B3',
    '시간대별(경상)2!C2:C3',
    '시간대별(경상)2!D2:D3',
    '시간대별(경상)2!E2:G2',
  ]);
});

test('composes vertical and duplicate header segments in a non-A1 range', () => {
  const block = table('sheet-1', '오프셋', [
    ['설비', '상태', '측정값'],
    ['', '상태', '압력'],
    ['P-1', '정상', '10'],
  ], [
    { range: 'C5:C6', start: { row: 4, column: 2 }, end: { row: 5, column: 2 } },
  ]);
  block.excelLayout = {
    usedRange: { startRow: 5, endRow: 7, startColumn: 3, endColumn: 5 },
    headerRows: { startRow: 5, endRow: 6, source: 'manual' },
  };

  const result = preprocessExtractedDocument(workbookDocument([block]), 'excel');

  assert.ok(result.processedText.includes('| 설비 | 상태 | 측정값 > 압력 |'));
  assert.equal(result.processedText.includes('상태 > 상태'), false);
});

test('keeps a single merged parent row inside the selected header band', () => {
  const block = table('sheet-1', '상위제목', [
    ['대상 발전기', '', ''],
    ['Generation', 'Fuel', 'Capacity'],
    ['1', '2', '3'],
  ], [{ range: 'A1:C1', start: { row: 0, column: 0 }, end: { row: 0, column: 2 } }]);
  block.excelLayout = {
    usedRange: { startRow: 1, endRow: 3, startColumn: 1, endColumn: 3 },
    headerRows: { startRow: 1, endRow: 2, source: 'manual' },
  };

  const result = preprocessExtractedDocument(workbookDocument([block]), 'excel');

  assert.ok(result.processedText.includes('| 대상 발전기 > Generation | 대상 발전기 > Fuel | 대상 발전기 > Capacity |'));
});

test('does not import a merge anchor from outside the selected header band', () => {
  const block = table('sheet-1', '범위밖', [
    ['범위 밖 제목', ''],
    ['', '상태'],
    ['P-1', '정상'],
  ], [{ range: 'A1:A2', start: { row: 0, column: 0 }, end: { row: 1, column: 0 } }]);
  block.excelLayout = {
    usedRange: { startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 },
    headerRows: { startRow: 2, endRow: 2, source: 'manual' },
  };

  const result = preprocessExtractedDocument(workbookDocument([block]), 'excel');

  assert.ok(result.processedText.includes('|  | 상태 |'));
  assert.equal(result.processedText.includes('| 범위 밖 제목 | 상태 |'), false);
  assert.ok(result.issues.some((issue) => issue.code === 'COMPLEX_EXCEL_HEADER'));
  assert.ok(result.issues.some((issue) => issue.code === 'EMPTY_EXCEL_HEADER'));
});

test('removes only adjacent duplicate header segments', () => {
  const block = table('sheet-1', '중복', [
    ['Region'],
    ['Status'],
    ['Region'],
    ['정상'],
  ]);
  block.excelLayout = {
    usedRange: { startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 },
    headerRows: { startRow: 1, endRow: 3, source: 'manual' },
  };

  const result = preprocessExtractedDocument(workbookDocument([block]), 'excel');

  assert.ok(result.processedText.includes('| Region > Status > Region |'));
});

test('treats every non-empty row in a manual unmerged header range as authoritative', () => {
  const block = table('sheet-1', '수동다단', [
    ['Scope', '', ''],
    ['ID', 'Status', 'Value'],
    ['P-1', '정상', '10'],
  ]);
  block.excelLayout = {
    usedRange: { startRow: 1, endRow: 3, startColumn: 1, endColumn: 3 },
    headerRows: { startRow: 1, endRow: 2, source: 'manual' },
  };

  const result = preprocessExtractedDocument(workbookDocument([block]), 'excel');

  assert.ok(result.processedText.includes('| Scope > ID | Status | Value |'));
  assert.equal(result.processedText.includes('[머리행] Scope'), false);
  assert.ok(result.issues.some((issue) => issue.code === 'COMPLEX_EXCEL_HEADER'));
});

test('keeps legacy single-row headers byte-for-byte and emits no complex-header warning', () => {
  const block = table('sheet-1', '단일', [
    ['설비', '상태'],
    ['P-1', '정상'],
  ]);
  block.excelLayout = {
    usedRange: { startRow: 1, endRow: 2 },
    headerRows: { startRow: 1, endRow: 1, source: 'detected' },
  };

  const result = preprocessExtractedDocument(workbookDocument([block]), 'excel');

  assert.ok(result.processedText.includes('| 설비 | 상태 |\n| --- | --- |\n| P-1 | 정상 |'));
  assert.equal(result.issues.some((issue) => issue.code === 'COMPLEX_EXCEL_HEADER'), false);
});

test('shows formula text only when the workbook formula setting is enabled', () => {
  const block = table('sheet-1', '계산', [
    ['입력', '합계'],
    ['2', '5'],
    ['3', ''],
  ]);
  block.excelLayout = {
    usedRange: { startRow: 5, endRow: 7, startColumn: 3, endColumn: 4 },
    headerRows: { startRow: 5, endRow: 5, source: 'detected' },
  };
  block.formulaCells = [
    { row: 6, column: 4, formula: '=C6+3', hasStoredResult: true },
    { row: 7, column: 4, formula: '=C7+3', hasStoredResult: false },
  ];
  const valueOnly = workbookDocument([block]);
  const withFormula = {
    ...workbookDocument([block]),
    excelOptions: { formulaOutput: 'value-and-formula' },
  };

  const valueOnlyResult = preprocessExtractedDocument(valueOnly, 'excel');
  const formulaResult = preprocessExtractedDocument(withFormula, 'excel');

  assert.ok(valueOnlyResult.processedText.includes('| 2 | 5 |'));
  assert.equal(valueOnlyResult.processedText.includes('수식:'), false);
  assert.ok(formulaResult.processedText.includes('| 2 | 5 (수식: =C6+3) |'));
  assert.ok(formulaResult.processedText.includes('| 3 | (수식: =C7+3) |'));
  assert.deepEqual(block.rows, [
    ['입력', '합계'],
    ['2', '5'],
    ['3', ''],
  ]);
});

test('formula annotation preserves the stored displayed value whitespace', () => {
  const block = table('sheet-1', '공백수식', [['값'], ['  x  y  ']]);
  block.excelLayout = {
    usedRange: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 1 },
    headerRows: { startRow: 1, endRow: 1, source: 'detected' },
  };
  block.formulaCells = [{
    row: 2, column: 1, formula: '=A1', hasStoredResult: true,
  }];
  const document = {
    ...workbookDocument([block]),
    excelOptions: { formulaOutput: 'value-and-formula' },
  };

  const result = preprocessExtractedDocument(document, 'excel');

  assert.ok(result.processedText.includes('|   x  y   (수식: =A1) |'));
});

test('repeats headers while safely fragmenting a 4,100-character Excel cell once', () => {
  const document = workbookDocument([
    table('sheet-1', '장문', [['ID', '열 이름'], ['ROW-4100', '값'.repeat(4100)]]),
  ]);

  const result = preprocessExtractedDocument(document, 'excel');

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.ok(result.chunks.every((chunk) => chunk.includes('| ID | 열 이름 |\n| --- | --- |')));
  const fragmentChunks = result.chunks.filter((chunk) => chunk.includes('행 분할: ROW-4100'));
  assert.ok(fragmentChunks.length >= 1);
  assert.equal(result.processedText.match(/ROW-4100/g)?.length, fragmentChunks.length);
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

  for (const identifier of ['R-001', 'R-002', 'R-004']) {
    assert.equal(body.match(new RegExp(identifier, 'g'))?.length, 1);
  }
  const longRowDrafts = output.drafts.filter((draft) => draft.body.includes('행 분할: R-003'));
  assert.ok(longRowDrafts.length >= 1);
  assert.equal(body.match(/R-003/g)?.length, longRowDrafts.length);
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

test('prose around markdown tables in flat sheets is preserved in order', () => {
  const result = preprocessByDocType([
    '이 시트는 2026년 상반기 점검 결과이다.',
    '',
    '| 설비 | 상태 |',
    '| --- | --- |',
    '| 급수펌프 | 정상 |',
    '',
    '담당: 김철수 (내선 1234)',
  ].join('\n'), 'excel', { documentName: '점검.xlsx' });

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.some((chunk) => chunk.includes('이 시트는 2026년 상반기 점검 결과이다.')));
  assert.ok(result.chunks.some((chunk) => chunk.includes('| 급수펌프 | 정상 |')));
  assert.ok(result.chunks.some((chunk) => chunk.includes('담당: 김철수 (내선 1234)')));
});

test('a single-cell title row above the header becomes context instead of the column header', () => {
  const document = workbookDocument([
    table('sheet-1', '분기점검', [
      ['2026년 1분기 설비점검 대장', '', ''],
      ['설비', '점검일', '결과'],
      ['급수펌프', '01-15', '정상'],
      ['냉각탑', '02-10', '보수'],
    ]),
  ]);
  const result = preprocessExtractedDocument(document, 'excel');

  assert.equal(result.chunks.length, 1);
  assert.ok(result.chunks[0].includes('[머리행] 2026년 1분기 설비점검 대장'));
  assert.ok(result.chunks[0].includes('| 설비 | 점검일 | 결과 |'));
  assert.equal(result.chunks[0].includes('| 2026년 1분기 설비점검 대장 |'), false);
});

test('data rows after a stray blank row merge into the preceding table with its header', () => {
  const document = workbookDocument([
    table('sheet-1', '점검이력', [
      ['설비', '점검일', '결과'],
      ['급수펌프', '2026-01-15', '정상'],
      ['', '', ''],
      ['냉각탑', '2026-02-10', '보수'],
      ['탈황설비', '2026-03-05', '정상'],
    ]),
  ]);
  const result = preprocessExtractedDocument(document, 'excel');

  assert.equal(result.chunks.length, 1);
  assert.ok(result.chunks[0].includes('| 냉각탑 | 2026-02-10 | 보수 |'));
  assert.equal(result.chunks[0].includes('| 냉각탑 | 2026-02-10 | 보수 |\n| --- |'), false);
  assert.ok(result.issues.some((issue) => issue.code === 'TABLE_CONTINUATION_MERGED'));
  assert.equal(result.issues.some((issue) => issue.code === 'MULTIPLE_TABLES'), false);
});

test('distinct same-width tables with text headers are not merged across blank rows', () => {
  const document = workbookDocument([
    table('sheet-1', '월간점검', [
      ['점검항목', '점검주기'],
      ['냉각탑 팬 진동', '월 1회'],
      ['', ''],
      ['자격구분', '보유인원'],
      ['방사선취급감독자', '3명'],
    ]),
  ]);
  const result = preprocessExtractedDocument(document, 'excel');

  assert.equal(result.chunks.length, 2);
  assert.ok(result.chunks[1].includes('| 자격구분 | 보유인원 |'));
  assert.equal(result.issues.some((issue) => issue.code === 'TABLE_CONTINUATION_MERGED'), false);
});
