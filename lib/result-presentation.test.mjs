import test from 'node:test';
import assert from 'node:assert/strict';

import { getResultPresentation } from './result-presentation.ts';

test('maps processing status to simple Korean guidance', () => {
  assert.deepEqual(getResultPresentation('ready'), {
    label: 'MISO 등록 가능',
    tone: 'success',
    allowMisoDownload: true,
  });
  assert.deepEqual(getResultPresentation('review'), {
    label: '원문 확인 필요',
    tone: 'warning',
    allowMisoDownload: true,
  });
  assert.deepEqual(getResultPresentation('blocked'), {
    label: '오류 확인 필요',
    tone: 'destructive',
    allowMisoDownload: false,
  });
});
