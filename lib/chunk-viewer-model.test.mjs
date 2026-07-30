import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterIndexedChunks,
  removeChunkAt,
} from './chunk-viewer-model.ts';

test('duplicate chunk contents keep distinct original indexes after filtering', () => {
  const chunks = Array.from({ length: 23 }, (_, index) => `청크 ${index + 1}`);
  chunks[21] = '같은 내용';
  chunks[22] = '같은 내용';

  assert.deepEqual(filterIndexedChunks(chunks, '같은 내용'), [
    { content: '같은 내용', originalIndex: 21 },
    { content: '같은 내용', originalIndex: 22 },
  ]);
});

test('removing a chunk selects the next available chunk without mutating input', () => {
  const chunks = ['첫째', '삭제', '셋째'];

  assert.deepEqual(removeChunkAt(chunks, 1), {
    chunks: ['첫째', '셋째'],
    selectedIndex: 1,
  });
  assert.deepEqual(chunks, ['첫째', '삭제', '셋째']);
  assert.deepEqual(removeChunkAt(chunks, 2), {
    chunks: ['첫째', '삭제'],
    selectedIndex: 1,
  });
});

test('the final remaining chunk cannot be deleted', () => {
  assert.throws(
    () => removeChunkAt(['유일한 청크'], 0),
    /마지막 청크/u,
  );
});
