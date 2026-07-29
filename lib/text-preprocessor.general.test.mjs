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
