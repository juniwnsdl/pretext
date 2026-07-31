import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENT_HANDLING_STAGES,
  DOCUMENT_HANDLING_SECURITY_NOTICE,
  TABLE_HANDLING_GUIDANCE,
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

test('explains table structure, comment boundaries, and conservative document hierarchy', () => {
  const guidance = TABLE_HANDLING_GUIDANCE.map((item) => `${item.title} ${item.description}`).join('\n');

  assert.match(guidance, /상위\s*>\s*하위/u);
  assert.match(guidance, /중복.*제거/u);
  assert.match(guidance, /표시값 \+ 수식/u);
  assert.match(guidance, /다시 계산하지/u);
  assert.match(guidance, /DOCX.*HWP.*PDF/u);
  assert.match(guidance, /표 구조를 보존한 경우/u);
  assert.match(guidance, /본문.*작성자.*답글.*멘션.*해결 상태/u);
  assert.match(guidance, /최대 4단계/u);
  assert.match(guidance, /로마 상위 제목.*2단계/u);
  assert.match(guidance, /본문을 보존.*검토 대상/u);
});
