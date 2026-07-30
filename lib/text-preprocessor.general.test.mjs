import test from 'node:test';
import assert from 'node:assert/strict';

import * as textPreprocessor from './text-preprocessor.ts';

const { preprocessByDocType } = textPreprocessor;

function bodyAfterContext(chunk) {
  return chunk.split('\n').slice(2).join('\n');
}

test('general headings and tables are strong boundaries', () => {
  const input = [
    '# 요약', '요약 본문',
    '# 점검 결과',
    '| 설비 | 상태 |', '| --- | --- |', '| 펌프 | 정상 |',
    '# 조치 사항', '후속 조치',
  ].join('\n');
  const result = preprocessByDocType(input, 'general', { documentName: '점검보고서.md' });

  assert.equal(result.chunks.length, 3);
  assert.equal(result.chunks.some((chunk) => chunk.includes('요약 본문') && chunk.includes('점검 결과')), false);
  assert.ok(result.chunks.some((chunk) => chunk.includes('| 설비 | 상태 |')));
  assert.ok(result.chunks.every((chunk) => chunk.length <= 3800));
});

test('only unheaded paragraphs pack together', () => {
  const input = [
    '첫 번째 독립 문단입니다.',
    '',
    '두 번째 독립 문단입니다.',
    '',
    '# 제목이 있는 절',
    '제목 아래 본문입니다.',
    '',
    '# 다음 절',
    '다음 본문입니다.',
  ].join('\n');
  const result = preprocessByDocType(input, 'general');

  assert.equal(result.chunks.length, 3);
  assert.ok(result.chunks[0].includes('첫 번째 독립 문단입니다.\n\n두 번째 독립 문단입니다.'));
  assert.equal(result.chunks.some((chunk) => chunk.includes('제목 아래 본문입니다.') && chunk.includes('다음 본문입니다.')), false);
});

test('Markdown, numbered, chapter, and legal article headings start new sections', () => {
  const input = [
    '# 개요', '개요 본문',
    '1. 점검 결과', '점검 본문',
    '제2장 조치 사항', '조치 본문',
    '제3조(보고)', '보고 본문',
  ].join('\n');
  const result = preprocessByDocType(input, 'general');

  assert.equal(result.chunks.length, 4);
  assert.equal(result.chunks.some((chunk) => chunk.includes('개요 본문') && chunk.includes('점검 본문')), false);
  assert.equal(result.chunks.some((chunk) => chunk.includes('점검 본문') && chunk.includes('조치 본문')), false);
  assert.equal(result.chunks.some((chunk) => chunk.includes('조치 본문') && chunk.includes('보고 본문')), false);
  assert.ok(result.chunks.at(-1)?.includes('[섹션] 제3조(보고)'));
});

test('general documents split successive no-space titled articles but keep legal references in the body', () => {
  const input = [
    '제1조(목적)바로 시작하는 본문',
    '제2조의2(범위)① 범위 본문',
    '제1조에 따른 사항',
    '제1조의2에 따른 사항',
    '제1조(목적)에 따른 사항',
    '제2조(범위)에서 정한 절차',
    '제3조(적용)의 규정을 준용한다.',
    '제4조(근거)에 근거하여 처리한다.',
    '제4조(근거)에근거하여 처리한다.',
    '제5조(의거)에 의거하여 처리한다.',
    '제5조(의거)에의거해 처리한다.',
    '제6조(관련)와 관련하여 처리한다.',
    '제6조(관련)와관련하여 처리한다.',
  ].join('\n');
  const result = preprocessByDocType(input, 'general');

  assert.equal(result.chunks.length, 2);
  assert.equal(bodyAfterContext(result.chunks[0]), '바로 시작하는 본문');
  assert.equal(bodyAfterContext(result.chunks[1]), [
    '① 범위 본문',
    '제1조에 따른 사항',
    '제1조의2에 따른 사항',
    '제1조(목적)에 따른 사항',
    '제2조(범위)에서 정한 절차',
    '제3조(적용)의 규정을 준용한다.',
    '제4조(근거)에 근거하여 처리한다.',
    '제4조(근거)에근거하여 처리한다.',
    '제5조(의거)에 의거하여 처리한다.',
    '제5조(의거)에의거해 처리한다.',
    '제6조(관련)와 관련하여 처리한다.',
    '제6조(관련)와관련하여 처리한다.',
  ].join('\n'));
});

test('quote and list indentation is preserved exactly', () => {
  const input = [
    '# 참고',
    '> 인용문',
    '  > 들여쓴 인용문',
    '  - 첫 항목',
    '    - 하위 항목',
  ].join('\n');
  const result = preprocessByDocType(input, 'general');

  assert.equal(bodyAfterContext(result.chunks[0]), [
    '> 인용문',
    '  > 들여쓴 인용문',
    '  - 첫 항목',
    '    - 하위 항목',
  ].join('\n'));
});

test('general output preserves source order without body overlap', () => {
  const markers = Array.from({ length: 70 }, (_, index) =>
    `MARKER-${String(index + 1).padStart(3, '0')} ${'상세 내용 '.repeat(16)}`);
  const result = preprocessByDocType(markers.join('\n\n'), 'general');
  const bodies = result.chunks.map(bodyAfterContext).join('');

  for (const marker of markers) {
    const id = marker.slice(0, 10);
    assert.equal(bodies.split(id).length - 1, 1, id);
  }
  const positions = markers.map((marker) => bodies.indexOf(marker.slice(0, 10)));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});

test('fixed separator is used for options and supported legacy string calls', () => {
  const input = ['# 첫째', '첫 본문', '# 둘째', '둘째 본문'].join('\n');
  const optionsResult = preprocessByDocType(input, 'general', { documentName: '고정.txt' });
  const legacyDefault = preprocessByDocType(input, 'general');
  const legacyEmpty = preprocessByDocType(input, 'general', '');
  const legacyMiso = preprocessByDocType(input, 'general', '@@@');

  for (const result of [optionsResult, legacyDefault, legacyEmpty, legacyMiso]) {
    assert.equal(result.processedText.split('\n@@@\n').length, 2);
  }
});

test('unsupported legacy separator strings are rejected explicitly', () => {
  const expected = {
    name: 'TypeError',
    message: "Legacy separator must be an empty string or exactly '@@@'.",
  };

  assert.throws(
    () => preprocessByDocType('본문', 'general', '###'),
    expected,
  );
  assert.throws(
    () => textPreprocessor.preprocessText('본문', '###'),
    expected,
  );
});

test('empty general input is a blocked result', () => {
  const result = preprocessByDocType('', 'general');

  assert.deepEqual(result.chunks, []);
  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.canDownload, false);
  assert.equal(result.issues.some((issue) => issue.code === 'empty-result'), true);
});

test('structured raw text uses the same preparation as the flat facade without mutating its caller', () => {
  const source = [
    '공통 머리말',
    'page 1',
    '본문\u00a0A\u0000  ',
    '공통 머리말',
    'page 2',
    '본문 B  ',
  ].join('\r\n');
  const document = {
    version: 1,
    fileName: '정규화.txt',
    sourceFormat: 'txt',
    extractionMethod: 'local-text',
    blocks: [{
      id: 'raw-1', kind: 'raw-text', order: 0, headingPath: [], text: source,
    }],
    warnings: [],
  };
  const before = structuredClone(document);

  const structured = textPreprocessor.preprocessExtractedDocument(document, 'general');
  const flat = preprocessByDocType(source, 'general', { documentName: '정규화.txt' });

  assert.deepEqual(structured.chunks, flat.chunks);
  assert.deepEqual(structured.issues, flat.issues);
  assert.equal(structured.stats.originalLength, source.length);
  assert.equal(flat.stats.originalLength, source.length);
  assert.equal(structured.issues.some((issue) => issue.code === 'page-decoration-removed'), true);
  assert.equal(structured.processedText.includes('\r'), false);
  assert.equal(structured.processedText.includes('\u00a0'), false);
  assert.equal(structured.processedText.includes('\u0000'), false);
  assert.deepEqual(document, before);
});

test('structured heading paragraph list and table content bypass raw-text preparation', () => {
  const untouched = '\u00a0\u0001';
  const document = {
    version: 1,
    fileName: '구조화.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [
      { id: 'heading', kind: 'heading', order: 0, headingPath: [], level: 1, text: `제목${untouched}값` },
      { id: 'paragraph', kind: 'paragraph', order: 1, headingPath: [`제목${untouched}값`], text: `문단${untouched}값` },
      { id: 'list', kind: 'list-item', order: 2, headingPath: [`제목${untouched}값`], depth: 0, ordered: false, text: `목록${untouched}값` },
      { id: 'table', kind: 'table', order: 3, headingPath: [`제목${untouched}값`], rows: [['키', '값'], [`셀${untouched}값`, '정상']] },
    ],
    warnings: [],
  };

  const result = textPreprocessor.preprocessExtractedDocument(document, 'general');

  for (const value of [`제목${untouched}값`, `문단${untouched}값`, `목록${untouched}값`, `셀${untouched}값`]) {
    assert.equal(result.processedText.includes(value), true, value);
  }
});

test('control-only raw text becomes an empty blocked result without a source mismatch', () => {
  const result = textPreprocessor.preprocessExtractedDocument({
    version: 1,
    fileName: '제어문자.txt',
    sourceFormat: 'txt',
    extractionMethod: 'local-text',
    blocks: [{ id: 'raw-1', kind: 'raw-text', order: 0, headingPath: [], text: '\u0000\u0001\r\n\u0002' }],
    warnings: [],
  }, 'general');

  assert.deepEqual(result.chunks, []);
  assert.equal(result.stats.originalLength, 5);
  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.issues.some((issue) => issue.code === 'empty-result'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('structured documents retain per-block provenance through finalization', () => {
  assert.equal(typeof textPreprocessor.preprocessExtractedDocument, 'function');
  const document = {
    version: 1,
    fileName: '구조화보고서.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [
      { id: 'heading-1', kind: 'heading', order: 0, headingPath: [], level: 1, text: '점검 결과' },
      { id: 'paragraph-1', kind: 'paragraph', order: 1, headingPath: ['점검 결과'], text: '펌프를 점검했습니다.' },
      { id: 'table-1', kind: 'table', order: 2, headingPath: ['점검 결과'], rows: [['설비', '상태'], ['펌프', '정상']] },
    ],
    warnings: [],
  };
  const result = textPreprocessor.preprocessExtractedDocument?.(document, 'general');

  assert.ok(result);
  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
  assert.equal(result.processedText.match(/펌프를 점검했습니다\./g)?.length, 1);
  assert.equal(result.processedText.match(/\| 펌프 \| 정상 \|/g)?.length, 1);
});

test('contract-like DOCX removes a repeated article table of contents and packs complete short articles', () => {
  const document = {
    version: 1,
    fileName: '계약조건.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [
      { id: 'title', kind: 'paragraph', order: 0, headingPath: [], text: '계약조건' },
      { id: 'toc-1', kind: 'list-item', order: 1, headingPath: [], depth: 0, ordered: true, text: '제1조 (목적)' },
      { id: 'toc-2', kind: 'list-item', order: 2, headingPath: [], depth: 0, ordered: true, text: '제2조 (정의)' },
      { id: 'toc-3', kind: 'list-item', order: 3, headingPath: [], depth: 0, ordered: true, text: '제3조 (통지)' },
      { id: 'article-1', kind: 'paragraph', order: 4, headingPath: [], text: '제1조 (목적)' },
      { id: 'body-1', kind: 'paragraph', order: 5, headingPath: [], text: '이 계약의 목적을 정한다.' },
      { id: 'article-2', kind: 'paragraph', order: 6, headingPath: [], text: '제2조 (정의)' },
      { id: 'body-2', kind: 'list-item', order: 7, headingPath: [], depth: 0, ordered: true, text: '용어의 뜻을 정한다.' },
      { id: 'article-3', kind: 'paragraph', order: 8, headingPath: [], text: '제3조 (통지)' },
      { id: 'body-3', kind: 'paragraph', order: 9, headingPath: [], text: '모든 통지는 서면으로 한다.' },
    ],
    warnings: [],
  };

  const result = textPreprocessor.preprocessExtractedDocument(document, 'general');

  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.chunks.length, 1);
  const articleChunk = result.chunks.find((chunk) => chunk.includes('이 계약의 목적을 정한다.'));
  assert.ok(articleChunk);
  assert.equal(articleChunk.includes('계약조건'), true);
  assert.equal(articleChunk.includes('제1조 (목적)'), true);
  assert.equal(articleChunk.includes('제2조 (정의)'), true);
  assert.equal(articleChunk.includes('제3조 (통지)'), true);
  assert.equal(result.processedText.match(/제1조 \(목적\)/gu)?.length, 1);
  assert.equal(result.processedText.match(/제2조 \(정의\)/gu)?.length, 1);
  assert.equal(result.processedText.match(/제3조 \(통지\)/gu)?.length, 1);
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('a long contract article repeats its article context on every internal fragment', () => {
  const longBody = Array.from(
    { length: 150 },
    (_, index) => `권리보존문장-${String(index + 1).padStart(3, '0')} 발주자와 계약상대자의 권리 및 의무를 확인한다.`,
  ).join('\n');
  const document = {
    version: 1,
    fileName: '장문계약.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [
      { id: 'article-8', kind: 'paragraph', order: 0, headingPath: [], text: '제8조 (적용법령)' },
      { id: 'body-8', kind: 'paragraph', order: 1, headingPath: [], text: '관련 법령을 준수한다.' },
      { id: 'article-9', kind: 'paragraph', order: 2, headingPath: [], text: '제9조 (권리의 행사와 포기)' },
      { id: 'body-9', kind: 'paragraph', order: 3, headingPath: [], text: longBody },
      { id: 'article-10', kind: 'paragraph', order: 4, headingPath: [], text: '제10조 (지급의 유보 및 상계)' },
      { id: 'body-10', kind: 'paragraph', order: 5, headingPath: [], text: '상계 조건을 정한다.' },
    ],
    warnings: [],
  };

  const result = textPreprocessor.preprocessExtractedDocument(document, 'general');
  const articleNineChunks = result.chunks.filter((chunk) => chunk.includes('권리보존문장-'));

  assert.ok(articleNineChunks.length > 1);
  assert.equal(
    articleNineChunks.every((chunk) => chunk.includes('[조문] 제9조 (권리의 행사와 포기)')),
    true,
  );
  assert.equal(result.chunks.every((chunk) => chunk.length <= 3800), true);
  for (let index = 1; index <= 150; index += 1) {
    const marker = `권리보존문장-${String(index).padStart(3, '0')}`;
    assert.equal(result.processedText.split(marker).length - 1, 1, marker);
  }
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('structured ordered, unordered, and nested list items remain body content', () => {
  const document = {
    version: 1,
    fileName: '준비물.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [
      { id: 'heading', kind: 'heading', order: 0, headingPath: [], level: 1, text: '준비물' },
      { id: 'ordered', kind: 'list-item', order: 1, headingPath: ['준비물'], depth: 0, ordered: true, text: '신분증' },
      { id: 'unordered', kind: 'list-item', order: 2, headingPath: ['준비물'], depth: 0, ordered: false, text: '동의서' },
      { id: 'nested-unordered', kind: 'list-item', order: 3, headingPath: ['준비물'], depth: 1, ordered: false, text: '원본 지참' },
      { id: 'nested-ordered', kind: 'list-item', order: 4, headingPath: ['준비물'], depth: 1, ordered: true, text: '1. 담당자 확인' },
    ],
    warnings: [],
  };
  const result = textPreprocessor.preprocessExtractedDocument(document, 'general');

  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].includes('[섹션] 준비물'), true);
  assert.equal(bodyAfterContext(result.chunks[0]), [
    '1. 신분증',
    '- 동의서',
    '  - 원본 지참',
    '  1. 담당자 확인',
  ].join('\n'));
  for (const text of ['신분증', '동의서', '원본 지참', '담당자 확인']) {
    assert.equal(result.processedText.split(text).length - 1, 1, text);
  }
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('whitespace-only structured blocks do not create provenance mismatches', () => {
  const document = {
    version: 1,
    fileName: '공백포함.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [
      { id: 'heading', kind: 'heading', order: 0, headingPath: [], level: 1, text: '결과' },
      { id: 'whitespace', kind: 'paragraph', order: 1, headingPath: ['결과'], text: '  \n\t' },
      { id: 'meaningful', kind: 'paragraph', order: 2, headingPath: ['결과'], text: '정상 처리되었습니다.' },
    ],
    warnings: [],
  };
  const result = textPreprocessor.preprocessExtractedDocument(document, 'general');

  assert.equal(result.resultStatus, 'ready');
  assert.equal(bodyAfterContext(result.chunks[0]), '정상 처리되었습니다.');
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('an all-whitespace structured document is blocked only as an empty result', () => {
  const document = {
    version: 1,
    fileName: '공백전용.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [
      { id: 'spaces', kind: 'paragraph', order: 0, headingPath: [], text: '   ' },
      { id: 'tabs', kind: 'list-item', order: 1, headingPath: [], depth: 0, ordered: false, text: '\t' },
    ],
    warnings: [],
  };
  const result = textPreprocessor.preprocessExtractedDocument(document, 'general');

  assert.deepEqual(result.chunks, []);
  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.issues.some((issue) => issue.code === 'empty-result'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
});

test('noun titles ending in 요 are headings while circled and hangul markers stay body', () => {
  const input = [
    '1. 개요', '개요 본문입니다.',
    '2. 점검 결과', '① 압력 정상', '② 온도 정상', '가. 세부 확인 완료',
  ].join('\n');
  const result = preprocessByDocType(input, 'general');

  assert.ok(result.chunks.some((chunk) => chunk.includes('[섹션] 1. 개요') && chunk.includes('개요 본문입니다.')));
  const checklistChunk = result.chunks.find((chunk) => chunk.includes('① 압력 정상'));
  assert.ok(checklistChunk?.includes('② 온도 정상'));
  assert.ok(checklistChunk?.includes('가. 세부 확인 완료'));
  assert.equal(result.chunks.some((chunk) => chunk.includes('[섹션] ① 압력 정상')), false);
});

test('a consecutive numbered list stays together instead of fragmenting into headings', () => {
  const input = [
    '점검 결과는 다음과 같다.',
    '1. 급수펌프 정상',
    '2. 순환수펌프 정상',
    '3. 냉각탑 보수 필요',
  ].join('\n');
  const result = preprocessByDocType(input, 'general');

  assert.equal(result.chunks.length, 1);
  assert.ok(result.chunks[0].includes('1. 급수펌프 정상'));
  assert.ok(result.chunks[0].includes('3. 냉각탑 보수 필요'));
});

test('a parent heading directly followed by a subsection folds into the next chunk', () => {
  const input = [
    '# 2. 정비 수행 내용',
    '## 2.1 개요',
    '정비 수행 개요 본문입니다.',
  ].join('\n');
  const result = preprocessByDocType(input, 'general');

  const contextOnly = result.chunks.filter((chunk) => chunk.split('\n').slice(2).join('').trim().length === 0);
  assert.equal(contextOnly.length, 0);
  assert.ok(result.chunks.some((chunk) => chunk.includes('정비 수행 개요 본문입니다.')));
});

test('ordered list items keep their real numbering per depth', () => {
  const result = textPreprocessor.preprocessExtractedDocument({
    version: 1,
    fileName: '목록.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    warnings: [],
    blocks: [
      { id: 'h', kind: 'heading', order: 0, headingPath: [], level: 1, text: '준비물' },
      { id: 'l1', kind: 'list-item', order: 1, headingPath: ['준비물'], depth: 0, ordered: true, text: '신분증' },
      { id: 'l2', kind: 'list-item', order: 2, headingPath: ['준비물'], depth: 0, ordered: true, text: '동의서' },
      { id: 'l2a', kind: 'list-item', order: 3, headingPath: ['준비물'], depth: 1, ordered: true, text: '원본 지참' },
      { id: 'l3', kind: 'list-item', order: 4, headingPath: ['준비물'], depth: 0, ordered: true, text: '보호구' },
    ],
  }, 'general');

  assert.ok(result.processedText.includes('1. 신분증'));
  assert.ok(result.processedText.includes('2. 동의서'));
  assert.ok(result.processedText.includes('  1. 원본 지참'));
  assert.ok(result.processedText.includes('3. 보호구'));
});

test('a large table inside a contract article repeats its header on every continuation chunk', () => {
  const priceRows = Array.from({ length: 90 }, (_, index) => [
    `정비부품-${String(index + 1).padStart(3, '0')} ${'상세규격 '.repeat(6)}`,
    `${(index + 1) * 1000}원`,
  ]);
  const result = textPreprocessor.preprocessExtractedDocument({
    version: 1,
    fileName: '단가계약서.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    warnings: [],
    blocks: [
      { id: 'a1', kind: 'heading', order: 0, headingPath: [], level: 2, text: '제1조 (목적)' },
      { id: 'b1', kind: 'paragraph', order: 1, headingPath: [], text: '이 계약의 목적을 정한다.' },
      { id: 'a2', kind: 'heading', order: 2, headingPath: [], level: 2, text: '제2조 (기간)' },
      { id: 'b2', kind: 'paragraph', order: 3, headingPath: [], text: '계약기간은 1년으로 한다.' },
      { id: 'a3', kind: 'heading', order: 4, headingPath: [], level: 2, text: '제3조 (단가표)' },
      { id: 'b3', kind: 'paragraph', order: 5, headingPath: [], text: '단가는 아래 표에 따른다.' },
      { id: 't3', kind: 'table', order: 6, headingPath: [], rows: [['품목', '단가'], ...priceRows] },
    ],
  }, 'general');

  assert.equal(result.resultStatus, 'ready');
  const tableChunks = result.chunks.filter((chunk) => chunk.includes('[조문] 제3조 (단가표)') && chunk.includes('| 정비부품-'));
  assert.ok(tableChunks.length > 1);
  assert.ok(tableChunks.every((chunk) => chunk.includes('| 품목 | 단가 |\n| --- | --- |')));
  assert.ok(result.chunks.every((chunk) => chunk.length <= 3800));
  const allBody = result.chunks.join('\n');
  assert.ok(allBody.includes('정비부품-001'));
  assert.ok(allBody.includes('정비부품-090'));
});

test('English spec headings from caps list items, paragraphs, and Chapter titles form sections', () => {
  const result = textPreprocessor.preprocessExtractedDocument({
    version: 1,
    fileName: 'Piping-Spec.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    warnings: [],
    blocks: [
      { id: 'p0', kind: 'paragraph', order: 0, headingPath: [], text: 'Chapter 2.' },
      { id: 'l1', kind: 'list-item', order: 1, headingPath: [], depth: 0, ordered: true, text: 'GENERAL' },
      { id: 'p1', kind: 'paragraph', order: 2, headingPath: [], text: 'This specification stipulates design and fabrication of the piping system.' },
      { id: 'l2', kind: 'list-item', order: 3, headingPath: [], depth: 1, ordered: true, text: 'Design' },
      { id: 'l3', kind: 'list-item', order: 4, headingPath: [], depth: 0, ordered: true, text: 'CODES AND STANDARDS' },
      { id: 'p2', kind: 'paragraph', order: 5, headingPath: [], text: 'Design shall comply with the latest ASME B31.1 edition.' },
      { id: 'p3', kind: 'paragraph', order: 6, headingPath: [], text: '2.1 Reference Codes' },
      { id: 'p4', kind: 'paragraph', order: 7, headingPath: [], text: 'The following codes apply to this chapter.' },
    ],
  }, 'general');

  assert.equal(result.resultStatus, 'ready');
  const generalChunk = result.chunks.find((chunk) => chunk.includes('This specification stipulates'));
  assert.ok(generalChunk?.includes('[섹션] GENERAL'));
  assert.ok(generalChunk?.includes('1. Design'));
  const codesChunk = result.chunks.find((chunk) => chunk.includes('ASME B31.1'));
  assert.ok(codesChunk?.includes('[섹션] CODES AND STANDARDS'));
  const refChunk = result.chunks.find((chunk) => chunk.includes('The following codes apply'));
  assert.ok(refChunk?.includes('[섹션] 2.1 Reference Codes'));
});

test('Korean lines with Latin acronyms or paragraph lists are not promoted by English rules', () => {
  const result = textPreprocessor.preprocessExtractedDocument({
    version: 1,
    fileName: '점검보고.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    warnings: [],
    blocks: [
      { id: 'h', kind: 'heading', order: 0, headingPath: [], level: 1, text: '점검 결과' },
      { id: 'p1', kind: 'paragraph', order: 1, headingPath: ['점검 결과'], text: 'MOV 밸브 목록' },
      { id: 'p2', kind: 'paragraph', order: 2, headingPath: ['점검 결과'], text: '1. 급수펌프 점검 완료' },
      { id: 'p3', kind: 'paragraph', order: 3, headingPath: ['점검 결과'], text: '2. 냉각탑 점검 완료' },
      { id: 'l1', kind: 'list-item', order: 4, headingPath: ['점검 결과'], depth: 0, ordered: false, text: 'BFP 예비기 정상' },
    ],
  }, 'general');

  assert.equal(result.chunks.length, 1);
  assert.ok(result.chunks[0].includes('[섹션] 점검 결과'));
  assert.ok(result.chunks[0].includes('MOV 밸브 목록'));
  assert.ok(result.chunks[0].includes('1. 급수펌프 점검 완료'));
  assert.equal(result.chunks.some((chunk) => chunk.includes('[섹션] MOV')), false);
});
