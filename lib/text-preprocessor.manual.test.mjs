import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_CHUNK_LIMIT } from './preprocessing/contracts.ts';
import { finalizeChunkDrafts } from './preprocessing/core.ts';
import {
  chunkManualDocument,
  classifyManualLine,
} from './preprocessing/manual-chunker.ts';

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
