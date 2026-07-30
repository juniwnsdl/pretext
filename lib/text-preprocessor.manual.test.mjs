import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_CHUNK_LIMIT } from './preprocessing/contracts.ts';
import { finalizeChunkDrafts } from './preprocessing/core.ts';
import { extractDocxDocument } from './docx-extractor.ts';
import {
  chunkManualDocument,
  classifyManualLine,
} from './preprocessing/manual-chunker.ts';
import { preprocessExtractedDocument } from './text-preprocessor.ts';

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

function documentFromBlocks(fileName, blocks) {
  return {
    version: 1,
    fileName,
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: blocks.map((block, order) => ({ order, headingPath: [], ...block })),
    warnings: [],
  };
}

function finalize(document, output) {
  return finalizeChunkDrafts({ originalLength: 1, ...output });
}

function bodyAfterContext(chunk) {
  return chunk.split('\n').slice(2).join('\n');
}

test('manual sections are not merged and safety text stays with its step', () => {
  const document = textDocument('보일러-운전-매뉴얼.docx', [
    '1) 사전 점검',
    '작업원을 확인한다.',
    '[주의] 보호구를 착용한다.',
    '밸브를 확인한다.',
    '2) 기동',
    'Step 1 기동 버튼을 누른다.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.chunks.length, 2);
  assert.ok(result.chunks[0].includes('[주의] 보호구를 착용한다.'));
  assert.equal(result.chunks[0].includes('2) 기동'), false);
  assert.equal(result.chunks[1].includes('1) 사전 점검'), false);
});

test('classifies supported section labels and imperative numbered lines', () => {
  for (const line of [
    '1. 준비 사항', '1) 준비 사항', '1-1 세부 절차', '가) 점검',
    '① 준비', 'Step 1 준비', '단계 1 준비',
  ]) {
    assert.equal(classifyManualLine(line), 'section', line);
  }
  for (const line of [
    '1. 장비를 확인한다.', '1) 보호구를 착용하십시오.',
    '1-1 전원을 켜세요.', '가) 작업을 시작하시오.',
  ]) {
    assert.equal(classifyManualLine(line), 'step', line);
  }
  assert.equal(classifyManualLine('[경고] 전원을 차단한다.'), 'safety');
});

test('heading-only DOCX blocks attach to following content without flat reclassification', () => {
  const document = documentFromBlocks('설비 매뉴얼.docx', [
    { id: 'h-1', kind: 'heading', text: '1. 준비', level: 1 },
    { id: 'p-1', kind: 'paragraph', text: '1. 장비를 확인한다.' },
  ]);
  const output = chunkManualDocument(document);
  const result = finalize(document, output);

  assert.equal(result.chunks.length, 1);
  assert.match(result.chunks[0], /\[섹션\] 1\. 준비/);
  assert.ok(result.chunks[0].includes('1. 장비를 확인한다.'));
  assert.deepEqual(output.drafts[0].sourceBlockIds, ['h-1', 'p-1']);
});

test('DOCX manual extraction preserves structured headings and list steps with adjacent safety', async () => {
  const intro = `도입 ${'가'.repeat(2700)}`;
  const firstStep = `전원을 확인한다. ${'나'.repeat(1200)}`;
  const nestedStep = `압력을 확인한다. ${'다'.repeat(3720)}`;
  const html = [
    '<h1>기동 절차</h1>',
    '<p>1. 준비 사항</p>',
    `<p>${intro}</p>`,
    '<h2>준비 작업</h2>',
    '<p>[주의] 보호구를 착용한다.</p>',
    `<ol><li>${firstStep}</li><li>밸브를 연다.<ul><li>${nestedStep}</li></ul></li></ol>`,
    '<p>[경고] 압력이 높으면 중단한다.</p>',
    '<h2>종료 절차</h2>',
    '<ul><li>[주의] 장비가 멈춘 후 진행한다.</li><li>전원을 차단한다.</li></ul>',
  ].join('');
  const document = await extractDocxDocument(
    new ArrayBuffer(1),
    '설비-기동.docx',
    async () => ({ value: html, messages: [] }),
  );

  const result = preprocessExtractedDocument(document, 'manual');

  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.issues.some((issue) => issue.code === 'source-block-consumption-mismatch'), false);
  assert.equal(result.chunks.some((chunk) => chunk.includes('[섹션] 기동 절차')), true);
  assert.equal(result.chunks.some((chunk) => chunk.includes('[섹션] 1. 준비 사항')), false);
  assert.equal(result.processedText.includes(`1. ${firstStep}`), true);
  assert.equal(result.processedText.includes('2. 밸브를 연다.'), true);
  assert.equal(result.processedText.includes(`  - ${nestedStep}`), true);
  assert.equal(result.processedText.includes('- [주의]'), false);
  assert.equal(result.processedText.includes('- 전원을 차단한다.'), true);
  assert.equal(
    result.chunks.some((chunk) => chunk.includes('[주의] 보호구를 착용한다.\n1. 전원을 확인한다.')),
    true,
  );
  assert.equal(
    result.chunks.some((chunk) => chunk.includes('  - 압력을 확인한다.') && chunk.includes('[경고] 압력이 높으면 중단한다.')),
    true,
  );
  assert.equal(
    result.chunks.some((chunk) => chunk.includes('[주의] 장비가 멈춘 후 진행한다.\n- 전원을 차단한다.')),
    true,
  );
  assert.equal(
    result.chunks.some((chunk) => /^\[(?:주의|경고)\][^\n]*$/u.test(bodyAfterContext(chunk).trim())),
    false,
  );
});

test('claims a safety block once when its adjacent step is in the next raw block', () => {
  const document = documentFromBlocks('분리된 절차.txt', [
    { id: 'section', kind: 'raw-text', text: '1. 점검' },
    { id: 'safety', kind: 'raw-text', text: '[주의] 보호구를 착용한다.' },
    { id: 'step', kind: 'raw-text', text: '1. 밸브를 확인한다.' },
  ]);
  const output = chunkManualDocument(document);
  const result = finalize(document, output);

  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.chunks[0].includes('[주의] 보호구를 착용한다.\n1. 밸브를 확인한다.'), true);
  assert.deepEqual(output.drafts[0].sourceBlockIds, ['section', 'safety', 'step']);
});

test('preserves indentation and routes raw markdown tables through the table chunker', () => {
  const document = textDocument('점검표.txt', [
    '1. 점검',
    '  1. 들여쓴 작업을 확인한다.',
    '| 항목 | 기준 |',
    '| --- | --- |',
    '| 압력 | 정상 |',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.ok(result.chunks.some((chunk) => chunk.includes('  1. 들여쓴 작업을 확인한다.')));
  assert.ok(result.chunks.some((chunk) => chunk.includes('| 항목 | 기준 |')));
  assert.equal(result.resultStatus, 'ready');
});

test('long sections break only between steps and repeat their exact path', () => {
  const steps = Array.from({ length: 18 }, (_, index) =>
    `${index + 1}. ${`절차 ${index + 1}을 수행한다. `.repeat(45)}`.trim());
  const document = textDocument('긴-절차.txt', ['1. 기동 절차', ...steps].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.ok(result.chunks.every((chunk) => chunk.includes('[섹션] 1. 기동 절차')));
  assert.ok(result.chunks.every((chunk) => /(?:^|\n)\d+\. 절차 \d+을 수행한다\./u.test(chunk)));
});

test('attaches safety immediately after a step backward and preserves each cross-block source once', () => {
  const document = documentFromBlocks('교차-블록.txt', [
    { id: 'heading', kind: 'raw-text', text: '1. 점검' },
    { id: 'step', kind: 'raw-text', text: '1. 밸브를 확인한다.' },
    { id: 'safety', kind: 'raw-text', text: '[주의] 압력이 높으면 중단한다.' },
  ]);
  const output = chunkManualDocument(document);
  const result = finalize(document, output);

  assert.equal(result.resultStatus, 'ready');
  assert.equal(bodyAfterContext(result.chunks[0]), '1. 밸브를 확인한다.\n[주의] 압력이 높으면 중단한다.');
  assert.deepEqual(output.drafts[0].sourceBlockIds, ['heading', 'step', 'safety']);
});

test('attaches safety after an unnumbered instruction backward across source blocks', () => {
  const document = documentFromBlocks('비번호-후행-주의.txt', [
    { id: 'heading', kind: 'raw-text', text: '1. 점검' },
    { id: 'instruction', kind: 'raw-text', text: '장비 상태를 확인합니다.' },
    { id: 'safety', kind: 'raw-text', text: '[주의] 이상이면 중단합니다.' },
  ]);
  const output = chunkManualDocument(document);
  const result = finalize(document, output);

  assert.equal(result.resultStatus, 'ready');
  assert.equal(bodyAfterContext(result.chunks[0]), '장비 상태를 확인합니다.\n[주의] 이상이면 중단합니다.');
  assert.deepEqual(output.drafts[0].sourceBlockIds, ['heading', 'instruction', 'safety']);
  assert.equal(result.chunks.some((chunk) => /^\[주의\][^\n]*$/u.test(bodyAfterContext(chunk).trim())), false);
});

test('attaches leading safety to the next unnumbered instruction', () => {
  const document = textDocument('선행-주의.txt', [
    '1. 점검',
    '[주의] 보호구를 착용한다.',
    '장비 상태를 확인합니다.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.equal(bodyAfterContext(result.chunks[0]), '[주의] 보호구를 착용한다.\n장비 상태를 확인합니다.');
});

test('keeps unpaired safety as reviewable content and frames table-adjacent safety with its table', () => {
  const document = textDocument('고립-주의.txt', [
    '1. 점검',
    '[주의] 다음 절에는 작업 지시가 없다.',
    '2. 기동',
    '[경고] 표를 참조하여 점검한다.',
    '| 항목 | 기준 |',
    '| --- | --- |',
    '| 압력 | 정상 |',
    '[주의] 파일 끝에는 작업 지시가 없다.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'review');
  assert.equal(result.canDownload, true);
  assert.equal(result.issues.filter((entry) => entry.code === 'manual-safety-without-adjacent-instruction').length, 1);
  assert.ok(result.chunks.some((chunk) => chunk.includes('[주의] 다음 절에는 작업 지시가 없다.')));
  const tableChunk = result.chunks.find((chunk) => chunk.includes('| 압력 | 정상 |'));
  assert.ok(tableChunk?.includes('[경고] 표를 참조하여 점검한다.'));
  assert.ok(tableChunk?.includes('[주의] 파일 끝에는 작업 지시가 없다.'));
  assert.equal(result.chunks.some((chunk) => chunk.includes('[BLOCKED')), false);
});

test('keeps a near-limit safety and step pair together before starting the next step', () => {
  const firstStep = `1. ${'가'.repeat(APP_CHUNK_LIMIT - 250)} 한다.`;
  const document = textDocument('한계-주의.txt', [
    '1. 점검',
    '[주의] 보호구를 착용한다.',
    firstStep,
    `2. ${'나'.repeat(300)} 한다.`,
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.length > 1);
  assert.ok(bodyAfterContext(result.chunks[0]).startsWith('[주의] 보호구를 착용한다.\n1. '));
  assert.equal(result.chunks.some((chunk) => /^\[주의\][^\n]*$/u.test(bodyAfterContext(chunk).trim())), false);
});

test('keeps safety immediately after a boundary-sized step out of its own trailing fragment', () => {
  const contextLength = ['[문서] 후행-주의.txt', '[섹션] 1. 점검'].join('\n').length + 1;
  const step = `1. ${'가'.repeat(APP_CHUNK_LIMIT - contextLength - '1.  한다.'.length - 1)} 한다.`;
  const document = textDocument('후행-주의.txt', ['1. 점검', step, '[주의] 압력이 높으면 중단한다.'].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.chunks.some((chunk) => /^\[주의\][^\n]*$/u.test(bodyAfterContext(chunk).trim())), false);
  assert.equal(result.chunks.at(-1)?.includes('한다.\n[주의] 압력이 높으면 중단한다.'), true);
});

test('splits one oversized safety and step unit without leaving safety in its own fragment', () => {
  const step = `1. ${'가'.repeat(APP_CHUNK_LIMIT + 500)} 한다.`;
  const document = textDocument('초과-단계.txt', ['1. 점검', '[주의] 보호구를 착용한다.', step].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.length > 1);
  assert.ok(bodyAfterContext(result.chunks[0]).startsWith('[주의] 보호구를 착용한다.\n1. '));
  assert.equal(result.chunks.map(bodyAfterContext).join(''), `[주의] 보호구를 착용한다.\n${step}`);
});

test('blocks an oversized non-step unit instead of arbitrary splitting', () => {
  const paragraph = '가'.repeat(APP_CHUNK_LIMIT + 1);
  const document = textDocument('초과-문단.txt', paragraph);
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.issues.some((entry) => entry.code === 'manual-non-step-exceeds-limit'), true);
});

test('preserves an oversized non-step unit and its source provenance in blocked output', () => {
  const paragraph = '가'.repeat(APP_CHUNK_LIMIT + 300);
  const document = textDocument('초과-문단-보존.txt', paragraph);
  const output = chunkManualDocument(document);
  const result = finalize(document, output);

  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.chunks.map(bodyAfterContext).join(''), paragraph);
  assert.equal(result.chunks.map(bodyAfterContext).join('').split('가').length - 1, paragraph.length);
  assert.deepEqual(output.drafts[0].sourceBlockIds, ['raw-1']);
  assert.equal(result.issues.some((entry) => entry.code === 'source-block-consumption-mismatch'), false);
});

test('recognizes a numbered known section title ending in 다 before imperative matching', () => {
  assert.equal(classifyManualLine('1. 작업 개요입니다.'), 'section');
  assert.equal(classifyManualLine('1. 전원을 확인한다.'), 'step');
});

test('consecutive numbered noun lines survive as a list instead of vanishing as sections', () => {
  const document = textDocument('절차서.txt', [
    '4. 작업절차',
    '1. 준비사항 점검 목록',
    '2. 공구 및 자재 목록',
    '3. 계기 검교정 확인',
    'Step 1 펌프를 정지한다.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks[0].includes('[섹션] 4. 작업절차'));
  for (const line of ['1. 준비사항 점검 목록', '2. 공구 및 자재 목록', '3. 계기 검교정 확인']) {
    assert.ok(result.chunks.some((chunk) => chunk.includes(line)), line);
  }
});

test('oversized prose with sentence boundaries splits cleanly instead of blocking', () => {
  const sentence = '베어링 메탈 온도가 상승하는 경우 윤활유 공급 압력과 유량을 확인한다. ';
  const document = textDocument('개요.txt', sentence.repeat(Math.ceil((APP_CHUNK_LIMIT + 500) / sentence.length)));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
});

test('a long numbered prose line does not become an unbounded section title', () => {
  const longLine = `1. ${'점검 결과를 기록하고 계통을 복구하며 '.repeat(200)}마무리`;
  const document = textDocument('통짜절차.txt', [longLine, '2. 결과를 보고하시오.'].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
});

test('safety rules under a 안전 수칙 section are content, not orphans', () => {
  const document = textDocument('수칙.txt', [
    '안전 수칙',
    '※ 관리감독자의 승인 없이 임의로 절차를 변경하지 않는다.',
    '종료',
    '1) 작업 구역을 정리하시오.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.some((chunk) => chunk.includes('※ 관리감독자의 승인 없이')));
});
