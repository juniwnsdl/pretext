import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyChunkBoundary,
  getTopLevelBoundaryOffsets,
  selectNearestRenderedBoundary,
} from './chunk-boundary.ts';

test('heading stays attached to its first body block', () => {
  const offsets = getTopLevelBoundaryOffsets([
    { type: 'heading', position: { start: { offset: 0 } } },
    { type: 'paragraph', position: { start: { offset: 12 } } },
    { type: 'heading', position: { start: { offset: 100 } } },
    { type: 'paragraph', position: { start: { offset: 112 } } },
    { type: 'paragraph', position: { start: { offset: 200 } } },
  ]);

  assert.deepEqual(offsets, [100, 200]);
});

test('preview selection preserves the exact rendered boundary object', () => {
  const boundaries = [
    { chunkIndex: 0, offset: 100, clientY: 240 },
    { chunkIndex: 0, offset: 200, clientY: 360 },
  ];

  const selected = selectNearestRenderedBoundary(boundaries, 330);

  assert.strictEqual(selected, boundaries[1]);
  assert.equal(selected.offset, 200);
  assert.equal(selected.clientY, 360);
});

test('moving a boundary upward transfers complete markdown blocks', () => {
  const previous = '## 섹션 23\n\n본문 23\n\n## 섹션 24\n\n본문 24';
  const current = '## 섹션 25\n\n본문 25';
  const offset = previous.indexOf('## 섹션 24');

  const result = applyChunkBoundary(
    [previous, current],
    1,
    { chunkIndex: 0, offset },
  );

  assert.deepEqual(result, [
    '## 섹션 23\n\n본문 23',
    '## 섹션 24\n\n본문 24\n\n## 섹션 25\n\n본문 25',
  ]);
});

test('moving a boundary downward transfers complete markdown blocks', () => {
  const previous = '## 섹션 23\n\n본문 23';
  const current = '## 섹션 24\n\n본문 24\n\n## 섹션 25\n\n본문 25';
  const offset = current.indexOf('## 섹션 25');

  const result = applyChunkBoundary(
    [previous, current],
    1,
    { chunkIndex: 1, offset },
  );

  assert.deepEqual(result, [
    '## 섹션 23\n\n본문 23\n\n## 섹션 24\n\n본문 24',
    '## 섹션 25\n\n본문 25',
  ]);
});

test('a boundary move never leaves an empty chunk', () => {
  const chunks = ['첫 번째 청크', '두 번째 청크'];

  assert.equal(
    applyChunkBoundary(chunks, 1, { chunkIndex: 0, offset: 0 }),
    null,
  );
  assert.equal(
    applyChunkBoundary(chunks, 1, { chunkIndex: 1, offset: chunks[1].length }),
    null,
  );
});
