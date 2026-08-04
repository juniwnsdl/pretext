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
    '개선완료 확인까지 작업 중지', '상승작업 중 권상 및 선회작동 금지',
    '핀 체결 전 운전금지',
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

test('keeps trailing safety with a near-limit unnumbered instruction fragment', () => {
  const fileName = '비번호-후행-주의.txt';
  const contextLength = [`[문서] ${fileName}`, '[섹션] 1. 점검'].join('\n').length + 1;
  const bodyLimit = APP_CHUNK_LIMIT - contextLength;
  const sentence = '장비 상태와 격리 여부를 확인한다. ';
  const instruction = sentence.repeat(Math.floor((bodyLimit - 8) / sentence.length));
  const safety = '※ 이상이면 즉시 작업을 중지한다.';
  const document = textDocument(fileName, ['1. 점검', instruction, safety].join('\n'));
  const result = finalize(document, chunkManualDocument(document));
  const bodies = result.chunks.map(bodyAfterContext);

  assert.equal(result.resultStatus, 'ready');
  assert.equal(bodies.some((body) => body.trimStart().startsWith('※')), false);
  assert.equal(bodies.at(-1)?.includes(`확인한다. \n${safety}`), true);
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

test('bare-number headings and checklist runs from an official safety manual keep their roles', () => {
  const document = textDocument('안전사용-허가제.txt', [
    '1 목적',
    '안전사용 허가제의 목적을 설명합니다.',
    '2 작업범위 / 허가시기',
    '이삿짐 사다리차와 이동식 사다리를 대상으로 합니다.',
    '3 추진절차',
    '1 작업신청',
    '2 사전 안전교육',
    '3 사전점검',
    '4 작업허가',
    '5 작업입회',
    '6 완료보고',
    '4 안전조치 확인 주요내용',
    '이삿짐 사다리차',
    '1 운반구 탑승금지 및 작업장 주위 위험요소 확인 여부',
    '2 기상조건 악화 시 작업금지',
    '3 작업반경 내 사람 통행 및 차량 접근금지 조치 여부',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.ok(result.chunks.some((chunk) => chunk.includes('[섹션] 1 목적')));
  assert.ok(result.chunks.some((chunk) => chunk.includes('[섹션] 2 작업범위 / 허가시기')));
  assert.ok(result.chunks.some((chunk) =>
    chunk.includes('[섹션] 3 추진절차') &&
    chunk.includes('1 작업신청') &&
    chunk.includes('6 완료보고')));
  assert.ok(result.chunks.some((chunk) =>
    chunk.includes('[섹션] 4 안전조치 확인 주요내용') &&
    chunk.includes('1 운반구 탑승금지') &&
    chunk.includes('3 작업반경 내 사람 통행')));
  assert.equal(result.chunks.some((chunk) => chunk.includes('[섹션] 2 기상조건 악화')), false);
});

test('complete dotted raw-text numbering keeps its confirmed parent path without review', () => {
  const document = textDocument('위험성평가-매뉴얼.txt', [
    '2. 안전작업허가제도 운영',
    '운영 원칙을 설명합니다.',
    '2.1 책임과 역할',
    '2.1.1 주관부서장',
    '허가 절차를 관리합니다.',
    '2.1.2 작업자',
    '작업 전 위험요인을 확인합니다.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.equal(result.issues.some((issue) => issue.code === 'manual-deep-numbering-unstructured'), false);
});

test('confirmed dotted parents survive raw block boundaries', () => {
  const document = documentFromBlocks('cross-block.txt', [
    { id: 'parent', kind: 'raw-text', text: '1. Overview' },
    { id: 'child', kind: 'raw-text', text: '1.1 System introduction' },
    { id: 'grandchild', kind: 'raw-text', text: '1.1.1 Scope\nProvides general information.' },
  ]);
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.some((chunk) =>
    chunk.includes('[섹션] 1. Overview > 1.1 System introduction > 1.1.1 Scope')),
  );
  assert.equal(result.processedText.split('1. Overview').length - 1, 1);
  assert.equal(result.processedText.split('1.1 System introduction').length - 1, 1);
  assert.equal(result.processedText.split('1.1.1 Scope').length - 1, 1);
  assert.equal(result.issues.some((issue) => issue.code === 'manual-deep-numbering-unstructured'), false);
});

test('orphan dotted numbering stays in the current body and requests review once', () => {
  const document = textDocument('orphan.txt', [
    '1. Overview',
    '2.1.1 Detail notes',
    'Keep the orphan as body text.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'review');
  assert.equal(result.issues.filter((issue) => issue.code === 'manual-deep-numbering-unstructured').length, 1);
  assert.equal(
    result.issues.find((issue) => issue.code === 'manual-deep-numbering-unstructured')?.message,
    '번호 계층의 직접 부모를 확인할 수 없습니다. 원문은 본문으로 보존했으니 전처리 결과를 확인하세요.',
  );
  assert.ok(result.chunks.some((chunk) =>
    chunk.includes('[섹션] 1. Overview') && chunk.includes('2.1.1 Detail notes')),
  );
  assert.equal(result.processedText.split('2.1.1 Detail notes').length - 1, 1);
});

test('dotless imperative dotted lines remain body text instead of headings', () => {
  const document = textDocument('dotless-imperative.txt', [
    '1. Parent',
    '1.1 Child',
    '1.1.1 수행하십시오',
    'Keep this instruction with its parent.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));
  const bodies = result.chunks.map(bodyAfterContext).join('\n');

  assert.equal(result.resultStatus, 'ready');
  assert.equal(bodies.split('1.1.1 수행하십시오').length - 1, 1);
  assert.equal(result.chunks.some((chunk) => chunk.includes('> 1.1.1 수행하십시오')), false);
});

test('rejected root dotted sentences remain body text instead of fallback sections', () => {
  for (const sentence of ['수행하십시오', '점검한다', '작업합니다']) {
    const document = textDocument('root-sentence.txt', [
      `1. ${sentence}`,
      'Keep this root instruction as body text.',
    ].join('\n'));
    const result = finalize(document, chunkManualDocument(document));
    const bodies = result.chunks.map(bodyAfterContext).join('\n');

    assert.equal(bodies.split(`1. ${sentence}`).length - 1, 1, sentence);
    assert.equal(result.chunks.some((chunk) => chunk.includes(`[섹션] 1. ${sentence}`)), false, sentence);
  }
});

test('dotless Korean sentence endings remain body text instead of headings', () => {
  for (const sentence of ['점검하세요', '작업합니다', '운전됩니다', '절차이다', '확인있습니다', '장비없습니다', '작업한다', '점검하시오']) {
    const document = textDocument('dotless-sentence.txt', [
      '1. Parent',
      '1.1 Child',
      `1.1.1 ${sentence}`,
    ].join('\n'));
    const result = finalize(document, chunkManualDocument(document));
    const bodies = result.chunks.map(bodyAfterContext).join('\n');

    assert.equal(bodies.split(`1.1.1 ${sentence}`).length - 1, 1, sentence);
    assert.equal(result.chunks.some((chunk) => chunk.includes(`> 1.1.1 ${sentence}`)), false, sentence);
  }
});

test('additional dotless instruction endings remain body text at root and deep levels', () => {
  for (const sentence of ['확인했다', '조치할 것', '확인해야 함', '확인해야 한다', '확인 바람', '확인 요망']) {
    const rootDocument = textDocument('root-ending.txt', [`1. ${sentence}`, 'Root body.'].join('\n'));
    const rootResult = finalize(rootDocument, chunkManualDocument(rootDocument));
    const rootBodies = rootResult.chunks.map(bodyAfterContext).join('\n');
    assert.equal(rootBodies.split(`1. ${sentence}`).length - 1, 1, `root ${sentence}`);
    assert.equal(rootResult.chunks.some((chunk) => chunk.includes(`[섹션] 1. ${sentence}`)), false, `root ${sentence}`);

    const deepDocument = textDocument('deep-ending.txt', [
      '1. Parent',
      '1.1 Child',
      `1.1.1 ${sentence}`,
    ].join('\n'));
    const deepResult = finalize(deepDocument, chunkManualDocument(deepDocument));
    const deepBodies = deepResult.chunks.map(bodyAfterContext).join('\n');
    assert.equal(deepBodies.split(`1.1.1 ${sentence}`).length - 1, 1, `deep ${sentence}`);
    assert.equal(deepResult.chunks.some((chunk) => chunk.includes(`> 1.1.1 ${sentence}`)), false, `deep ${sentence}`);
  }
});

test('a noun phrase such as 확인 완료 remains eligible as a dotted heading', () => {
  const document = textDocument('noun-heading.txt', [
    '1. Parent',
    '1.1 확인 완료',
    'Completion details.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.some((chunk) =>
    chunk.includes('[섹션] 1. Parent > 1.1 확인 완료')),
  );
});

test('accepts four dotted levels but does not promote a fifth level', () => {
  const document = textDocument('four-levels.txt', [
    '1. Parent',
    '1.1 Child',
    '1.1.1 Grandchild',
    '1.1.1.1 Great grandchild',
    '1.1.1.1.1 Too deep',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));
  const bodies = result.chunks.map(bodyAfterContext).join('\n');

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.some((chunk) =>
    chunk.includes('1. Parent > 1.1 Child > 1.1.1 Grandchild > 1.1.1.1 Great grandchild')),
  );
  assert.equal(bodies.split('1.1.1.1.1 Too deep').length - 1, 1);
  assert.equal(result.chunks.some((chunk) => chunk.includes('> 1.1.1.1.1 Too deep')), false);
});

test('a dotted sibling replaces stale descendants before creating its child path', () => {
  const document = textDocument('sibling-replacement.txt', [
    '1. Parent',
    '1.1 First child',
    '1.1.1 First grandchild',
    '1.2 Second child',
    '1.2.1 Second grandchild',
    'Second branch body.',
  ].join('\n'));
  const result = finalize(document, chunkManualDocument(document));

  assert.ok(result.chunks.some((chunk) =>
    chunk.includes('[섹션] 1. Parent > 1.2 Second child > 1.2.1 Second grandchild')),
  );
  assert.equal(result.chunks.some((chunk) =>
    chunk.includes('1.1.1 First grandchild > 1.2.1 Second grandchild')), false);
});

test('structured heading paths reset inferred dotted parents', () => {
  const document = documentFromBlocks('structured-reset.txt', [
    { id: 'raw', kind: 'raw-text', text: '1. Parent\n1.1 Child' },
    { id: 'structured', kind: 'paragraph', headingPath: ['Structured section'], text: '1.1.1 Keep as structured body' },
  ]);
  const result = finalize(document, chunkManualDocument(document));
  const bodies = result.chunks.map(bodyAfterContext).join('\n');

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.some((chunk) => chunk.includes('[섹션] Structured section')));
  assert.equal(bodies.split('1.1.1 Keep as structured body').length - 1, 1);
  assert.equal(result.chunks.some((chunk) => chunk.includes('> 1.1.1 Keep as structured body')), false);
});

test('a structured raw block keeps its explicit path while preserving safety, checklist, and table content', () => {
  const document = documentFromBlocks('structured-raw.txt', [
    {
      id: 'structured-raw',
      kind: 'raw-text',
      headingPath: ['Explicit section'],
      text: [
        '1. Child heading',
        '- [ ] 차단기 상태 확인',
        '| 항목 | 기준 |',
        '| --- | --- |',
        '| 압력 | 정상 |',
        '[주의] 표의 기준을 확인한다.',
      ].join('\n'),
    },
  ]);
  const result = finalize(document, chunkManualDocument(document));
  const combined = result.chunks.join('\n');

  assert.equal(result.resultStatus, 'ready');
  assert.ok(result.chunks.every((chunk) => chunk.includes('[섹션] Explicit section')));
  assert.equal(result.chunks.some((chunk) => chunk.includes('[섹션] 1. Child heading')), false);
  assert.equal(combined.split('1. Child heading').length - 1, 1);
  assert.ok(combined.includes('- [ ] 차단기 상태 확인'));
  const tableChunk = result.chunks.find((chunk) => chunk.includes('| 압력 | 정상 |'));
  assert.ok(tableChunk?.includes('[주의] 표의 기준을 확인한다.'));
});

test('Markdown and known-section boundaries reset inferred dotted parents', () => {
  for (const boundary of ['# Markdown boundary', '안전 수칙']) {
    const document = textDocument('raw-boundary-reset.txt', [
      '1. Parent',
      '1.1 Child',
      boundary,
      '1.1.1 Must remain body',
    ].join('\n'));
    const result = finalize(document, chunkManualDocument(document));
    const bodies = result.chunks.map(bodyAfterContext).join('\n');

    assert.equal(result.resultStatus, 'review', boundary);
    assert.equal(bodies.split('1.1.1 Must remain body').length - 1, 1, boundary);
    assert.equal(result.chunks.some((chunk) => chunk.includes('> 1.1.1 Must remain body')), false, boundary);
  }
});
