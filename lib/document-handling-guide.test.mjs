import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DOCUMENT_HANDLING_STAGES,
  DOCUMENT_HANDLING_SECURITY_NOTICE,
  STRUCTURAL_DIFFICULTY_GUIDANCE,
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

test('pairs each structural item with its infographic and coverage note', () => {
  const ids = new Set();

  for (const item of STRUCTURAL_DIFFICULTY_GUIDANCE) {
    for (const field of ['id', 'title', 'summary', 'image', 'coverage']) {
      assert.ok(item[field]?.trim(), `${item.title}: ${field} is required`);
    }

    assert.match(item.image, /^\/guide\/[\w-]+\.png$/u, `${item.title}: unexpected image path`);
    assert.ok(
      existsSync(fileURLToPath(new URL(`../public${item.image}`, import.meta.url))),
      `${item.title}: missing image file public${item.image}`,
    );

    assert.ok(!ids.has(item.id), `duplicate accordion id ${item.id}`);
    ids.add(item.id);
  }
});

test('covers difficulties that span every document type, not just spreadsheets', () => {
  const guidance = STRUCTURAL_DIFFICULTY_GUIDANCE.map(
    (item) => `${item.title} ${item.summary} ${item.coverage}`,
  ).join('\n');

  // 엑셀 전용으로 읽히지 않도록, 일반 직원이 쓰는 다른 문서 형식도 함께 다룬다.
  for (const format of ['PDF', '워드', '엑셀']) {
    assert.match(guidance, new RegExp(format, 'u'));
  }

  assert.match(guidance, /상위\s*>\s*하위/u);
  assert.match(guidance, /중복 제목을 제거/u);
  assert.match(guidance, /표 구조를 보존한 경우/u);
  assert.match(guidance, /표시값 \+ 수식/u);
  assert.match(guidance, /다시 계산하지/u);
  assert.match(guidance, /본문.*작성자.*답글.*멘션.*해결 상태/u);
  assert.match(guidance, /첫 번째만 남기고/u);
});

test('drops the heading-hierarchy item that only described this tool internals', () => {
  assert.equal(
    STRUCTURAL_DIFFICULTY_GUIDANCE.some((item) => item.id === 'heading-hierarchy'),
    false,
  );
});
