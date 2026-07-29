import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENT_HANDLING_STAGES,
  DOCUMENT_HANDLING_SECURITY_NOTICE,
} from './document-handling-guide.ts';

test('guides employees from the preprocessor to splitting and then assisted processing', () => {
  assert.deepEqual(
    DOCUMENT_HANDLING_STAGES.map(({ step, id }) => [step, id]),
    [
      [1, 'preprocessor'],
      [2, 'split-and-retry'],
      [3, 'assisted-processing'],
    ],
  );

  assert.match(DOCUMENT_HANDLING_STAGES[0].description, /상용 AI를 별도로 사용할 필요가 없습니다/);
  assert.match(DOCUMENT_HANDLING_STAGES[1].description, /나눈 후 다시 이 전처리기로 처리/);
  assert.match(DOCUMENT_HANDLING_STAGES[2].description, /1번과 2번 방법으로 처리하기 어렵거나 실패/);
});

test('warns employees to use only company-approved AI environments', () => {
  assert.match(DOCUMENT_HANDLING_SECURITY_NOTICE, /항상 더 정확하거나 모든 파일을 한 번에 처리/);
  assert.match(DOCUMENT_HANDLING_SECURITY_NOTICE, /회사 보안정책에서 허용한 환경/);
});
