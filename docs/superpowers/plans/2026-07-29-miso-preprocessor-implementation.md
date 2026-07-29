# MISO 문서 전처리기 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 반복 페이지 장식을 안전하게 정리하고 장문 조문의 정확한 제목 문맥을 보존하며, 직원이 파일 전송 범위와 한계를 이해할 수 있는 헤더 사용법 화면을 제공한다.

**Architecture:** 파일 확장자와 처리 위치는 독립 정책 모듈에서 관리해 실제 업로드 흐름과 사용법 안내가 같은 기준을 사용한다. 텍스트 파이프라인은 반복 페이지 장식 정리 후 법령 구조 줄을 제목·인라인 본문으로 파싱하고, 4,000자를 넘는 구조 블록의 본문만 나눈 뒤 정확한 제목을 반복한다. UI는 기존 4단계 작업 흐름을 유지하면서 상위 헤더 탭으로 `전처리`와 `사용법`을 전환한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node `node:test`, Tailwind CSS, Radix 기반 UI 컴포넌트

## Global Constraints

- 페이지 제목은 `문서전처리(MISO RAG 투입용 TXT 제작 도구)`를 그대로 사용한다.
- 페이지 번호와 의미 있는 반복 본문은 삭제하지 않는다.
- 반복 페이지 장식은 첫 등장만 보존하고 이후 반복만 제거한다.
- 조문 본문은 자동 오버랩으로 복제하지 않고, 4,000자를 넘는 조문의 정확한 제목만 반복한다.
- `(계속)` 문자열을 새 청크 문맥으로 사용하지 않는다.
- 모든 파일의 선택 상한은 50MB다.
- TXT·데이터·엑셀 원본은 MISO 파일 업로드 API로 보내지 않는다.
- 최종 TXT를 MISO RAG에 자동 등록하지 않는다.
- 기존 README, PRD 및 unrelated working-tree changes를 구현 커밋에 포함하지 않는다.

---

### Task 1: 파일 처리 정책을 단일 모듈로 통합

**Files:**
- Create: `lib/file-processing-policy.ts`
- Create: `lib/file-processing-policy.test.mjs`
- Modify: `hooks/useFileProcessor.ts`

**Interfaces:**
- Produces: `MAX_FILE_SIZE_BYTES`, `LOCAL_TEXT_EXTENSIONS`, `LOCAL_EXCEL_EXTENSIONS`, `MISO_DOCUMENT_EXTENSIONS`, `MISO_IMAGE_EXTENSIONS`, `FILE_INPUT_ACCEPT`, `getFileProcessingRoute(fileName)`
- Consumes: 브라우저 `File.name`, `File.size`

- [ ] **Step 1: 파일 처리 경로의 실패 테스트 작성**

```js
test('routes only extraction-required files to MISO', () => {
  assert.equal(getFileProcessingRoute('notice.txt'), 'local-text');
  assert.equal(getFileProcessingRoute('data.csv'), 'local-text');
  assert.equal(getFileProcessingRoute('book.ods'), 'local-excel');
  assert.equal(getFileProcessingRoute('contract.docx'), 'miso');
  assert.equal(getFileProcessingRoute('scan.pdf'), 'miso');
  assert.equal(getFileProcessingRoute('policy.hwp'), 'unsupported');
});

test('keeps the common file limit at 50MB', () => {
  assert.equal(MAX_FILE_SIZE_BYTES, 50 * 1024 * 1024);
});
```

- [ ] **Step 2: 테스트가 export 부재로 실패하는지 확인**

Run: `node --no-warnings --experimental-strip-types --test lib/file-processing-policy.test.mjs`
Expected: FAIL because `file-processing-policy.ts` or its exports do not exist.

- [ ] **Step 3: 정책 모듈 최소 구현**

```ts
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const LOCAL_TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'json', 'csv', 'log', 'xml', 'yml', 'yaml'] as const;
export const LOCAL_EXCEL_EXTENSIONS = ['xlsx', 'xls', 'ods'] as const;
export const MISO_DOCUMENT_EXTENSIONS = ['pdf', 'html', 'docx', 'pptx', 'ppt'] as const;
export const MISO_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] as const;
export type FileProcessingRoute = 'local-text' | 'local-excel' | 'miso' | 'unsupported';

export function getFileProcessingRoute(fileName: string): FileProcessingRoute {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (LOCAL_TEXT_EXTENSIONS.includes(extension as never)) return 'local-text';
  if (LOCAL_EXCEL_EXTENSIONS.includes(extension as never)) return 'local-excel';
  if ([...MISO_DOCUMENT_EXTENSIONS, ...MISO_IMAGE_EXTENSIONS].includes(extension as never)) return 'miso';
  return 'unsupported';
}

export const FILE_INPUT_ACCEPT = [
  ...LOCAL_TEXT_EXTENSIONS,
  ...LOCAL_EXCEL_EXTENSIONS,
  ...MISO_DOCUMENT_EXTENSIONS,
  ...MISO_IMAGE_EXTENSIONS,
].map((extension) => `.${extension}`).join(',');
```

- [ ] **Step 4: 훅이 정책 모듈의 경로와 상한을 사용하도록 변경**

`handleFileRead`는 `getFileProcessingRoute(selectedFile.name)` 결과로 분기한다. `unsupported`는 MISO에 보내지 않고 `지원하지 않는 파일 형식입니다.` 오류를 표시한다. CSV는 기존처럼 `excel` 문서 유형을 선택하고, 로컬 엑셀은 Web Worker를 유지한다.

- [ ] **Step 5: 정책 테스트와 기존 테스트 실행**

Run: `pnpm test`
Expected: PASS with all policy and text preprocessor tests.

- [ ] **Step 6: 정책 변경만 커밋**

```bash
git add lib/file-processing-policy.ts lib/file-processing-policy.test.mjs hooks/useFileProcessor.ts
git commit -m "refactor: 파일 처리 경로 정책 통합"
```

### Task 2: 반복 페이지 장식을 보수적으로 정리

**Files:**
- Modify: `lib/text-preprocessor.ts`
- Modify: `lib/text-preprocessor.test.mjs`

**Interfaces:**
- Produces: `removeRepeatedPageDecorations(text: string): string`
- Consumes: 공통 정규화가 끝난 줄 단위 텍스트

- [ ] **Step 1: 반복 머리글 제거와 페이지 번호 보존 실패 테스트 작성**

```js
test('removes repeated page decorations after the first copy and keeps page numbers', () => {
  const page = (number) => [
    `2-${number}`,
    '제2편 계약조건',
    '안양 CHP 개체사업 주기기 구매',
    '제1권 일반사항',
    ...Array.from({ length: 10 }, (_, index) =>
      `상세 본문 ${number}-${index + 1}입니다.`,
    ),
  ].join('\n');
  const text = [page(1), page(2), page(3)].join('\n');
  const result = preprocessByDocType(text, 'general');

  assert.equal(result.processedText.match(/제2편 계약조건/g)?.length, 1);
  assert.equal(result.processedText.match(/안양 CHP 개체사업 주기기 구매/g)?.length, 1);
  assert.equal(result.processedText.match(/제1권 일반사항/g)?.length, 1);
  assert.equal(result.processedText.match(/^2-\d+$/gm)?.length, 3);
});

test('keeps an isolated repeated business line', () => {
  const sections = Array.from({ length: 3 }, (_, sectionIndex) => [
    '동일 안내',
    ...Array.from({ length: 10 }, (_, lineIndex) =>
      `업무 내용 ${sectionIndex + 1}-${lineIndex + 1}입니다.`,
    ),
  ].join('\n'));
  const result = preprocessByDocType(sections.join('\n'), 'general');

  assert.equal(result.processedText.match(/동일 안내/g)?.length, 3);
});
```

- [ ] **Step 2: 현재 코드에서 머리글이 세 번 남아 실패하는지 확인**

Run: `node --no-warnings --experimental-strip-types --test lib/text-preprocessor.test.mjs`
Expected: FAIL because all three page-decoration copies remain.

- [ ] **Step 3: 페이지 번호와 장식 후보 판별기 구현**

```ts
function isPageNumberLine(line: string): boolean {
  const value = line.trim();
  return /^(?:\d+\s*[-–—/]\s*\d+|(?:페이지|page)\s*\d+(?:\s*(?:\/|of)\s*\d+)?)$/i.test(value);
}

function isShortDecorationCandidate(line: string): boolean {
  const value = line.trim();
  if (value.length < 2 || value.length > 80) return false;
  if (isPageNumberLine(value)) return false;
  if (/^\s*\|.*\|\s*$/.test(value)) return false;
  if (/^(?:[-*•]|\d+[.)]|[가-힣][.)]|[①-⑳])\s+/.test(value)) return false;
  return !/[.!?。]$/.test(value);
}
```

비어 있지 않은 줄 인덱스를 기준으로 같은 후보가 3회 이상, 서로 최소 8줄 떨어져 나타나는지 계산한다. 각 반복이 페이지 번호 앞뒤 3줄에 있거나, 동일한 2~3줄 묶음이 떨어진 위치에서 3회 이상 반복될 때만 장식 후보로 확정한다.

- [ ] **Step 4: 첫 등장 보존 필터를 공통 전처리에 연결**

`basePreprocess`에서 특수문자·공백 정규화 후 `removeRepeatedPageDecorations`를 호출한다. `preprocessExcel` 경로에는 호출하지 않는다. 후보별 첫 번째 줄은 유지하고 이후 줄만 제거하며, 제거로 생긴 3개 이상 줄바꿈은 기존 정규화 규칙으로 정리한다.

- [ ] **Step 5: 관련 테스트 실행**

Run: `pnpm test`
Expected: PASS; page numbers and repeated business paragraphs remain.

- [ ] **Step 6: 반복 장식 변경 커밋**

```bash
git add lib/text-preprocessor.ts lib/text-preprocessor.test.mjs
git commit -m "feat: 반복 페이지 장식 정리"
```

### Task 3: 한 줄 조문 파서와 정확한 제목 반복 구현

**Files:**
- Modify: `lib/text-preprocessor.ts`
- Modify: `lib/text-preprocessor.test.mjs`

**Interfaces:**
- Produces: `LegalStructureLine`, `parseLegalStructureLine(line)`, `chunkLegalStructuredText(text, maxChunkSize, splitText)`
- Replaces: `isLegalStructureStart`, `chunkTextAtStructureBoundaries`의 법령·일반 문서 사용 경로

- [ ] **Step 1: MISO 한 줄 조문 회귀 테스트 작성**

```js
test('separates long inline article text from the next article boundary', () => {
  const article9 = '제9조(적부확인) 경리부서는 전결권 적용 여부를 점검한다.';
  const article10 = `제10조(기타) ${'기본품의에 관한 긴 본문을 정한다. '.repeat(20)}`;
  const result = preprocessByDocType(`${article9}\n${article10}`, 'law');

  assert.equal(result.processedText.match(/제9조\(적부확인\)/g)?.length, 1);
  assert.equal(result.processedText.match(/제10조\(기타\)/g)?.length, 1);
});

test('repeats only the exact heading of an oversized article', () => {
  const definitions = Array.from(
    { length: 160 },
    (_, index) => `${index + 1}. 용어 ${index + 1}: ${'상세한 정의 내용 '.repeat(8)}`,
  );
  const text = [
    '제2조(정의) 이 조에서 사용하는 용어의 뜻은 다음과 같다.',
    ...definitions,
    '제9조(적부확인) 경리부서는 적용 여부를 점검한다.',
    `제10조(기타) ${'기본품의에 관한 사항을 정한다. '.repeat(20)}`,
  ].join('\n');

  for (const docType of ['law', 'general']) {
    const result = preprocessByDocType(text, docType);
    const article2Chunks = result.chunks.filter((chunk) =>
      chunk.startsWith('제2조(정의)'),
    );

    assert.ok(article2Chunks.length > 1);
    assert.equal(article2Chunks.every((chunk) => chunk.startsWith('제2조(정의)')), true);
    assert.equal(result.processedText.match(/제9조\(적부확인\)/g)?.length, 1);
    assert.equal(result.processedText.match(/제10조\(기타\)/g)?.length, 1);
    assert.equal(result.processedText.includes('(계속)'), false);
  }
});

test('parses sub-articles, spaced titles, and MISO numbering metadata', () => {
  const text = [
    '제3조의2(관측망의 구축) 관측망을 구축한다.',
    '1.136. [1.1.137.] 제40조 (지체 및 지체상금) 지체상금을 정한다.',
  ].join('\n');
  const result = preprocessByDocType(text, 'law');

  assert.equal(result.processedText.includes('제3조의2(관측망의 구축)'), true);
  assert.equal(result.processedText.includes('1.136. [1.1.137.]'), true);
  assert.equal(result.processedText.includes('제40조 (지체 및 지체상금)'), true);
});
```

- [ ] **Step 2: 현재 구현이 후속 제2조 청크에서 제목을 잃어 실패하는지 확인**

Run: `node --no-warnings --experimental-strip-types --test lib/text-preprocessor.test.mjs`
Expected: FAIL because later chunks start with body list items instead of `제2조(정의)`.

- [ ] **Step 3: 구조 줄 파서 구현**

```ts
type LegalStructureLine = {
  kind: 'part' | 'chapter' | 'section' | 'subsection' | 'article' | 'addendum' | 'appendix' | 'form';
  heading: string;
  inlineBody: string;
  leadingMetadata: string;
};
```

조문 정규식은 줄 전체 길이를 제한하지 않고 `제N조`, `제N조의M`, 선택적 괄호 제목까지만 `heading`으로 캡처한다. 앞의 숫자·점·대괄호 번호는 `leadingMetadata`, 뒤 문장은 `inlineBody`로 분리한다. 편·장·절·관·부칙·별표·별지는 기존 구조 경계를 유지한다.

- [ ] **Step 4: 법령 구조 전용 청커 구현**

파싱 결과가 나오면 이전 블록을 닫고 새 `{ heading, body, leadingMetadata }` 블록을 시작한다. 4,000자 이하 블록은 통째로 병합하고, 초과 블록은 `maxChunkSize - heading.length - 1` 크기로 본문만 나눈다. 각 본문 청크에 같은 `heading`을 붙이고 `leadingMetadata`는 첫 청크에만 붙인다. 어떤 청크에도 `(계속)`을 추가하지 않는다.

- [ ] **Step 5: 법령과 일반 문서 경로 연결**

`chunkLawStructure`는 새 청커를 사용한다. `chunkGeneral`은 파싱 가능한 법령 구조가 하나라도 있으면 새 청커와 표 보존 splitter를 사용하고, 없으면 기존 마크다운 표 청킹을 유지한다.

- [ ] **Step 6: 전체 텍스트 테스트 실행**

Run: `pnpm test`
Expected: PASS; only genuinely oversized articles repeat their exact heading.

- [ ] **Step 7: 조문 파서 변경 커밋**

```bash
git add lib/text-preprocessor.ts lib/text-preprocessor.test.mjs
git commit -m "feat: 장문 조문 제목 문맥 보존"
```

### Task 4: 매뉴얼·위임전결의 페이지 번호와 문맥 접두사 정합성 수정

**Files:**
- Modify: `lib/text-preprocessor.ts`
- Modify: `lib/text-preprocessor.test.mjs`

**Interfaces:**
- Consumes: 기존 `chunkStructuredText`, `chunkDelegationManualDocument`
- Produces: `(계속)` 없는 정확한 매뉴얼·카테고리 접두사와 보존된 페이지 번호

- [ ] **Step 1: 기존 기대값을 새 요구사항의 실패 테스트로 변경**

```js
assert.equal(result.processedText.includes('페이지 3'), true);
assert.equal(categoryChunks.every((chunk) =>
  chunk.startsWith('[위임전결규정 매뉴얼]\nA. 일반 공통'),
), true);
assert.equal(result.processedText.includes('(계속)'), false);
```

```js
test('manual repeats its exact heading without a continuation suffix', () => {
  const text = `1. 설치\n${'설치 상세 안내 문장입니다.\n'.repeat(500)}`;
  const result = preprocessByDocType(text, 'manual');

  assert.ok(result.chunks.length > 1);
  assert.equal(result.chunks.every((chunk) => chunk.startsWith('1. 설치')), true);
  assert.equal(result.processedText.includes('(계속)'), false);
});
```

- [ ] **Step 2: 페이지 번호 제거와 `(계속)` 때문에 실패하는지 확인**

Run: `node --no-warnings --experimental-strip-types --test lib/text-preprocessor.test.mjs`
Expected: FAIL on `페이지 3` preservation and continuation marker assertions.

- [ ] **Step 3: 매뉴얼 접두사 반복과 페이지 번호 보존 구현**

`chunkStructuredText`는 장문 블록의 모든 결과에 `block.heading`을 그대로 사용한다. `chunkDelegationManualDocument`에서 `PAGE_MARKER_PATTERN` 필터를 제거하고, 모든 카테고리 분할 청크에 `categoryPrefix`를 그대로 사용한다. `(계속)` 상수와 계산을 제거한다.

- [ ] **Step 4: 전체 테스트 실행**

Run: `pnpm test`
Expected: PASS with page markers preserved and no continuation suffixes.

- [ ] **Step 5: 매뉴얼 정합성 변경 커밋**

```bash
git add lib/text-preprocessor.ts lib/text-preprocessor.test.mjs
git commit -m "fix: 구조 청크 문맥 표기 통일"
```

### Task 5: 헤더 전처리·사용법 화면 구현

**Files:**
- Create: `components/usage-guide.tsx`
- Modify: `app/page.tsx`
- Consume: `lib/file-processing-policy.ts`

**Interfaces:**
- Produces: `<UsageGuide />`, `headerTab: 'preprocess' | 'usage'`
- Consumes: `FILE_INPUT_ACCEPT`, 파일 처리 정책의 확장자 배열과 `MAX_FILE_SIZE_BYTES`

- [ ] **Step 1: UI 변경 전 타입 검사를 기준선으로 실행**

Run: `pnpm exec tsc --noEmit`
Expected: PASS before UI edits.

- [ ] **Step 2: 직원용 사용법 컴포넌트 구현**

`UsageGuide`는 다음 섹션을 카드와 반응형 표로 렌더링한다.

```tsx
<section aria-labelledby="usage-guide-title" className="space-y-6">
  <Card>{/* 이 도구가 하는 일 + 5단계 사용 순서 */}</Card>
  <Card>{/* 네 가지 문서 종류 */}</Card>
  <Card>{/* 파일별 처리 위치와 MISO 전송 여부 */}</Card>
  <Card>{/* 50MB, 대용량, OCR, HWP, 토큰 차이 */}</Card>
  <Card>{/* 자동 전처리 원칙 */}</Card>
</section>
```

문구는 설계 문서의 `직원용 사용법 화면`을 그대로 평이한 표현으로 옮긴다. 기술 표는 작은 화면에서 가로 스크롤할 수 있게 감싼다.

- [ ] **Step 3: 헤더 1차 탭과 제목 적용**

`Home`에 `headerTab` 상태를 추가하고 제목을 정확히 변경한다.

```tsx
const [headerTab, setHeaderTab] = useState<'preprocess' | 'usage'>('preprocess');

<h1>문서전처리(MISO RAG 투입용 TXT 제작 도구)</h1>
<p>사내 문서를 MISO RAG에 바로 등록할 수 있는 TXT 파일로 정리합니다.</p>
<div role="tablist" aria-label="페이지 메뉴">
  <Button role="tab" aria-selected={headerTab === 'preprocess'}>전처리</Button>
  <Button role="tab" aria-selected={headerTab === 'usage'}>사용법</Button>
</div>
```

기존 `ProgressStepper`, 오류 알림, 4단계 `Tabs`는 `headerTab === 'preprocess'`일 때 렌더링한다. `UsageGuide`는 `headerTab === 'usage'`일 때 렌더링한다. 전환 시 `reset`을 호출하지 않는다.

- [ ] **Step 4: 파일 선택 허용 목록을 공유 정책으로 교체**

`<Input accept={FILE_INPUT_ACCEPT}>`를 사용해 ODS를 추가하고 코드와 안내 확장자 목록의 불일치를 제거한다.

- [ ] **Step 5: 타입 검사와 빌드 실행**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm run build`
Expected: exit 0; pre-existing Next config or baseline-browser warnings may remain but no compilation error.

- [ ] **Step 6: UI 변경 커밋**

```bash
git add components/usage-guide.tsx app/page.tsx
git commit -m "feat: 전처리기 사용법 헤더 화면 추가"
```

### Task 6: 실제 문서 및 브라우저 통합 검증

**Files:**
- Verify: `lib/text-preprocessor.ts`
- Verify: `app/page.tsx`
- Verify: `components/usage-guide.tsx`
- Verify source: `C:/Users/GSENR/Downloads/[전처리] Vol.1 Chapter 2_계약조건_r3_150227 (GE동의서 반영).txt`

**Interfaces:**
- Consumes: `preprocessByDocType`, 로컬 Next.js 페이지
- Produces: 검증 증거와 필요한 경우에만 테스트/구현 보정

- [ ] **Step 1: 전체 자동 검증 실행**

Run: `pnpm test`
Expected: all tests pass with zero failures.

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

Run: `pnpm run build`
Expected: exit 0.

- [ ] **Step 2: 제공 문서 재처리 검사**

기존 TXT의 `@@@`를 제거해 원문을 복원한 뒤 `preprocessByDocType(source, 'general')`를 실행하고 다음을 assertion으로 확인한다.

```js
assert.equal(count(/^제\s*2편 계약조건\s*$/gm), 1);
assert.equal(count(/^안양\s*CHP\s*개체사업 주기기 구매\s*$/gm), 1);
assert.equal(count(/^제\s*1권 일반사항\s*$/gm), 1);
assert.equal(count(/^2-\d+\s*$/gm), 28);
assert.equal(result.processedText.includes('(계속)'), false);
```

제4조 청크에 도입문, `1. 제1권 일반사항`, `7. 제7권 계약 부속서류`, 후속 조문 내용이 함께 남는지도 확인한다.

- [ ] **Step 3: 브라우저에서 헤더와 상태 보존 검증**

개발 서버를 실행하고 다음을 확인한다.

- 제목과 설명이 정확히 보인다.
- `전처리`와 `사용법` 탭이 키보드와 마우스로 전환된다.
- 사용법 표가 파일별 MISO 전송 여부를 정확히 표시한다.
- 50MB, HWP, OCR, 최종 TXT 수동 등록 안내가 보인다.
- 파일을 선택한 뒤 `사용법`으로 이동하고 돌아와도 선택 파일 정보가 남는다.
- 모바일 너비에서 제목과 표가 화면 밖으로 잘리지 않는다.

- [ ] **Step 4: 최종 diff와 작업 트리 범위 검사**

Run: `git diff --check`
Expected: no whitespace errors.

Run: `git status --short`
Expected: unrelated pre-existing README, PRD and environment-generated changes remain untouched; implementation files are committed.

- [ ] **Step 5: 검증 보정이 있었다면 별도 커밋**

```bash
git add <only-files-changed-by-verification>
git commit -m "test: 전처리기 통합 검증 보강"
```
