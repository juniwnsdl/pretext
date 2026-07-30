import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_CHUNK_LIMIT } from './preprocessing/contracts.ts';
import { finalizeChunkDrafts } from './preprocessing/core.ts';
import {
  chunkDelegationManualDocument,
  chunkLawDocument,
  parseLegalHeading,
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

function blockDocument(fileName, blocks) {
  return {
    version: 1,
    fileName,
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: blocks.map((block, order) => ({
      kind: 'paragraph',
      order,
      headingPath: [],
      ...block,
    })),
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

test('successive no-space titled articles split while legal references remain prose', () => {
  const document = textDocument('붙임조문규정.txt', [
    '제1조(목적)본문을 바로 시작한다.',
    '제2조의2(범위)① 첫 범위를 정한다.',
    '제1조에 따른 사항은 본문이다.',
    '제1조의2에 따른 사항도 본문이다.',
    '제3조(보고) 공백 본문을 유지한다.',
    '제4조(삭제)',
  ].join('\n'));
  const result = finalize(document, chunkLawDocument(document));

  assert.equal(result.chunks.length, 4);
  assert.equal(bodyAfterContext(result.chunks[0]), '본문을 바로 시작한다.');
  assert.equal(bodyAfterContext(result.chunks[1]), [
    '① 첫 범위를 정한다.',
    '제1조에 따른 사항은 본문이다.',
    '제1조의2에 따른 사항도 본문이다.',
  ].join('\n'));
  assert.equal(bodyAfterContext(result.chunks[2]), '공백 본문을 유지한다.');
  assert.equal(bodyAfterContext(result.chunks[3]), '');
  assert.equal(parseLegalHeading('제1조에 따른 사항'), null);
  assert.equal(parseLegalHeading('제1조의2에 따른 사항'), null);
});

test('multi-block provenance stays on the first real output for each source block', () => {
  const document = blockDocument('다중블록규정.docx', [
    { id: 'heading-1', kind: 'heading', text: '제1장 총칙', level: 1 },
    { id: 'article-1', text: '제1조(목적)\n첫째 블록 본문' },
    { id: 'article-2', text: '제2조(정의)\n둘째 블록 본문' },
  ]);
  const output = chunkLawDocument(document);
  const first = output.drafts.find((draft) => draft.body.includes('첫째 블록 본문'));
  const second = output.drafts.find((draft) => draft.body.includes('둘째 블록 본문'));

  assert.deepEqual(output.expectedSourceBlockIds, ['heading-1', 'article-1', 'article-2']);
  assert.deepEqual(first?.sourceBlockIds, ['heading-1', 'article-1']);
  assert.deepEqual(second?.sourceBlockIds, ['article-2']);

  const missingSecond = finalizeChunkDrafts({
    originalLength: 1,
    ...output,
    drafts: output.drafts.filter((draft) => !draft.body.includes('둘째 블록 본문')),
  });
  assert.equal(missingSecond.resultStatus, 'blocked');
  assert.equal(
    missingSecond.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'),
    true,
  );

  const duplicatedSecond = finalizeChunkDrafts({
    originalLength: 1,
    ...output,
    drafts: [...output.drafts, { ...second, sourceBlockIds: ['article-2'] }],
  });
  assert.equal(duplicatedSecond.resultStatus, 'blocked');
  assert.equal(
    duplicatedSecond.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'),
    true,
  );
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

test('legal-looking prose remains article body and does not change hierarchy', () => {
  const document = textDocument('문장구분규정.txt', [
    '제1장 총칙',
    '제1조(설명)',
    '제2장 관련 내용은 다음과 같다.',
    '이 문장은 조문 본문이다.',
    '**제1절 적용**',
    '제2조(적용)',
    '적용 범위를 정한다.',
  ].join('\n'));
  const result = finalize(document, chunkLawDocument(document));

  assert.equal(result.processedText.match(/제2장 관련 내용은 다음과 같다\./g)?.length, 1);
  assert.equal(
    result.chunks.some((chunk) =>
      chunk.includes('[위치] 제1장 총칙 > 제1조(설명)') &&
      chunk.includes('제2장 관련 내용은 다음과 같다.')),
    true,
  );
  assert.equal(
    result.chunks.some((chunk) =>
      chunk.includes('[위치] 제1장 총칙 > 제1절 적용 > 제2조(적용)')),
    true,
  );
  assert.equal(result.processedText.includes('[위치] 제2장 관련 내용은 다음과 같다.'), false);
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

test('oversized fallback preserves exact leading indentation, blank lines, and trailing spaces', () => {
  const body = [
    '    첫 줄 들여쓰기  ',
    '',
    '  ' + 'fallback 내용 '.repeat(500) + '  ',
    '끝 줄 공백   ',
  ].join('\n');
  const document = textDocument('공백보존규정.txt', '제1조(공백 보존)\n' + body);
  const output = chunkLawDocument(document);
  const result = finalize(document, output);

  assert.ok(result.chunks.length > 1);
  assert.equal(output.drafts.map((draft) => draft.body).join(''), body);
  assert.equal(result.chunks.map(bodyAfterContext).join(''), body);
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

test('every delegation table region uses row chunking and preserves intervening prose in order', () => {
  const secondRows = Array.from(
    { length: 130 },
    (_, index) => '| T2-' + String(index + 1).padStart(3, '0') + ' | ' + '두 번째 결정 '.repeat(8) + ' |',
  );
  const document = textDocument('다중표위임전결규정.txt', [
    '규정 본문',
    '[위임전결규정 매뉴얼]',
    'A. 일반 공통',
    '| 첫째 업무 | 첫째 결정 |',
    '| --- | --- |',
    '| T1-001 | 팀장 |',
    '두 표 사이 안내 문구',
    '| 둘째 업무 | 둘째 결정 |',
    '| --- | --- |',
    ...secondRows,
    'B. 기획',
    '| 업무 | 결정 |',
    '| --- | --- |',
    '| B-001 | 대표이사 |',
  ].join('\n'));
  const result = finalize(document, chunkDelegationManualDocument(document));
  const secondTableChunks = result.chunks.filter((chunk) => /T2-\d{3}/u.test(chunk));

  assert.ok(secondTableChunks.length > 1);
  assert.equal(
    secondTableChunks.every((chunk) =>
      chunk.includes('| 둘째 업무 | 둘째 결정 |\n| --- | --- |')),
    true,
  );
  assert.equal(result.processedText.match(/두 표 사이 안내 문구/g)?.length, 1);
  assert.ok(
    result.processedText.indexOf('T1-001') <
    result.processedText.indexOf('두 표 사이 안내 문구'),
  );
  assert.ok(
    result.processedText.indexOf('두 표 사이 안내 문구') <
    result.processedText.indexOf('T2-001'),
  );
  assert.equal(result.processedText.match(/T1-001/g)?.length, 1);
  for (let index = 1; index <= 130; index += 1) {
    const rowId = 'T2-' + String(index).padStart(3, '0');
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
