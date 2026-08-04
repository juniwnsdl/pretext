import test from 'node:test';
import assert from 'node:assert/strict';

import * as textPreprocessor from './text-preprocessor.ts';
import { preprocessByDocType } from './text-preprocessor.ts';
import { chunkDelegationManualDocument } from './preprocessing/law-chunker.ts';

function bodyAfterContext(chunk) {
  return chunk.split('\n').slice(2).join('\n');
}

test('legacy and unknown document types normalize to the new contract', () => {
  assert.equal(textPreprocessor.normalizeDocType?.('research_paper'), 'manual');
  assert.equal(textPreprocessor.normalizeDocType?.('other'), 'general');
  assert.equal(textPreprocessor.normalizeDocType?.('unexpected'), 'general');
});

test('general preserves repeated business paragraphs', () => {
  const result = preprocessByDocType('동일 안내\n\n동일 안내', 'general');

  assert.equal(result.processedText.match(/동일 안내/g)?.length, 2);
});

test('repeated page decorations keep the first copy while page number lines are dropped', () => {
  const page = (number) => [
    `2-${number}`,
    '제2편 계약조건',
    '안양 CHP 개체사업 주기기 구매',
    '제1권 일반사항',
    ...Array.from(
      { length: 10 },
      (_, index) => `상세 본문 ${number}-${index + 1}입니다.`,
    ),
  ].join('\n');
  const result = preprocessByDocType(
    [page(1), page(2), page(3)].join('\n'),
    'general',
  );

  assert.equal(result.processedText.match(/제2편 계약조건/g)?.length, 1);
  assert.equal(result.processedText.match(/안양 CHP 개체사업 주기기 구매/g)?.length, 1);
  assert.equal(result.processedText.match(/제1권 일반사항/g)?.length, 1);
  assert.equal(result.processedText.match(/^2-\d+$/gm), null);
});

test('an isolated repeated business line is not treated as a page decoration', () => {
  const sections = Array.from({ length: 3 }, (_, sectionIndex) => [
    '동일 안내',
    ...Array.from(
      { length: 10 },
      (_, lineIndex) => `업무 내용 ${sectionIndex + 1}-${lineIndex + 1}입니다.`,
    ),
  ].join('\n'));
  const result = preprocessByDocType(sections.join('\n'), 'general');

  assert.equal(result.processedText.match(/동일 안내/g)?.length, 3);
});

test('common cleanup preserves meaningful punctuation from the source', () => {
  const result = preprocessByDocType('필독!!! 중요 공지입니다.', 'general');

  assert.equal(bodyAfterContext(result.chunks[0]), '필독!!! 중요 공지입니다.');
});

test('law keeps a section heading attached when a large chapter is split', () => {
  const chapterBody = '장 설명 '.repeat(250);
  const sectionBody = '절 설명 '.repeat(650);
  const articleBody = '조 설명 '.repeat(50);
  const text = [
    '제1장 총칙',
    chapterBody,
    '제1절 적용 범위',
    sectionBody,
    '제1조 목적',
    articleBody,
  ].join('\n');

  const result = preprocessByDocType(text, 'law');
  const sectionChunk = result.chunks.find((chunk) => chunk.includes(sectionBody.slice(0, 40)));

  assert.ok(sectionChunk, '절 본문이 포함된 청크가 있어야 합니다.');
  assert.ok(sectionChunk.includes('[위치] 제1장 총칙 > 제1절 적용 범위'));
});

test('manual starts a new chunk at a manual section instead of inside its steps', () => {
  const installBody = '설치 안내 문장입니다.\n'.repeat(220);
  const runBody = '1. 실행 버튼을 누릅니다.\n'.repeat(180);
  const text = `1. 설치\n${installBody}\n2. 실행\n${runBody}`;

  const result = preprocessByDocType(text, 'manual');

  assert.ok(result.chunks.some((chunk) => chunk.includes('[섹션] 2. 실행')));
  assert.equal(result.chunks.some((chunk) =>
    bodyAfterContext(chunk).startsWith('1. 실행 버튼을 누릅니다.') &&
    !chunk.includes('[섹션] 2. 실행')),
  false);
});

test('general does not duplicate source text through automatic overlap', () => {
  const text = `${'가'.repeat(3900)}\n\n${'나'.repeat(300)}`;

  const result = preprocessByDocType(text, 'general');
  const copiedCharacters = result.chunks.join('').match(/가/g)?.length ?? 0;

  assert.equal(copiedCharacters, 3900);
});

test('general keeps a legal article introduction and its list in the same chunk', () => {
  const previousArticle = `제3조(계약의 발효일 및 효력)\n\n${'이전 조항 내용'.repeat(460)}`;
  const contractDocuments = [
    '제4조(계약문서)',
    '',
    '① 계약서는 발주자와 계약상대자 사이의 계약 전체를 구성한다. 계약서는 다음과 같이 구성된다.',
    '',
    ...Array.from({ length: 24 }, (_, index) => `${index + 1}. 계약문서 구성 항목 ${index + 1}`),
    '',
    '② 계약문서 사이에 불일치가 있는 경우 정해진 순위에 따른다.',
  ].join('\n');
  const text = `${previousArticle}\n\n${contractDocuments}`;

  const result = preprocessByDocType(text, 'general');
  const articleChunk = result.chunks.find((chunk) => chunk.includes('제4조(계약문서)'));

  assert.ok(articleChunk, '제4조가 포함된 청크가 있어야 합니다.');
  assert.ok(articleChunk.includes('1. 계약문서 구성 항목 1'));
  assert.ok(articleChunk.includes('24. 계약문서 구성 항목 24'));
  assert.ok(articleChunk.includes('② 계약문서 사이에 불일치가 있는 경우'));
});

test('delegation manual separates the regulation and each lettered category', () => {
  const text = [
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
  ].join('\n');

  for (const docType of ['law', 'manual', 'general']) {
    const result = preprocessByDocType(text, docType);

    assert.equal(result.chunks.length, 3, `${docType} 청크 수`);
    assert.ok(result.chunks[0].startsWith('전문'));
    assert.ok(result.chunks[1].startsWith('[위임전결규정 매뉴얼]\nA. 일반 공통'));
    assert.ok(result.chunks[2].startsWith('[위임전결규정 매뉴얼]\nB. 기획, 경영관리'));
    assert.equal(result.processedText.includes('페이지 3'), true);
    assert.equal(result.processedText.match(/제9조\(적부확인\)/g)?.length, 1);
  }
});

test('oversized delegation category splits by table rows with its context', () => {
  const tableRows = Array.from(
    { length: 140 },
    (_, index) => `| 업무-${String(index + 1).padStart(3, '0')} | ${'결정 내용 '.repeat(8)} |`,
  );
  const text = [
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
  ].join('\n');

  const result = preprocessByDocType(text, 'law');
  const categoryChunks = result.chunks.filter((chunk) =>
    chunk.includes('A. 일반 공통'),
  );

  assert.ok(categoryChunks.length > 1);
  assert.equal(categoryChunks.every((chunk) => chunk.length <= 4000), true);
  assert.equal(
    categoryChunks.every((chunk) =>
      chunk.startsWith('[위임전결규정 매뉴얼]\nA. 일반 공통'),
    ),
    true,
  );
  assert.equal(
    categoryChunks.slice(1).every((chunk) =>
      chunk.includes('| 구분 | 결정 |\n| --- | --- |'),
    ),
    true,
  );
  assert.equal(result.processedText.includes('(계속)'), false);
  for (let index = 1; index <= 140; index += 1) {
    const rowId = `업무-${String(index).padStart(3, '0')}`;
    assert.equal(result.processedText.split(rowId).length - 1, 1, rowId);
  }
});

test('manual repeats its exact heading without a continuation suffix', () => {
  const text = `1. 설치\n${'설치 상세 안내 문장입니다.\n'.repeat(500)}`;
  const result = preprocessByDocType(text, 'manual');

  assert.ok(result.chunks.length > 1);
  assert.equal(result.chunks.every((chunk) => chunk.includes('[섹션] 1. 설치')), true);
  assert.equal(result.processedText.includes('(계속)'), false);
});

test('a long inline article starts its own block instead of extending the previous article', () => {
  const article9 = '제9조(적부확인) 경리부서는 전결권 적용 여부를 점검한다.';
  const article10 = `제10조(기타) ${'기본품의에 관한 긴 본문을 정한다. '.repeat(20)}`;
  const result = preprocessByDocType(`${article9}\n${article10}`, 'law');

  assert.equal(result.processedText.match(/제9조\(적부확인\)/g)?.length, 1);
  assert.equal(result.processedText.match(/제10조\(기타\)/g)?.length, 1);
});

test('only an oversized article repeats its exact heading in law and general documents', () => {
  const definitions = Array.from(
    { length: 160 },
    (_, index) => `${index + 1}. 용어 ${index + 1}: ${'상세한 정의 내용 '.repeat(8)}`,
  );
  const text = [
    '제2조(정의) 이 조에서 사용하는 용어의 뜻은 다음과 같다.',
    ...definitions,
    '제9조(적부확인) 경리부서는 적용 여부를 점검한다.',
    `제10조(기타) ${'기본품의에 관한 사항을 정한다. '.repeat(20)}`,
  ].join('\n');

  for (const docType of ['law', 'general']) {
    const result = preprocessByDocType(text, docType);
    const article2Chunks = result.chunks.filter((chunk) =>
      chunk.includes(`${docType === 'law' ? '[위치]' : '[섹션]'} 제2조(정의)`),
    );

    assert.ok(article2Chunks.length > 1, `${docType} 제2조 분할`);
    assert.equal(
      article2Chunks.every((chunk) =>
        chunk.includes(`${docType === 'law' ? '[위치]' : '[섹션]'} 제2조(정의)`)),
      true,
    );
    assert.equal(result.processedText.match(/제9조\(적부확인\)/g)?.length, 1);
    assert.equal(result.processedText.match(/제10조\(기타\)/g)?.length, 1);
    assert.equal(result.processedText.includes('(계속)'), false);
  }
});

test('sub-articles and MISO numbering metadata keep a clean repeatable heading', () => {
  const body = Array.from(
    { length: 120 },
    (_, index) => `${index + 1}. ${'지체상금 세부 내용 '.repeat(10)}`,
  );
  const text = [
    '제3조의2(관측망의 구축) 관측망을 구축한다.',
    '1.136. [1.1.137.] 제40조 (지체 및 지체상금) 지체상금을 정한다.',
    ...body,
  ].join('\n');
  const result = preprocessByDocType(text, 'law');
  const article40Chunks = result.chunks.filter((chunk) =>
    chunk.includes('제40조 (지체 및 지체상금)'),
  );

  assert.equal(result.processedText.match(/제3조의2\(관측망의 구축\)/g)?.length, 1);
  assert.ok(article40Chunks.length > 1);
  assert.equal(result.processedText.match(/1\.136\. \[1\.1\.137\.\]/g)?.length, 1);
  assert.equal(
    article40Chunks.slice(1).every((chunk) =>
      chunk.includes('[위치] 제40조 (지체 및 지체상금)'),
    ),
    true,
  );
});

test('preprocessText remains the two-argument compatible general entry point', () => {
  const input = ['# 첫째', '첫 본문', '# 둘째', '둘째 본문'].join('\n');
  const result = textPreprocessor.preprocessText(input, '@@@');

  assert.equal(result.chunks.length, 2);
  assert.equal(result.processedText.includes('\n@@@\n'), true);
  assert.equal(result.processedText.includes('\n\n@@@\n\n'), false);
});

test('structured delegation detection remains available for the compatible façade route', () => {
  const document = {
    version: 1,
    fileName: '위임전결규정.txt',
    sourceFormat: 'txt',
    extractionMethod: 'local-text',
    blocks: [{
      id: 'raw-1',
      kind: 'raw-text',
      order: 0,
      headingPath: [],
      text: [
        '규정 본문',
        '[위임전결규정 매뉴얼]',
        'A. 일반 공통',
        '| 구분 | 결정 |',
        '| --- | --- |',
        '| 출장 | 팀장 |',
        'B. 기획',
        '| 구분 | 결정 |',
        '| --- | --- |',
        '| 계획 | 대표이사 |',
      ].join('\n'),
    }],
    warnings: [],
  };

  const output = chunkDelegationManualDocument(document);

  assert.ok(output);
  assert.deepEqual(
    output.drafts.map((draft) => draft.body.split('\n').slice(0, 2).join('\n')),
    [
      '규정 본문',
      '[위임전결규정 매뉴얼]\nA. 일반 공통',
      '[위임전결규정 매뉴얼]\nB. 기획',
    ],
  );
});
