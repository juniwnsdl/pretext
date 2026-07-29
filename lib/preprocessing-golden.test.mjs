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

  const precheck = results.manual.chunks.find((chunk) => chunk.includes('[섹션] 1. 사전점검'));
  const startup = results.manual.chunks.find((chunk) => chunk.includes('[섹션] 2. 기동'));
  const shutdown = results.manual.chunks.find((chunk) => chunk.includes('[섹션] 3. 정지'));
  assert.ok(precheck?.includes('MANUAL-PRE-001'));
  assert.ok(precheck?.includes('[주의] 보호구를 착용한다.'));
  assert.equal(precheck?.includes('MANUAL-START-001'), false);
  assert.ok(startup?.includes('MANUAL-START-001'));
  assert.ok(startup?.includes('[경고] 현장 책임자의 승인을 확인한다.'));
  assert.ok(shutdown?.includes('MANUAL-STOP-001'));
  for (const marker of ['MANUAL-PRE-001', 'MANUAL-START-001', 'MANUAL-STOP-001']) {
    assert.equal(occurrences(results.manual.processedText, marker), 1, marker);
  }

  const articleOne = results.law.chunks.find((chunk) => chunk.includes('제1조(목적)'));
  const articleTwo = results.law.chunks.find((chunk) => chunk.includes('제2조(정의)'));
  assert.ok(articleOne?.includes('[위치] 제1편 총칙 > 제1장 일반사항 > 제1절 목적 > 제1관 적용 > 제1조(목적)'));
  assert.ok(articleOne?.includes('LAW-ARTICLE-001'));
  assert.ok(articleOne?.includes('① 발전설비의 안전한 운영 기준을 정한다.'));
  assert.ok(articleOne?.includes('1. 운전 책임을 명확히 한다.'));
  assert.ok(articleOne?.includes('가. 점검 기록을 보존한다.'));
  assert.ok(articleTwo?.includes('LAW-ARTICLE-002'));
  assert.ok(results.law.chunks.some((chunk) => chunk.includes('[위치] 부칙')));
  assert.ok(results.law.chunks.some((chunk) => chunk.includes('[위치] 별표 1 설비 분류')));
  for (const marker of ['LAW-ARTICLE-001', 'LAW-ARTICLE-002', 'LAW-ADDENDUM-001', 'LAW-APPENDIX-001']) {
    assert.equal(occurrences(results.law.processedText, marker), 1, marker);
  }

  for (const heading of ['1. 사업 개요', '2. 추진 현황', '3. 향후 계획']) {
    assert.ok(results.general.chunks.some((chunk) => chunk.includes(`[섹션] ${heading}`)), heading);
  }
  assert.ok(results.general.chunks.some((chunk) => chunk.includes('| 과제 ID | 담당 | 상태 |')));
  for (const marker of ['GENERAL-OVERVIEW-001', 'GENERAL-STATUS-001', 'GENERAL-PLAN-001', 'PRJ-001', 'PRJ-024']) {
    assert.equal(occurrences(results.general.processedText, marker), 1, marker);
  }

  const operationChunks = results.excel.chunks.filter((chunk) => chunk.includes('[시트] 운전현황'));
  const maintenanceChunks = results.excel.chunks.filter((chunk) => chunk.includes('[시트] 정비계획'));
  assert.ok(operationChunks.length >= 2);
  assert.ok(maintenanceChunks.length >= 1);
  assert.equal(operationChunks.some((chunk) => chunk.includes('MAINT-001')), false);
  assert.equal(maintenanceChunks.some((chunk) => chunk.includes('RUN-001')), false);
  assert.ok(operationChunks.some((chunk) => chunk.includes('| 설비 ID | 상태 |')));
  assert.ok(maintenanceChunks.some((chunk) => chunk.includes('| 작업 ID | 담당 |')));
  for (const marker of ['RUN-001', 'RUN-002', 'PRESS-001', 'MAINT-001', 'MAINT-002']) {
    assert.equal(occurrences(results.excel.processedText, marker), 1, marker);
  }
});

test('merged workbook fixture safely fragments one 4,100-character cell without value loss', async () => {
  const document = await jsonFixture('excel/merged-multiple-tables-long-cell.json');
  const longCell = '가'.repeat(4100);
  const tokenRow = document.blocks[0].rows.find((row) => row.includes('__LONG_CELL_4100__'));
  assert.ok(tokenRow, 'fixture long-cell token');
  tokenRow[tokenRow.indexOf('__LONG_CELL_4100__')] = longCell;

  const result = preprocessExtractedDocument(document, 'excel');

  assertMisoSafe(result, 'merged-long-cell');
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.includes('| 행 ID | 설명 | 비고 |')));
  assert.equal(occurrences(result.processedText, 'LONG-4100'), 1);
  assert.equal(occurrences(result.processedText, '가'), 4100);
  assert.equal(occurrences(result.processedText, 'PIPE-001'), 1);
  assert.ok(result.processedText.includes('배관\\|밸브'));
  assert.ok(result.processedText.includes('"인용 값"'));
  assert.ok(result.processedText.includes('첫째 줄<br>둘째 줄'));
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
  assert.equal(splitPieces.length, result.chunks.length);
  assert.ok(Math.max(...splitPieces.map((piece) => piece.length)) <= MISO_CHUNK_LIMIT);
  assert.ok(Math.max(...result.chunks.map((chunk) => chunk.length)) <= APP_CHUNK_LIMIT);
  assert.equal(result.chunks.some((chunk) => chunk.includes(MISO_SEPARATOR)), false);
  assert.equal(result.stats.sourceSeparatorCollisionCount, 1);
  assert.ok(result.processedText.includes('＠＠＠'));
  assert.ok(result.processedText.includes('🔧'));
});
