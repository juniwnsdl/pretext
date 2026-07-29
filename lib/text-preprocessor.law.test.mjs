import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_CHUNK_LIMIT } from './preprocessing/contracts.ts';
import { finalizeChunkDrafts } from './preprocessing/core.ts';
import {
  chunkDelegationManualDocument,
  chunkLawDocument,
} from './preprocessing/law-chunker.ts';

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

function finalize(document, output) {
  return finalizeChunkDrafts({
    originalLength: document.blocks[0]?.text?.length ?? 0,
    ...output,
  });
}

function bodyAfterContext(chunk) {
  return chunk.split('\n').slice(2).join('\n');
}

test('short articles remain separate and keep the complete legal path', () => {
  const document = textDocument('발전소안전규정.txt', [
    '제1편 총칙', '제1장 일반', '제1절 목적',
    '제1조(목적)', '이 규정은 안전을 정한다.',
    '제2조(정의)', '용어의 뜻을 정한다.',
  ].join('\n'));
  const result = finalize(document, chunkLawDocument(document));

  assert.equal(result.chunks.length, 2);
  assert.match(result.chunks[0], /\[위치\] 제1편 총칙 > 제1장 일반 > 제1절 목적 > 제1조\(목적\)/);
  assert.match(result.chunks[1], /제2조\(정의\)/);
  assert.equal(
    result.chunks.some((chunk) => chunk.includes('제1조') && chunk.includes('제2조')),
    false,
  );
});

test('heading-only articles are preserved while hierarchy headings do not become chunks', () => {
  const document = textDocument('제목전용규정.txt', [
    '제1장 총칙',
    '제1조(삭제)',
    '제2조(목적)',
    '목적을 정한다.',
    '제2장 보칙',
  ].join('\n'));
  const result = finalize(document, chunkLawDocument(document));

  assert.equal(result.chunks.length, 2);
  assert.match(result.chunks[0], /\[위치\] 제1장 총칙 > 제1조\(삭제\)/);
  assert.match(result.chunks[1], /\[위치\] 제1장 총칙 > 제2조\(목적\)/);
  assert.equal(result.chunks.some((chunk) => chunk.endsWith('제2장 보칙')), false);
});

test('sub-articles and Markdown-wrapped headings are recognized without leaking cleared hierarchy', () => {
  const document = textDocument('보안규정.md', [
    '# 제1편 공통',
    '## 제1장 총칙',
    '**제1절 적용**',
    '### 제1관 범위',
    '#### 제1조의2(적용 범위)',
    '첫 범위를 정한다.',
    '## 제2장 특별 규정',
    '**제2조(특례)**',
    '특례를 정한다.',
  ].join('\n'));
  const result = finalize(document, chunkLawDocument(document));

  assert.equal(result.chunks.length, 2);
  assert.match(
    result.chunks[0],
    /\[위치\] 제1편 공통 > 제1장 총칙 > 제1절 적용 > 제1관 범위 > 제1조의2\(적용 범위\)/,
  );
  assert.match(result.chunks[1], /\[위치\] 제1편 공통 > 제2장 특별 규정 > 제2조\(특례\)/);
  assert.equal(result.chunks[1].includes('제1절 적용'), false);
  assert.equal(result.chunks[1].includes('제1관 범위'), false);
});

test('oversized articles split at 항 then 호 then 목 and repeat the exact complete path', () => {
  const repeated = (label, count = 550) => `${label} ${'세부 내용 '.repeat(count)}`;
  const cases = [
    {
      fileName: '항분할규정.txt',
      article: '제3조(항 분할)',
      lines: [repeated('①'), repeated('②'), repeated('③')],
      continuationPattern: /^[②③]/u,
    },
    {
      fileName: '호분할규정.txt',
      article: '제4조(호 분할)',
      lines: [repeated('1.'), repeated('2.'), repeated('3.')],
      continuationPattern: /^[23]\./u,
    },
    {
      fileName: '목분할규정.txt',
      article: '제5조(목 분할)',
      lines: [repeated('가.'), repeated('나.'), repeated('다.')],
      continuationPattern: /^[나다]\./u,
    },
  ];

  for (const fixture of cases) {
    const document = textDocument(fixture.fileName, [
      '제1편 총칙',
      '제1장 분할 기준',
      fixture.article,
      ...fixture.lines,
    ].join('\n'));
    const result = finalize(document, chunkLawDocument(document));
    const expectedLocation = `[위치] 제1편 총칙 > 제1장 분할 기준 > ${fixture.article}`;

    assert.ok(result.chunks.length > 1, fixture.article);
    assert.equal(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT), true);
    assert.equal(
      result.chunks.every((chunk) =>
        chunk.startsWith(`[문서] ${fixture.fileName}\n${expectedLocation}\n`)),
      true,
      `${fixture.article} context`,
    );
    assert.equal(
      result.chunks.slice(1).every((chunk) =>
        fixture.continuationPattern.test(bodyAfterContext(chunk))),
      true,
      `${fixture.article} boundary`,
    );
    for (const line of fixture.lines) {
      assert.equal(
        result.processedText.split(line.slice(0, 40)).length - 1,
        1,
        `${fixture.article}: ${line.slice(0, 2)}`,
      );
    }
  }
});

test('preamble is preserved and addenda are independent from the preceding hierarchy', () => {
  const document = textDocument('운영규정.txt', [
    '운영규정',
    '2026년 1월 1일 제정',
    '제1장 총칙',
    '제1조(목적)',
    '운영 원칙을 정한다.',
    '부칙',
    '이 규정은 공포한 날부터 시행한다.',
    '부칙(2027. 1. 1.)',
    '이 부칙은 2027년부터 시행한다.',
  ].join('\n'));
  const result = finalize(document, chunkLawDocument(document));

  assert.equal(
    result.chunks.map(bodyAfterContext).join('\n').match(/^운영규정$/gm)?.length,
    1,
  );
  assert.equal(result.processedText.match(/2026년 1월 1일 제정/g)?.length, 1);
  const addenda = result.chunks.filter((chunk) => chunk.includes('[위치] 부칙'));
  assert.equal(addenda.length, 2);
  assert.equal(addenda.every((chunk) => !chunk.includes('제1장 총칙')), true);
  assert.equal(
    result.chunks.some((chunk) =>
      chunk.includes('운영 원칙을 정한다.') &&
      chunk.includes('공포한 날부터 시행한다.')),
    false,
  );
});

test('appendix tables are standalone and repeat the complete header on every split', () => {
  const rows = Array.from(
    { length: 120 },
    (_, index) => `| 설비-${String(index + 1).padStart(3, '0')} | ${'점검 기준 '.repeat(8)} |`,
  );
  const document = textDocument('안전점검규정.md', [
    '제1조(목적)',
    '점검 기준을 정한다.',
    '별표 1 안전점검표',
    '| 설비 | 기준 |',
    '| --- | --- |',
    ...rows,
  ].join('\n'));
  const result = finalize(document, chunkLawDocument(document));
  const appendixChunks = result.chunks.filter((chunk) =>
    chunk.includes('[위치] 별표 1 안전점검표'),
  );

  assert.ok(appendixChunks.length > 1);
  assert.equal(
    appendixChunks.every((chunk) =>
      chunk.includes('| 설비 | 기준 |\n| --- | --- |')),
    true,
  );
  assert.equal(appendixChunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT), true);
  for (let index = 1; index <= 120; index += 1) {
    const rowId = `설비-${String(index).padStart(3, '0')}`;
    assert.equal(result.processedText.split(rowId).length - 1, 1, rowId);
  }
});

test('delegation compatibility keeps regulation and sequential A-J categories independent', () => {
  const document = textDocument('위임전결규정.txt', [
    '전문',
    '제9조(적부확인) 경리부서는 전결권 적용 여부를 점검한다.',
    '제10조(기타) 기본품의에 관한 사항을 정한다.',
    '[위임전결규정 매뉴얼]',
    'A. 일반 공통',
    '| 구분 | 결정 |',
    '| --- | --- |',
    '| 출장 | 해당 팀장 |',
    '페이지 3',
    'B. 기획, 경영관리',
    '| 구분 | 결정 |',
    '| --- | --- |',
    '| 경영계획 | 대표이사 |',
  ].join('\n'));
  const output = chunkDelegationManualDocument(document);

  assert.ok(output);
  const result = finalize(document, output);
  assert.equal(result.chunks.length, 3);
  assert.ok(result.chunks[0].startsWith('전문'));
  assert.ok(result.chunks[1].startsWith('[위임전결규정 매뉴얼]\nA. 일반 공통'));
  assert.ok(result.chunks[2].startsWith('[위임전결규정 매뉴얼]\nB. 기획, 경영관리'));
  assert.equal(result.processedText.includes('페이지 3'), true);
  assert.equal(result.processedText.match(/제9조\(적부확인\)/g)?.length, 1);
});

test('oversized delegation tables use common row chunking with repeated legacy context', () => {
  const tableRows = Array.from(
    { length: 140 },
    (_, index) => `| 업무-${String(index + 1).padStart(3, '0')} | ${'결정 내용 '.repeat(8)} |`,
  );
  const document = textDocument('위임전결규정.txt', [
    '제9조(적부확인) 경리부서는 전결권 적용 여부를 점검한다.',
    '[위임전결규정 매뉴얼]',
    'A. 일반 공통',
    '| 구분 | 결정 |',
    '| --- | --- |',
    ...tableRows,
    'B. 기획, 경영관리',
    '| 구분 | 결정 |',
    '| --- | --- |',
    '| 경영계획 | 대표이사 |',
  ].join('\n'));
  const result = finalize(document, chunkDelegationManualDocument(document));
  const categoryChunks = result.chunks.filter((chunk) => chunk.includes('A. 일반 공통'));

  assert.ok(categoryChunks.length > 1);
  assert.equal(categoryChunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT), true);
  assert.equal(
    categoryChunks.every((chunk) =>
      chunk.startsWith('[위임전결규정 매뉴얼]\nA. 일반 공통')),
    true,
  );
  assert.equal(
    categoryChunks.slice(1).every((chunk) =>
      chunk.includes('| 구분 | 결정 |\n| --- | --- |')),
    true,
  );
  assert.equal(result.processedText.includes('(계속)'), false);
  for (let index = 1; index <= 140; index += 1) {
    const rowId = `업무-${String(index).padStart(3, '0')}`;
    assert.equal(result.processedText.split(rowId).length - 1, 1, rowId);
  }
});

test('delegation compatibility rejects non-sequential category markers', () => {
  const document = textDocument('위임전결규정.txt', [
    '[위임전결규정 매뉴얼]',
    'A. 일반 공통',
    '| 구분 | 결정 |',
    '| --- | --- |',
    '| 출장 | 팀장 |',
    'C. 비연속 분류',
    '| 구분 | 결정 |',
    '| --- | --- |',
    '| 투자 | 대표이사 |',
  ].join('\n'));

  assert.equal(chunkDelegationManualDocument(document), null);
});
