import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  APP_CHUNK_LIMIT,
  MISO_CHUNK_LIMIT,
  MISO_SEPARATOR,
} from './preprocessing/contracts.ts';
import {
  preprocessByDocType,
  preprocessExtractedDocument,
} from './text-preprocessor.ts';

const fixtureUrl = (relativePath) => new URL(`./__fixtures__/${relativePath}`, import.meta.url);

async function textFixture(relativePath) {
  return readFile(fixtureUrl(relativePath), 'utf8');
}

async function jsonFixture(relativePath) {
  return JSON.parse(await textFixture(relativePath));
}

function textDocument(fileName, text) {
  return {
    version: 1,
    fileName,
    sourceFormat: 'txt',
    extractionMethod: 'local-text',
    blocks: [{
      id: 'raw-1',
      kind: 'raw-text',
      order: 0,
      headingPath: [],
      text,
    }],
    warnings: [],
  };
}

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function assertMisoSafe(result, name) {
  assert.equal(result.stats.safeLimitExceededCount, 0, `${name}: 3,800자 초과`);
  assert.equal(result.stats.misoLimitExceededCount, 0, `${name}: 4,000자 초과`);
  assert.equal(result.stats.emptyChunkCount, 0, `${name}: 빈 청크`);
  assert.equal(result.stats.unresolvedSeparatorCollisionCount, 0, `${name}: 구분자 충돌`);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT), name);
  assert.equal(result.processedText.split(MISO_SEPARATOR).length, result.chunks.length, name);
}

function assertExpectationMatrix(result, expectations, name) {
  for (const { value, context } of expectations) {
    assert.equal(occurrences(result.processedText, value), 1, `${name}: ${value}`);
    const matchingChunks = result.chunks.filter((chunk) => chunk.includes(value));
    assert.equal(matchingChunks.length, 1, `${name}: ${value} chunk`);
    for (const expectedContext of context) {
      assert.ok(matchingChunks[0].includes(expectedContext), `${name}: ${value} -> ${expectedContext}`);
    }
  }
}

test('four public preprocessing types preserve their golden document boundaries', async () => {
  const manualText = await textFixture('manual/plant-start-stop.txt');
  const lawText = await textFixture('law/power-company-rule.txt');
  const generalText = await textFixture('general/project-report-with-table.txt');
  const excel = await jsonFixture('excel/two-sheets.json');
  const scenarios = [
    ['manual', textDocument('발전소-기동정지.txt', manualText), 'manual'],
    ['law', textDocument('발전회사-업무규정.txt', lawText), 'law'],
    ['general', textDocument('신사업-진행보고.txt', generalText), 'general'],
    ['excel', excel, 'excel'],
  ];

  const results = Object.fromEntries(scenarios.map(([name, document, docType]) => {
    const result = preprocessExtractedDocument(document, docType);
    assertMisoSafe(result, name);
    return [name, result];
  }));

  assertExpectationMatrix(results.manual, [
    { value: 'MANUAL-PRE-001', context: ['[섹션] 1. 사전점검'] },
    { value: '[주의] 보호구를 착용한다.', context: ['[섹션] 1. 사전점검', 'MANUAL-PRE-001'] },
    { value: '1-1 냉각수 밸브 위치를 확인한다.', context: ['[섹션] 1. 사전점검'] },
    { value: 'MANUAL-START-001', context: ['[섹션] 2. 기동'] },
    { value: '[경고] 현장 책임자의 승인을 확인한다.', context: ['[섹션] 2. 기동', 'MANUAL-START-001'] },
    { value: 'Step 2 터빈 회전수 상승을 확인한다.', context: ['[섹션] 2. 기동'] },
    { value: 'MANUAL-STOP-001', context: ['[섹션] 3. 정지'] },
    { value: '[주의] 정지 후 잔류 압력을 확인한다.', context: ['[섹션] 3. 정지', 'MANUAL-STOP-001'] },
    { value: '단계 2 운전 기록을 저장하시오.', context: ['[섹션] 3. 정지'] },
  ], 'manual');
  assert.equal(
    results.manual.chunks.some((chunk) => chunk.includes('[섹션] 1. 사전점검') && chunk.includes('MANUAL-START-001')),
    false,
  );

  const articleOnePath = '[위치] 제1편 총칙 > 제1장 일반사항 > 제1절 목적 > 제1관 적용 > 제1조(목적)';
  const articleTwoPath = '[위치] 제1편 총칙 > 제1장 일반사항 > 제1절 목적 > 제1관 적용 > 제2조(정의)';
  assertExpectationMatrix(results.law, [
    { value: 'LAW-ARTICLE-001', context: [articleOnePath] },
    { value: '① 발전설비의 안전한 운영 기준을 정한다.', context: [articleOnePath] },
    { value: '1. 운전 책임을 명확히 한다.', context: [articleOnePath] },
    { value: '가. 점검 기록을 보존한다.', context: [articleOnePath] },
    { value: 'LAW-ARTICLE-002', context: [articleTwoPath] },
    { value: 'LAW-ADDENDUM-001', context: ['[위치] 부칙'] },
    { value: 'LAW-APPENDIX-001', context: ['[위치] 별표 1 설비 분류', '| 분류 ID | 설비 | 등급 |'] },
  ], 'law');
  assert.equal(occurrences(results.law.processedText, '| 분류 ID | 설비 | 등급 |'), 1);

  assertExpectationMatrix(results.general, [
    { value: 'GENERAL-OVERVIEW-001', context: ['[섹션] 1. 사업 개요'] },
    { value: 'GENERAL-STATUS-001', context: ['[섹션] 2. 추진 현황'] },
    { value: 'GENERAL-PLAN-001', context: ['[섹션] 3. 향후 계획'] },
    ...[
      'PRJ-001', 'PRJ-002', 'PRJ-003', 'PRJ-004', 'PRJ-005', 'PRJ-006',
      'PRJ-007', 'PRJ-008', 'PRJ-009', 'PRJ-010', 'PRJ-011', 'PRJ-012',
      'PRJ-013', 'PRJ-014', 'PRJ-015', 'PRJ-016', 'PRJ-017', 'PRJ-018',
      'PRJ-019', 'PRJ-020', 'PRJ-021', 'PRJ-022', 'PRJ-023', 'PRJ-024',
    ].map((value) => ({
      value,
      context: ['[섹션] 2. 추진 현황', '| 과제 ID | 담당 | 상태 |'],
    })),
  ], 'general');
  assert.equal(occurrences(results.general.processedText, '| 과제 ID | 담당 | 상태 |'), 1);

  assertExpectationMatrix(results.excel, [
    { value: 'RUN-001', context: ['[시트] 운전현황', '| 설비 ID | 상태 |', '정상'] },
    { value: 'RUN-002', context: ['[시트] 운전현황', '| 설비 ID | 상태 |', '점검'] },
    { value: 'PRESS-001', context: ['[시트] 운전현황', '| 계측 ID | 압력 |', '12.4 MPa'] },
    { value: 'MAINT-001', context: ['[시트] 정비계획', '| 작업 ID | 담당 |', '기계팀'] },
    { value: 'MAINT-002', context: ['[시트] 정비계획', '| 작업 ID | 담당 |', '전기팀'] },
  ], 'excel');
  for (const value of ['정상', '점검', '12.4 MPa', '기계팀', '전기팀']) {
    assert.equal(occurrences(results.excel.processedText, value), 1, `excel value: ${value}`);
  }
  for (const header of ['| 설비 ID | 상태 |', '| 계측 ID | 압력 |', '| 작업 ID | 담당 |']) {
    assert.equal(occurrences(results.excel.processedText, header), 1, `excel header: ${header}`);
  }
});

test('merged workbook fixture safely fragments one 4,100-character cell without value loss', async () => {
  const document = await jsonFixture('excel/merged-multiple-tables-long-cell.json');
  const pipeRow = document.blocks[0].rows.find((row) => row[0] === 'PIPE-001');
  const quoteRow = document.blocks[0].rows.find((row) => row[0] === 'QUOTE-001');
  const longRow = document.blocks[0].rows.find((row) => row[0] === 'LONG-4100');
  assert.deepEqual(pipeRow, ['PIPE-001', '배관|밸브', '']);
  assert.deepEqual(quoteRow, ['QUOTE-001', '별도 인용', '"인용 값"']);
  assert.equal(longRow?.[1].length, 4100);

  const result = preprocessExtractedDocument(document, 'excel');

  assertMisoSafe(result, 'merged-long-cell');
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.includes('| 행 ID | 설명 | 비고 |')));
  const longFragmentChunks = result.chunks.filter((chunk) => chunk.includes('행 분할: LONG-4100'));
  assert.ok(longFragmentChunks.length >= 1);
  assert.equal(occurrences(result.processedText, 'LONG-4100'), longFragmentChunks.length);
  assert.equal(occurrences(result.processedText, '가'), 4100);
  assert.equal(occurrences(result.processedText, 'PIPE-001'), 1);
  assert.equal(occurrences(result.processedText, 'QUOTE-001'), 1);
  assert.equal(occurrences(result.processedText, 'LINE-001'), 1);
  assert.equal(occurrences(result.processedText, 'SECOND-001'), 1);
  assert.ok(result.processedText.includes('배관\\|밸브'));
  assert.ok(result.processedText.includes('"인용 값"'));
  assert.ok(result.processedText.includes('첫째 줄<br>둘째 줄'));
  for (const value of [
    '배관\\|밸브', '별도 인용', '"인용 값"', '첫째 줄<br>둘째 줄',
    '줄바꿈 보존', '장문 안전 분할', '두 번째 표', '빈 행 경계',
  ]) {
    assert.equal(occurrences(result.processedText, value), 1, value);
  }
  assertExpectationMatrix(result, [
    { value: 'PIPE-001', context: ['[시트] 장문점검', '| 행 ID | 설명 | 비고 |', '배관\\|밸브'] },
    { value: 'QUOTE-001', context: ['[시트] 장문점검', '| 행 ID | 설명 | 비고 |', '별도 인용', '"인용 값"'] },
    { value: 'LINE-001', context: ['[시트] 장문점검', '| 행 ID | 설명 | 비고 |', '첫째 줄<br>둘째 줄', '줄바꿈 보존'] },
    { value: 'SECOND-001', context: ['[시트] 장문점검', '| 행 ID | 설명 | 비고 |', '두 번째 표', '빈 행 경계'] },
  ], 'merged workbook');
  for (const rowId of ['PIPE-001', 'QUOTE-001', 'LINE-001', 'SECOND-001']) {
    const matchingChunks = result.chunks.filter((chunk) => chunk.includes(rowId));
    assert.equal(matchingChunks.length, 1, rowId);
    assert.ok(matchingChunks[0].includes('[시트] 장문점검'), rowId);
    assert.ok(matchingChunks[0].includes('| 행 ID | 설명 | 비고 |'), rowId);
  }
  for (const chunk of longFragmentChunks) {
    assert.ok(chunk.includes('[시트] 장문점검'));
    assert.ok(chunk.includes('| 행 ID | 설명 | 비고 |'));
  }
  assert.equal(
    occurrences(result.processedText, '| 행 ID | 설명 | 비고 |'),
    result.chunks.length,
    'long-cell repeated header count',
  );
  assert.ok(result.issues.some((issue) => issue.code === 'MERGED_CELLS'));
  assert.ok(result.issues.some((issue) => issue.code === 'MULTIPLE_TABLES'));
});

test('exact MISO delimiter smoke handles Korean, emoji, mixed line endings, long sections, and source collisions', () => {
  const longSteps = Array.from(
    { length: 24 },
    (_, index) => `${index + 1}. SMOKE-${String(index + 1).padStart(3, '0')} ${'기동 상태를 확인한다. '.repeat(18)}`,
  );
  const source = [
    '1. 사전점검\r\n1. 한글과 이모지 🔧 상태를 확인한다.',
    '[주의] 원문의 @@@ 표시는 데이터로 처리한다.\n2. 보호구를 착용한다.',
    '2. 기동 절차\r\n' + longSteps.join('\r\n'),
  ].join('\n');

  const result = preprocessByDocType(source, 'manual', { documentName: 'MISO-smoke.txt' });
  const splitPieces = result.processedText.split(MISO_SEPARATOR);

  assertMisoSafe(result, 'MISO smoke');
  assert.ok(result.chunks.length > 1, 'long smoke source must produce multiple chunks');
  assert.equal(result.stats.chunkCount, result.chunks.length);
  assert.equal(splitPieces.length, result.chunks.length);
  assert.ok(Math.max(...splitPieces.map((piece) => piece.length)) <= MISO_CHUNK_LIMIT);
  assert.ok(Math.max(...result.chunks.map((chunk) => chunk.length)) <= APP_CHUNK_LIMIT);
  assert.equal(result.chunks.some((chunk) => chunk.includes(MISO_SEPARATOR)), false);
  assert.equal(result.stats.sourceSeparatorCollisionCount, 1);
  assert.equal(occurrences(result.processedText, '＠＠＠'), 1);
  assert.equal(occurrences(result.processedText, '한글과 이모지 🔧 상태를 확인한다.'), 1);
  assert.equal(occurrences(result.processedText, '보호구를 착용한다.'), 1);
  assert.equal(result.processedText.includes('\r'), false);
  for (const marker of [
    'SMOKE-001', 'SMOKE-002', 'SMOKE-003', 'SMOKE-004', 'SMOKE-005', 'SMOKE-006',
    'SMOKE-007', 'SMOKE-008', 'SMOKE-009', 'SMOKE-010', 'SMOKE-011', 'SMOKE-012',
    'SMOKE-013', 'SMOKE-014', 'SMOKE-015', 'SMOKE-016', 'SMOKE-017', 'SMOKE-018',
    'SMOKE-019', 'SMOKE-020', 'SMOKE-021', 'SMOKE-022', 'SMOKE-023', 'SMOKE-024',
  ]) {
    assert.equal(occurrences(result.processedText, marker), 1, marker);
  }
});
