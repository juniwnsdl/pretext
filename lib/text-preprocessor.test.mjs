import test from 'node:test';
import assert from 'node:assert/strict';

import * as textPreprocessor from './text-preprocessor.ts';
import { preprocessByDocType } from './text-preprocessor.ts';

test('legacy and unknown document types normalize to the new contract', () => {
  assert.equal(textPreprocessor.normalizeDocType?.('research_paper'), 'manual');
  assert.equal(textPreprocessor.normalizeDocType?.('other'), 'general');
  assert.equal(textPreprocessor.normalizeDocType?.('unexpected'), 'general');
});

test('general preserves repeated business paragraphs', () => {
  const result = preprocessByDocType('동일 안내\n\n동일 안내', 'general');

  assert.equal(result.processedText.match(/동일 안내/g)?.length, 2);
});

test('common cleanup preserves meaningful punctuation from the source', () => {
  const result = preprocessByDocType('필독!!! 중요 공지입니다.', 'general');

  assert.equal(result.processedText, '필독!!! 중요 공지입니다.');
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
  assert.ok(sectionChunk.startsWith('제1절 적용 범위'));
});

test('manual starts a new chunk at a manual section instead of inside its steps', () => {
  const installBody = '설치 안내 문장입니다.\n'.repeat(220);
  const runBody = '1. 실행 버튼을 누릅니다.\n'.repeat(180);
  const text = `1. 설치\n${installBody}\n2. 실행\n${runBody}`;

  const result = preprocessByDocType(text, 'manual');

  assert.ok(result.chunks.some((chunk) => chunk.startsWith('2. 실행')));
  assert.equal(result.chunks.some((chunk) => chunk.startsWith('1. 실행 버튼을 누릅니다.')), false);
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
    assert.equal(result.processedText.includes('페이지 3'), false);
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
  for (let index = 1; index <= 140; index += 1) {
    const rowId = `업무-${String(index).padStart(3, '0')}`;
    assert.equal(result.processedText.split(rowId).length - 1, 1, rowId);
  }
});

test('law uses long article lines as boundaries without repeating their text', () => {
  const article1 =
    '제1조(목적) 이 법은 대기오염으로 인한 국민건강이나 환경에 관한 위해(危害)를 예방하고 대기환경을 적정하고 지속가능하게 관리·보전하여 모든 국민이 건강하고 쾌적한 환경에서 생활할 수 있게 하는 것을 목적으로 한다.';
  const article2 = `제2조(정의) ${'이 법에서 사용하는 용어의 뜻과 개정 이력을 정한다. '.repeat(8)}`.trim();
  const definitions = Array.from(
    { length: 90 },
    (_, index) => `${index + 1}. 정의 항목 ${index + 1}: ${'세부 설명 '.repeat(12)}`,
  );
  const subArticle =
    '제3조의2(환경위성 관측망의 구축·운영 등) 관측망을 구축하고 관련 정보를 수집할 수 있다.';
  const text = [article1, article2, ...definitions, subArticle].join('\n\n');

  const result = preprocessByDocType(text, 'law');

  assert.equal(result.processedText.split(article1).length - 1, 1);
  assert.equal(result.processedText.includes(`${article1} (계속)`), false);
  assert.ok(result.chunks.some((chunk) => chunk.startsWith(article2)));
  assert.ok(result.chunks.some((chunk) => chunk.startsWith(subArticle)));
});
