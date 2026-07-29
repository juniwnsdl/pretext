# MISO Structure-Aware Preprocessing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MISO의 `@@@` 구분자와 4,000자 제한에 맞춰 모든 결과를 3,800자 이하의 구조 보존 청크로 만들고, Excel·TXT/CSV·DOCX의 로컬 추출 품질과 현장 사용자의 결과 판별 기능을 개선한다.

**Architecture:** 기존 `preprocessByDocType()` 공개 진입점은 유지하되, 내부를 공통 계약·안전 검증·표·법령·매뉴얼·일반·Excel 청커로 분리한다. 파일 추출기는 공통 `ExtractedDocument`를 만들고, 네 유형 청커는 `ChunkDraft`를 만든 뒤 오직 공통 finalizer만 길이·구분자·빈 결과·본문 소비를 검증하고 MISO TXT를 직렬화한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Web Worker, SheetJS CE 0.20.3 공식 tarball, Mammoth.js 1.12.0, `TextDecoder`, `@xmldom/xmldom` 0.8.13.

## Global Constraints

- MISO 구분자는 정확히 `@@@`, 직렬화 joiner는 정확히 `\n@@@\n`이다.
- MISO 최대 길이는 4,000자이고 앱의 최종 청크 안전 상한은 문맥을 포함해 3,800자다.
- 서로 다른 조문, 매뉴얼 절, 명시적 일반 문서 제목, Excel 시트와 표를 길이 채우기 목적으로 합치지 않는다.
- 긴 구조만 법령 항→호→목, 매뉴얼 단계, 표 행, 일반 문단→문장→공백→문자 순으로 나눈다.
- 본문 오버랩은 사용하지 않고 문서명·제목 경로·시트명·표 헤더만 반복한다.
- 페이지 경계 근거가 없는 반복 문구를 삭제하지 않는다. 선행 들여쓰기와 `�` 문자를 보존해 품질 경고 근거를 남긴다.
- 국가법령정보 API, PDF.js 교체, Docling, Unstructured, 별도 Python 서비스, 임베딩 기반 의미 청킹은 구현하지 않는다.
- PDF·PPT·이미지는 현재 MISO 추출 경로를 유지한다. DOCX만 Mammoth 로컬 우선, 실패 시 MISO fallback을 사용한다.
- 기존 `PreprocessResult.processedText`, `chunks`, `stats.originalLength`, `stats.processedLength`, `stats.chunkCount` 필드는 하위 호환을 위해 유지한다.
- 사용자가 추출 텍스트나 청크를 편집하면 구조화 원본을 조용히 재사용하지 않고 일반 텍스트로 전환해 재검증한다.
- Mammoth HTML은 화면에 주입하지 않고 지원 요소의 텍스트와 구조만 순회한다.
- 기존 사용자 변경인 `.gitignore`, `README.md`, `next-env.d.ts`, `제품 요구사항 정의서 (PRD).md`는 수정하거나 스테이징하지 않는다.
- 새 Node 테스트는 현재 스크립트가 찾을 수 있도록 `lib/*.test.mjs`에 둔다.

---

## File Structure

### 새 파일

- `lib/preprocessing/contracts.ts`: MISO 상수, 추출 문서, 블록, 청크, 경고, 통계 계약
- `lib/preprocessing/core.ts`: 안전 정규화, 보존 분할, finalizer, MISO 직렬화, 수동 편집 재검증
- `lib/preprocessing/table-chunker.ts`: 공통 표 파싱·이스케이프·행 분할·헤더 반복
- `lib/preprocessing/law-chunker.ts`: 편·장·절·관·조·항·호·목·부칙·별표 처리
- `lib/preprocessing/manual-chunker.ts`: 제목·단계·안전 문구를 보존하는 매뉴얼 처리
- `lib/preprocessing/general-chunker.ts`: 제목·문단·목록·표를 보존하는 일반 처리
- `lib/preprocessing/excel-chunker.ts`: 구조화 Workbook과 레거시 표 텍스트 처리
- `lib/text-file-decoder.ts`: BOM, UTF-8, EUC-KR 디코딩과 품질 경고
- `lib/excel-workbook-extractor.ts`: SheetJS Workbook→`ExtractedDocument`
- `lib/docx-extractor.ts`: Mammoth HTML→`ExtractedDocument`
- `lib/miso-file-extractor.ts`: 기존 두 단계 MISO 추출 client와 DOCX fallback 조정
- `lib/result-presentation.ts`: 결과 상태·다운로드 가능 여부의 한국어 표시 규칙
- `components/preprocess-result-summary.tsx`: 결과 상태, 통계, 경고 요약 UI
- `lib/*.test.mjs`: 각 책임별 Node 단위 테스트와 회귀 테스트

### 수정 파일

- `lib/text-preprocessor.ts`: 하위 호환 façade와 유형 라우팅만 유지
- `lib/file-processing-policy.ts`, `lib/file-processing-policy.test.mjs`: `local-docx` 경로
- `workers/file.worker.ts`: 구조화 Excel Worker 어댑터
- `hooks/useFileProcessor.ts`: 구조화 추출, 인코딩 선택, 결과·경고·수동 편집 재검증
- `app/api/preprocess/route.ts`: 구조화 문서 요청과 고정 MISO 계약
- `app/page.tsx`: 고정 구분자 안내, 인코딩 검토, 결과 상태, 두 다운로드
- `components/chunk-viewer-modal.tsx`, `components/chunk-flow-viewer.tsx`: 길이 경고와 편집 재검증 연결
- `components/usage-guide.tsx`: 3,800/4,000자와 DOCX 처리 안내
- `package.json`, `pnpm-lock.yaml`: SheetJS 교체와 Mammoth/XML DOM 의존성

---

### Task 1: 공통 문서·청크 계약과 MISO 안전 계층

**Files:**
- Create: `lib/preprocessing/contracts.ts`
- Create: `lib/preprocessing/core.ts`
- Create: `lib/text-preprocessor.core.test.mjs`

**Interfaces:**
- Produces: `ExtractedDocument`, `DocumentBlock`, `ChunkDraft`, `ChunkingOutput`, `PreprocessIssue`, `PreprocessResult`
- Produces: `prepareSourceText()`, `splitTextPreservingSeparators()`, `finalizeChunkDrafts()`, `revalidateEditedChunks()`, `serializeMisoChunks()`
- Consumes: no later-task interfaces

- [ ] **Step 1: Write failing contract and preservation tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_CHUNK_LIMIT,
  MISO_SEPARATOR,
} from './preprocessing/contracts.ts';
import {
  finalizeChunkDrafts,
  prepareSourceText,
  revalidateEditedChunks,
} from './preprocessing/core.ts';

test('MISO output uses the fixed separator and stays within 3,800 characters', () => {
  const result = finalizeChunkDrafts({
    originalLength: 4200,
    expectedSourceBlockIds: ['p1'],
    drafts: [{
    body: `원문 @@@ ${'단어 '.repeat(1500).trim()}`,
      contextLines: ['[문서] 안전절차서'],
      sourceBlockIds: ['p1'],
      warnings: [],
    }],
  });

  assert.equal(MISO_SEPARATOR, '@@@');
  assert.ok(result.chunks.every((chunk) => chunk.length <= APP_CHUNK_LIMIT));
  assert.equal(result.processedText.includes('\n@@@\n'), true);
  assert.equal(result.processedText.includes('＠＠＠'), true);
  assert.equal(result.stats.sourceSeparatorCollisionCount, 1);
});

test('normalization preserves indentation and repeated business content', () => {
  const source = [
    '주의 사항', '  - 전원을 차단한다', '',
    '주의 사항', '  - 전원을 차단한다', '',
    '주의 사항', '  - 전원을 차단한다',
  ].join('\n');
  const prepared = prepareSourceText(source);

  assert.equal(prepared.text.match(/주의 사항/g)?.length, 3);
  assert.equal(prepared.text.match(/^  - 전원을 차단한다$/gm)?.length, 3);
});

test('manual edits with an empty or oversized chunk are blocked', () => {
  const result = revalidateEditedChunks(['정상', '', '가'.repeat(3801)], 3805);
  assert.equal(result.resultStatus, 'blocked');
  assert.equal(result.canDownload, false);
  assert.equal(result.stats.emptyChunkCount, 1);
  assert.equal(result.stats.safeLimitExceededCount, 1);
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.core.test.mjs
```

Expected: FAIL because `lib/preprocessing/contracts.ts` and `core.ts` do not exist.

- [ ] **Step 3: Define the shared contracts**

Create exact constants and backward-compatible result fields:

```ts
export const APP_CHUNK_LIMIT = 3800;
export const MISO_CHUNK_LIMIT = 4000;
export const MISO_SEPARATOR = '@@@';
export const MISO_JOINER = '\n@@@\n';

export type ResultStatus = 'ready' | 'review' | 'blocked';
export type IssueSeverity = 'warning' | 'error';

export interface PreprocessIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  count?: number;
  locations?: string[];
}

export interface DocumentBlock {
  id: string;
  kind: 'raw-text' | 'heading' | 'paragraph' | 'list-item' | 'table';
  order: number;
  headingPath: string[];
  text?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  depth?: number;
  ordered?: boolean;
  rows?: string[][];
  sheetName?: string;
  tableId?: string;
  merges?: Array<{
    range: string;
    start: { row: number; column: number };
    end: { row: number; column: number };
  }>;
}

export interface ExtractedDocument {
  version: 1;
  fileName: string;
  sourceFormat: string;
  extractionMethod: 'local-text' | 'local-excel' | 'local-docx' | 'miso' | 'user-edited';
  blocks: DocumentBlock[];
  warnings: PreprocessIssue[];
}

export interface ChunkDraft {
  body: string;
  contextLines: string[];
  sourceBlockIds: string[];
  warnings: PreprocessIssue[];
}

export interface ChunkingOutput {
  drafts: ChunkDraft[];
  expectedSourceBlockIds: string[];
  warnings: PreprocessIssue[];
}

export interface PreprocessResult {
  processedText: string;
  chunks: string[];
  stats: {
    originalLength: number;
    processedLength: number;
    chunkCount: number;
    longestChunkLength: number;
    safeLimitExceededCount: number;
    misoLimitExceededCount: number;
    sourceSeparatorCollisionCount: number;
    unresolvedSeparatorCollisionCount: number;
    emptyChunkCount: number;
  };
  issues: PreprocessIssue[];
  resultStatus: ResultStatus;
  canDownload: boolean;
}
```

- [ ] **Step 4: Implement the single finalization path**

`prepareSourceText()` must normalize CRLF to LF, remove control characters except LF/TAB, convert NBSP-like spaces, keep `�`, trim trailing whitespace, preserve leading indentation, and remove repeated decorations only when at least two occurrences are within three non-empty lines of a page-number line. `splitTextPreservingSeparators()` must try `\n\n`, `\n`, sentence endings, spaces, and finally Unicode-safe character slices while restoring the separator.

`finalizeChunkDrafts()` must render `contextLines + body`, replace every literal `@@@` with `＠＠＠`, split oversized bodies while repeating context, validate draft-level source IDs before final splitting, serialize with `MISO_JOINER`, and derive status as follows:

```ts
const resultStatus: ResultStatus = issues.some((issue) => issue.severity === 'error')
  ? 'blocked'
  : issues.length > 0
    ? 'review'
    : 'ready';
const canDownload = resultStatus !== 'blocked';
```

An empty result, empty chunk, unresolved delimiter, safe-limit excess, MISO-limit excess, or source-block consumption mismatch is an error. A recorded delimiter replacement and page-decoration removal are warnings.

Set `stats.processedLength` to the final serialized `processedText.length` for every document type so the existing field has one consistent meaning.

- [ ] **Step 5: Run core tests and the existing suite**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.core.test.mjs
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
```

Expected: new tests PASS; existing tests remain PASS because no public façade changed yet.

- [ ] **Step 6: Commit the common safety layer**

```powershell
git add lib/preprocessing/contracts.ts lib/preprocessing/core.ts lib/text-preprocessor.core.test.mjs
git commit -m "feat: add MISO chunk safety contract"
```

---

### Task 2: 공통 표 청커

**Files:**
- Create: `lib/preprocessing/table-chunker.ts`
- Create: `lib/text-preprocessor.table.test.mjs`

**Interfaces:**
- Consumes: `DocumentBlock`, `ChunkDraft`, `ChunkingOutput`, `APP_CHUNK_LIMIT`
- Produces: `escapeMarkdownCell(value: string): string`
- Produces: `chunkTableBlock(block: DocumentBlock, contextLines: string[]): ChunkingOutput`
- Produces: `extractMarkdownTableBlocks(text: string, idPrefix: string): DocumentBlock[]`

- [ ] **Step 1: Write failing table integrity tests**

```js
test('split tables repeat headers and preserve special cell content', () => {
  const block = {
    id: 'table-1', kind: 'table', order: 0, headingPath: [],
    rows: [
      ['설비', '설명'],
      ...Array.from({ length: 90 }, (_, index) => [
        `P-${index + 1}`,
        index === 0 ? 'A|B, "인용"\n두 번째 줄' : '상세 '.repeat(35),
      ]),
    ],
  };
  const output = chunkTableBlock(block, ['[시트] 일일점검']);
  const result = finalizeChunkDrafts({
    originalLength: 1,
    ...output,
  });

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.includes('| 설비 | 설명 |')));
  assert.match(result.processedText, /A\\\|B, "인용"<br>두 번째 줄/);
  assert.equal(result.processedText.match(/P-1(?!\d)/g)?.length, 1);
});
```

Add separate tests for two adjacent tables, irregular column counts, one 4,100-character cell, and header-only tables.

- [ ] **Step 2: Run and confirm module-not-found failure**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.table.test.mjs
```

- [ ] **Step 3: Implement table parsing and row-aware splitting**

Rules:

```ts
export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}
```

- Use the first non-empty row as the header.
- Split one table at fully empty rows before chunking; report `MULTIPLE_TABLES` when more than one region exists.
- Repeat the escaped header and separator row in every draft.
- Keep a complete row together when it fits.
- If one row is oversized, render it as `열 이름: 값` fragments with the row identifier and split the long value via `splitTextPreservingSeparators()`.
- Never invent values for merged header cells; attach `MERGED_CELLS` warning instead.
- Attach `IRREGULAR_COLUMNS` with row locations when row widths differ.

- [ ] **Step 4: Run table and core tests**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.table.test.mjs
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.core.test.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add lib/preprocessing/table-chunker.ts lib/text-preprocessor.table.test.mjs
git commit -m "feat: preserve table rows and headers"
```

---

### Task 3: 법령·사규 구조 청커

**Files:**
- Create: `lib/preprocessing/law-chunker.ts`
- Create: `lib/text-preprocessor.law.test.mjs`
- Modify: `lib/text-preprocessor.test.mjs`

**Interfaces:**
- Consumes: `ExtractedDocument`, `ChunkingOutput`, `chunkTableBlock()`, `splitTextPreservingSeparators()`
- Produces: `chunkLawDocument(document: ExtractedDocument): ChunkingOutput`
- Produces: `chunkDelegationManualDocument(document: ExtractedDocument): ChunkingOutput | null`

- [ ] **Step 1: Write failing legal-boundary tests**

```js
test('short articles remain separate and keep the complete legal path', () => {
  const document = textDocument('발전소안전규정.txt', [
    '제1편 총칙', '제1장 일반', '제1절 목적',
    '제1조(목적)', '이 규정은 안전을 정한다.',
    '제2조(정의)', '용어의 뜻을 정한다.',
  ].join('\n'));
  const output = chunkLawDocument(document);
  const result = finalizeChunkDrafts({ originalLength: 1, ...output });

  assert.equal(result.chunks.length, 2);
  assert.match(result.chunks[0], /\[위치\] 제1편 총칙 > 제1장 일반 > 제1절 목적 > 제1조\(목적\)/);
  assert.match(result.chunks[1], /제2조\(정의\)/);
  assert.equal(result.chunks.some((chunk) => chunk.includes('제1조') && chunk.includes('제2조')), false);
});
```

Add tests for `제1조의2`, Markdown-wrapped headings, long article split at `①` then `1.` then `가.`, repeated path on every continuation, independent `부칙`, appendix table header repetition, preamble preservation, and all existing delegation-manual cases.

- [ ] **Step 2: Run legal tests and verify failure**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.law.test.mjs
```

- [ ] **Step 3: Implement hierarchy-stack parsing**

Maintain `part`, `chapter`, `section`, and `subsection` slots. On a higher-level heading, clear every lower slot. A hierarchy heading updates context but does not become a length-filling chunk. Each article creates one source block; an oversized article is split only at the following patterns, in order:

```ts
const paragraphPatterns = [
  /(?=^[①-⑳]\s*)/gm,
  /(?=^\d+[.)]\s*)/gm,
  /(?=^[가-힣][.)]\s*)/gm,
];
```

Render context as `[문서] 파일명` and `[위치] 편 > 장 > 절 > 관 > 조 제목`. The first and every continuation chunk use the same location line. Keep the existing 위임전결 A~J special case as a compatibility path, but route its tables through the common table chunker.

- [ ] **Step 4: Run legal, table, and legacy regression tests**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.law.test.mjs
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.table.test.mjs
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.test.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add lib/preprocessing/law-chunker.ts lib/text-preprocessor.law.test.mjs lib/text-preprocessor.test.mjs
git commit -m "feat: preserve legal hierarchy per article"
```

---

### Task 4: 설명서·업무 매뉴얼 청커

**Files:**
- Create: `lib/preprocessing/manual-chunker.ts`
- Create: `lib/text-preprocessor.manual.test.mjs`

**Interfaces:**
- Consumes: `ExtractedDocument`, `ChunkingOutput`, common table and split helpers
- Produces: `classifyManualLine(line: string): 'section' | 'step' | 'safety' | 'paragraph'`
- Produces: `chunkManualDocument(document: ExtractedDocument): ChunkingOutput`

- [ ] **Step 1: Write failing manual-structure tests**

```js
test('manual sections are not merged and safety text stays with its step', () => {
  const document = textDocument('보일러기동절차.docx', [
    '1) 사전 점검',
    '① 전원을 확인한다.',
    '[주의] 보호구를 착용한다.',
    '② 밸브를 확인한다.',
    '2) 기동',
    'Step 1 기동 버튼을 누른다.',
  ].join('\n'));
  const result = finalizeChunkDrafts({
    originalLength: 1,
    ...chunkManualDocument(document),
  });

  assert.equal(result.chunks.length, 2);
  assert.ok(result.chunks[0].includes('[주의] 보호구를 착용한다.'));
  assert.equal(result.chunks[0].includes('2) 기동'), false);
});
```

Add tests for `1.`, `1)`, `1-1`, `가)`, `①`, `Step 1`, `단계 1`, imperative numbered steps not being mistaken for sections, heading-only blocks attaching to following content, indentation preservation, and long sections splitting only at steps with repeated paths.

- [ ] **Step 2: Run and confirm failure**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.manual.test.mjs
```

- [ ] **Step 3: Implement line classification and section-first grouping**

Use explicit safety labels before generic numbered matching. A line ending in `다.`, `시오.`, `세요.` is a step unless it is a known section label. Keep a pending safety block with the adjacent step instead of emitting it independently. Do not merge two explicit section headings even when both are short. Use heading blocks from DOCX directly when available; parse raw-text lines only for flat inputs.

- [ ] **Step 4: Run manual and core tests**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.manual.test.mjs
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.core.test.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add lib/preprocessing/manual-chunker.ts lib/text-preprocessor.manual.test.mjs
git commit -m "feat: preserve manual sections and safety steps"
```

---

### Task 5: 일반 문서 청커와 공개 façade 통합

**Files:**
- Create: `lib/preprocessing/general-chunker.ts`
- Create: `lib/text-preprocessor.general.test.mjs`
- Modify: `lib/text-preprocessor.ts`
- Modify: `lib/text-preprocessor.test.mjs`

**Interfaces:**
- Consumes: all contracts, core finalizer, law/manual/table chunkers
- Produces: `chunkGeneralDocument(document: ExtractedDocument): ChunkingOutput`
- Produces: `preprocessExtractedDocument(document: ExtractedDocument, docType: DocType): PreprocessResult`
- Preserves: `normalizeDocType()`, `preprocessText()`, `preprocessByDocType()`

- [ ] **Step 1: Write failing general-document and façade tests**

```js
test('general headings and tables are strong boundaries', () => {
  const input = [
    '# 요약', '요약 본문',
    '# 점검 결과',
    '| 설비 | 상태 |', '| --- | --- |', '| 펌프 | 정상 |',
    '# 조치 사항', '후속 조치',
  ].join('\n');
  const result = preprocessByDocType(input, 'general', { documentName: '점검보고서.md' });

  assert.equal(result.chunks.length, 3);
  assert.equal(result.chunks.some((chunk) => chunk.includes('요약 본문') && chunk.includes('점검 결과')), false);
  assert.ok(result.chunks.some((chunk) => chunk.includes('| 설비 | 상태 |')));
  assert.ok(result.chunks.every((chunk) => chunk.length <= 3800));
});
```

Add tests for unheaded paragraph grouping, Markdown and numbered headings, quote/list indentation, no overlap, original order, fixed separator, empty-result blocked status, and legacy two-argument calls.

- [ ] **Step 2: Run and confirm failure**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.general.test.mjs
```

- [ ] **Step 3: Implement general section parsing**

Recognize Markdown headings, chapter/section headings, and short numbered title lines. A table is always a standalone strong block. Only unheaded paragraphs may be packed up to the safe budget. Reuse the legal line classifier for article-shaped headings without importing the general chunker back into the legal module.

- [ ] **Step 4: Replace `lib/text-preprocessor.ts` with a thin compatible façade**

The façade must accept both the old string form and the new options form:

```ts
export interface PreprocessOptions {
  documentName?: string;
}

export function preprocessByDocType(
  text: string,
  docType: DocType,
  options: PreprocessOptions | string = {},
): PreprocessResult;

export function preprocessExtractedDocument(
  document: ExtractedDocument,
  docType: DocType,
): PreprocessResult;
```

If the third argument is the legacy separator string, accept only `@@@` or empty; never serialize another delimiter. Wrap flat text in one `raw-text` block, route the selected type, pass the output to `finalizeChunkDrafts()`, and keep the 위임전결 compatibility path ahead of law/manual/general routing.

- [ ] **Step 5: Run all preprocessor tests and typecheck**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-preprocessor*.test.mjs
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
pnpm exec tsc --noEmit --incremental false
```

- [ ] **Step 6: Commit**

```powershell
git add lib/preprocessing/general-chunker.ts lib/text-preprocessor.ts lib/text-preprocessor.general.test.mjs lib/text-preprocessor.test.mjs
git commit -m "refactor: route documents through structure chunkers"
```

---

### Task 6: SheetJS 0.20.3, 구조화 Excel 추출과 청킹

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `lib/excel-workbook-extractor.ts`
- Create: `lib/preprocessing/excel-chunker.ts`
- Create: `lib/excel-workbook-extractor.test.mjs`
- Create: `lib/text-preprocessor.excel.test.mjs`
- Modify: `workers/file.worker.ts`
- Modify: `lib/text-preprocessor.ts`

**Interfaces:**
- Consumes: `ExtractedDocument`, table chunker, façade
- Produces: `extractWorkbookDocument(buffer: ArrayBuffer, fileName: string): ExtractedDocument`
- Produces: `chunkWorkbookDocument(document: ExtractedDocument): ChunkingOutput`
- Worker produces: `{ status: 'success', document: ExtractedDocument } | { status: 'error', error: string }`

- [ ] **Step 1: Replace the vulnerable SheetJS dependency using the official tarball**

```powershell
pnpm remove xlsx
pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Verify `package.json` contains the official 0.20.3 tarball specifier and `pnpm-lock.yaml` no longer resolves `xlsx@0.18.5`.

- [ ] **Step 2: Write failing in-memory Workbook extraction tests**

```js
test('extracts sheets, merges, blank rows, and raw cell text without CSV flattening', () => {
  const first = XLSX.utils.aoa_to_sheet([
    ['설비', '설명'],
    ['P-1', 'A|B, "인용"\n두 번째 줄'],
    [],
    ['설비', '상태'],
    ['P-2', '정상'],
  ]);
  first['!merges'] = [XLSX.utils.decode_range('A1:B1')];
  const second = XLSX.utils.aoa_to_sheet([['항목', '값'], ['압력', 10]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, first, '일일점검');
  XLSX.utils.book_append_sheet(workbook, second, '운전값');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const document = extractWorkbookDocument(bytes, '점검.xlsx');
  assert.equal(document.blocks.length, 2);
  assert.equal(document.blocks[0].rows[1][1], 'A|B, "인용"\n두 번째 줄');
  assert.equal(document.blocks[0].merges[0].range, 'A1:B1');
  assert.equal(document.warnings.some((issue) => issue.code === 'MERGED_CELLS'), true);
});
```

Add an empty-workbook error test and a displayed date/number string test.

- [ ] **Step 3: Implement `extractWorkbookDocument()`**

Use:

```ts
XLSX.utils.sheet_to_json<string[]>(sheet, {
  header: 1,
  raw: false,
  defval: '',
  blankrows: true,
});
```

Store one table block per non-empty sheet, preserve fully empty rows, convert `!merges` to A1 plus zero-based coordinates, and record sheet-specific warnings. Do not call `sheet_to_csv()` and do not fill covered merged cells.

- [ ] **Step 4: Write failing Excel chunk tests**

Test two sheets never mix, blank rows create multiple tables, headers repeat, a 4,100-character row becomes safe fragments, long cells render `열 이름: 값`, merged ranges and irregular columns remain warnings, and every non-empty row identifier appears exactly once in body content.

- [ ] **Step 5: Implement `chunkWorkbookDocument()` and façade routing**

Each sheet starts a new output sequence. Split table regions at fully empty rows, pass each region to `chunkTableBlock()`, and use context lines:

```text
[파일] 점검.xlsx
[시트] 일일점검
[표] 1
```

Keep a flat CSV/Markdown compatibility adapter for user-edited Excel previews, but structure-aware Workbook blocks take precedence.

- [ ] **Step 6: Make the Worker a thin transferable adapter**

Change the request to `{ type: 'excel', fileName, buffer }`, call `extractWorkbookDocument()`, and post the structured document. Ensure success, handled error, and `worker.onerror` all settle the hook promise and terminate the Worker.

- [ ] **Step 7: Run Excel, table, full tests, and typecheck**

```powershell
node --no-warnings --experimental-strip-types --test lib/excel-workbook-extractor.test.mjs
node --no-warnings --experimental-strip-types --test lib/text-preprocessor.excel.test.mjs
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
pnpm exec tsc --noEmit --incremental false
```

- [ ] **Step 8: Commit exact files only**

```powershell
git add package.json pnpm-lock.yaml lib/excel-workbook-extractor.ts lib/preprocessing/excel-chunker.ts lib/excel-workbook-extractor.test.mjs lib/text-preprocessor.excel.test.mjs workers/file.worker.ts lib/text-preprocessor.ts
git commit -m "feat: preserve structured Excel workbooks"
```

---

### Task 7: UTF-8/EUC-KR 텍스트 디코딩

**Files:**
- Create: `lib/text-file-decoder.ts`
- Create: `lib/text-file-decoder.test.mjs`

**Interfaces:**
- Consumes: `PreprocessIssue`
- Produces: `decodeTextBuffer(buffer, options): DecodedText`
- Produces: `TextEncodingChoice = 'auto' | 'utf-8' | 'euc-kr'`

- [ ] **Step 1: Write failing encoding tests**

```js
test('falls back from strict UTF-8 to Korean EUC-KR bytes', () => {
  const cp949 = Uint8Array.from([
    188, 179, 186, 241, 44, 187, 243, 197, 194, 13, 10,
    186, 184, 192, 207, 183, 175, 44, 193, 164, 187, 243,
  ]).buffer;
  const result = decodeTextBuffer(cp949, { choice: 'auto', format: 'csv' });
  assert.equal(result.text, '설비,상태\r\n보일러,정상');
  assert.equal(result.encoding, 'euc-kr');
});
```

Add UTF-8 BOM, valid UTF-8 without BOM, forced encoding selection, replacement character warning, and irregular CSV column warning tests.

- [ ] **Step 2: Run and confirm failure**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-file-decoder.test.mjs
```

- [ ] **Step 3: Implement deterministic detection**

Order: BOM → strict UTF-8 → EUC-KR fallback. A manual choice bypasses auto detection. Keep `�` in text; set `reviewRequired` and `SUSPECT_ENCODING` when any replacement character remains. For CSV, parse quoted rows before comparing column counts so commas and newlines inside quotes do not produce false warnings.

Return:

```ts
export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'euc-kr';
  detection: 'utf-8-bom' | 'valid-utf8' | 'utf8-fallback-euc-kr' | 'manual';
  replacementCharacterCount: number;
  reviewRequired: boolean;
  warnings: PreprocessIssue[];
}
```

- [ ] **Step 4: Run encoding and full tests**

```powershell
node --no-warnings --experimental-strip-types --test lib/text-file-decoder.test.mjs
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add lib/text-file-decoder.ts lib/text-file-decoder.test.mjs
git commit -m "feat: decode Korean legacy text files"
```

---

### Task 8: Mammoth DOCX 로컬 추출과 MISO fallback

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `lib/docx-extractor.ts`
- Create: `lib/docx-extractor.test.mjs`
- Create: `lib/miso-file-extractor.ts`
- Create: `lib/file-extraction-flow.test.mjs`
- Modify: `lib/file-processing-policy.ts`
- Modify: `lib/file-processing-policy.test.mjs`

**Interfaces:**
- Consumes: `ExtractedDocument`, `PreprocessIssue`
- Produces: `extractDocxDocument(buffer, fileName, converter?): Promise<ExtractedDocument>`
- Produces: `parseMammothHtml(html, fileName, parser?): { blocks; warnings }`
- Produces: `extractTextViaMiso(file, fetchImpl?): Promise<ExtractedDocument>`
- Produces: `extractDocxPreferLocal(file, adapters): Promise<ExtractedDocument>`

- [ ] **Step 1: Add pinned DOCX dependencies**

```powershell
pnpm add mammoth@1.12.0 @xmldom/xmldom@0.8.13
```

- [ ] **Step 2: Write failing DOCX route and parser tests**

Update the policy expectation:

```js
assert.equal(getFileProcessingRoute('contract.docx'), 'local-docx');
assert.equal(getFileProcessingRoute('scan.pdf'), 'miso');
```

Test HTML parsing with an injected converter:

```js
const fakeConverter = async () => ({
  value: '<h1>정비 절차</h1><p>전원을 차단한다.</p>' +
    '<ol><li>밸브 확인</li></ol>' +
    '<table><tr><th>설비</th><th>상태</th></tr>' +
    '<tr><td>펌프</td><td>정상</td></tr></table>',
  messages: [{ type: 'warning', message: '샘플 경고' }],
});
const document = await extractDocxDocument(new ArrayBuffer(0), '정비.docx', fakeConverter);
assert.deepEqual(document.blocks.map((block) => block.kind), [
  'heading', 'paragraph', 'list-item', 'table',
]);
```

Add tests for nested list depth, table paragraph non-duplication, empty extraction error, unknown/script/style/image omission, local success without MISO, local failure invoking MISO exactly once, and fallback warning.

- [ ] **Step 3: Implement safe Mammoth extraction**

Dynamic-import Mammoth and call `convertToHtml({ arrayBuffer }, { externalFileAccess: false })`. Parse a wrapped root with `@xmldom/xmldom`; walk only `h1`–`h6`, `p`, `ol`, `ul`, `li`, `table`, `tr`, `th`, `td`. Track heading paths and source order. Never export or render raw HTML. Convert Mammoth messages to warnings and reject a document with no usable blocks.

- [ ] **Step 4: Extract the existing MISO client and fallback flow**

Move the two fetch calls from the hook into `extractTextViaMiso()`. Validate that `data.result` is a non-empty string, wrap it in a `raw-text` document, and preserve API messages. `extractDocxPreferLocal()` adds one `DOCX_FALLBACK` warning containing the local error and returns the MISO document; if both fail, throw the MISO error with local failure detail attached.

- [ ] **Step 5: Update file policy**

Add `LOCAL_DOCX_EXTENSIONS = ['docx']`, add `'local-docx'` to `FileProcessingRoute`, remove `docx` from `MISO_DOCUMENT_EXTENSIONS`, and keep PDF/PPT/images on `miso`.

- [ ] **Step 6: Run policy, DOCX, flow, and full tests**

```powershell
node --no-warnings --experimental-strip-types --test lib/file-processing-policy.test.mjs
node --no-warnings --experimental-strip-types --test lib/docx-extractor.test.mjs
node --no-warnings --experimental-strip-types --test lib/file-extraction-flow.test.mjs
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
pnpm exec tsc --noEmit --incremental false
```

- [ ] **Step 7: Commit exact files only**

```powershell
git add package.json pnpm-lock.yaml lib/docx-extractor.ts lib/docx-extractor.test.mjs lib/miso-file-extractor.ts lib/file-extraction-flow.test.mjs lib/file-processing-policy.ts lib/file-processing-policy.test.mjs
git commit -m "feat: extract DOCX structure locally"
```

---

### Task 9: API와 파일 처리 훅 통합

**Files:**
- Modify: `app/api/preprocess/route.ts`
- Modify: `hooks/useFileProcessor.ts`
- Create: `lib/preprocess-request.ts`
- Create: `lib/preprocess-request.test.mjs`
- Modify: `workers/file.worker.ts`

**Interfaces:**
- Consumes: all extraction and preprocessing interfaces
- Produces: request `{ document?: ExtractedDocument; text?: string; docType?: unknown; separator?: unknown }`
- Produces: hook state `sourceDocument`, `result`, `textEncoding`, `encodingReviewRequired`, `extractionIssues`

- [ ] **Step 1: Write failing request-normalization tests**

```js
test('accepts the fixed separator and rejects a conflicting separator', () => {
  assert.equal(normalizePreprocessRequest({ text: '본문', docType: 'general', separator: '@@@' }).ok, true);
  const invalid = normalizePreprocessRequest({ text: '본문', separator: '###' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_SEPARATOR');
});

test('wraps legacy text but preserves a valid structured document', () => {
  const legacy = normalizePreprocessRequest({ text: '본문', docType: 'manual' });
  assert.equal(legacy.value.document.blocks[0].kind, 'raw-text');
  assert.equal(legacy.value.docType, 'manual');
});
```

Add invalid block shape, missing input, empty input, and filename sanitization cases.

- [ ] **Step 2: Implement pure request validation and API response contract**

Invalid requests return HTTP 400 with `{ success: false, error: { code, message } }`. Valid processing always returns HTTP 200 with `{ success: true, data: PreprocessResult }`, including `resultStatus: 'blocked'`. Unexpected exceptions return HTTP 500. The route must never use a caller-provided separator other than confirming it is absent or `@@@`.

- [ ] **Step 3: Refactor the hook around `applyExtraction()`**

Required state and actions:

```ts
sourceDocument: ExtractedDocument | null;
result: PreprocessResult | null;
textEncoding: 'utf-8' | 'euc-kr' | null;
encodingReviewRequired: boolean;
extractionIssues: PreprocessIssue[];
redecodeText: (encoding: 'utf-8' | 'euc-kr') => Promise<void>;
updateChunks: (chunks: string[]) => void;
```

- TXT/CSV: keep the ArrayBuffer, call `decodeTextBuffer()`, build a raw-text document, and auto-select Excel only for CSV.
- Excel: transfer the ArrayBuffer to Worker, save its `ExtractedDocument`, and render a Markdown preview from blocks.
- DOCX: call local extraction first, then the MISO fallback helper.
- PDF/PPT/image: call the existing MISO helper.
- DOCX/PDF extraction must not force the document type back to `general` after the user has selected another type.
- Public `setInputText()` represents a user edit: replace structured blocks with one raw-text block and add `STRUCTURE_DISCARDED_AFTER_EDIT` warning.
- Internal `applyExtraction()` updates preview without discarding structure.
- `processText()` sends the structured document and filename to `/api/preprocess`, then merges extraction warnings into result status.
- `updateChunks()` must call `revalidateEditedChunks()` and add `STRUCTURE_DISCARDED_AFTER_EDIT`; never join chunks directly.
- All Worker success/error paths must resolve or reject and terminate.

- [ ] **Step 4: Run request, extraction, full tests, and typecheck**

```powershell
node --no-warnings --experimental-strip-types --test lib/preprocess-request.test.mjs
node --no-warnings --experimental-strip-types --test lib/file-extraction-flow.test.mjs
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
pnpm exec tsc --noEmit --incremental false
```

- [ ] **Step 5: Commit**

```powershell
git add app/api/preprocess/route.ts hooks/useFileProcessor.ts lib/preprocess-request.ts lib/preprocess-request.test.mjs workers/file.worker.ts
git commit -m "feat: integrate structured file preprocessing"
```

---

### Task 10: 현장용 결과 상태와 안전한 편집·다운로드 UI

**Files:**
- Create: `lib/result-presentation.ts`
- Create: `lib/result-presentation.test.mjs`
- Create: `components/preprocess-result-summary.tsx`
- Modify: `app/page.tsx`
- Modify: `components/chunk-viewer-modal.tsx`
- Modify: `components/chunk-flow-viewer.tsx`
- Modify: `components/usage-guide.tsx`

**Interfaces:**
- Consumes: `PreprocessResult`, `ResultStatus`, fixed MISO constants, hook actions
- Produces: `getResultPresentation(status)` and `PreprocessResultSummary`

- [ ] **Step 1: Write failing result-presentation tests**

```js
test('maps processing status to simple Korean guidance', () => {
  assert.deepEqual(getResultPresentation('ready'), {
    label: 'MISO 등록 가능', tone: 'success', allowMisoDownload: true,
  });
  assert.equal(getResultPresentation('review').label, '원문 확인 필요');
  assert.equal(getResultPresentation('review').allowMisoDownload, true);
  assert.equal(getResultPresentation('blocked').allowMisoDownload, false);
});
```

- [ ] **Step 2: Implement pure presentation mapping and summary component**

The summary shows only status, expected chunk count, longest chunk, 3,800 excess count, 4,000 excess count, delimiter collision count, and issue messages. Use green/yellow/red styling from the existing design system; do not add charts or advanced settings.

- [ ] **Step 3: Replace editable separator UI with fixed guidance**

Remove `separator`/`setSeparator` from the page. Show:

```text
MISO 구분자: @@@
MISO 최대 길이: 4,000자
앱 안전 상한: 3,800자
```

Update the process-step description and usage guide so they no longer say the user chooses a separator.

- [ ] **Step 4: Add conditional encoding review and two downloads**

Show an encoding selector only when `encodingReviewRequired` is true. Provide `추출 원문 TXT 다운로드` whenever `inputText` exists. Enable `MISO 등록용 TXT 다운로드` only when `result.canDownload` is true. A blocked result must still open the result tab and show issues even when `processedText` is empty.

- [ ] **Step 5: Revalidate both text editing and drag-boundary editing**

Replace the regex-based save path with exact `MISO_SEPARATOR` parsing and `updateChunks()`. Preserve empty chunks so the validator can report them. Show a red character-count badge for chunks over 3,800 in the modal and flow viewer; never discard text when a drag creates an oversized chunk.

- [ ] **Step 6: Fix zero-count statistics and result navigation**

Render average only when `chunkCount > 0`, navigate to results when `result !== null`, and keep raw extraction available for blocked output.

- [ ] **Step 7: Run presentation tests, full tests, typecheck, and build**

```powershell
node --no-warnings --experimental-strip-types --test lib/result-presentation.test.mjs
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm run build
```

Expected: all tests PASS; typecheck PASS; production build PASS. Do not stage generated changes to `next-env.d.ts`.

- [ ] **Step 8: Commit exact UI files only**

```powershell
git add lib/result-presentation.ts lib/result-presentation.test.mjs components/preprocess-result-summary.tsx app/page.tsx components/chunk-viewer-modal.tsx components/chunk-flow-viewer.tsx components/usage-guide.tsx
git commit -m "feat: show MISO preprocessing quality status"
```

---

### Task 11: 골든 회귀 세트와 최종 검증

**Files:**
- Create: `lib/__fixtures__/manual/plant-start-stop.txt`
- Create: `lib/__fixtures__/law/power-company-rule.txt`
- Create: `lib/__fixtures__/general/project-report-with-table.md`
- Create: `lib/__fixtures__/excel/two-sheets.json`
- Create: `lib/__fixtures__/excel/merged-multiple-tables-long-cell.json`
- Create: `lib/preprocessing-golden.test.mjs`
- Modify: tests from Tasks 1–10 only when the final audit exposes a missing invariant

**Interfaces:**
- Consumes: public façade and every completed extraction helper
- Produces: no new runtime interfaces

- [ ] **Step 1: Add small, reviewable golden fixtures**

Each fixture must have stable IDs or distinctive values. The manual contains 사전점검·기동·정지 sections, nested steps, and safety notices. The legal fixture contains 편·장·절·조·항·호·목·부칙·별표. The general fixture contains three headings and one long table. Excel JSON fixtures mirror the `ExtractedDocument` contract and include two sheets, blank-row table boundaries, merges, `|`, quotes, cell line breaks, and a 4,100-character cell.

- [ ] **Step 2: Write end-to-end public API assertions**

```js
for (const scenario of scenarios) {
  const result = preprocessExtractedDocument(scenario.document, scenario.docType);
  assert.equal(result.stats.safeLimitExceededCount, 0, scenario.name);
  assert.equal(result.stats.misoLimitExceededCount, 0, scenario.name);
  assert.equal(result.stats.emptyChunkCount, 0, scenario.name);
  assert.ok(result.chunks.every((chunk) => chunk.length <= 3800), scenario.name);
  assert.equal(result.processedText.split('@@@').length, result.chunks.length, scenario.name);
}
```

Also assert every expected article, manual section, sheet name, row ID, and table header is present in the correct chunk and body values occur once except intentional context/header repetition.

- [ ] **Step 3: Run the complete verification matrix**

```powershell
node --no-warnings --experimental-strip-types --test lib/*.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm run build
git diff --check
git status --short
```

Expected:

- Node tests all PASS.
- TypeScript reports no errors.
- Next production build succeeds.
- `git diff --check` is empty.
- Only intended implementation files are modified; user-owned `.gitignore`, `README.md`, `next-env.d.ts`, and PRD changes are neither overwritten nor staged.

- [ ] **Step 4: Perform a local MISO-contract smoke test**

Generate one output containing Korean text, an emoji, LF/CRLF source lines, a long manual section, and a source `@@@`. Split the downloaded text on exact `@@@` and record:

```text
expected chunk count == split piece count
maximum split piece length <= 4,000
application chunk maximum <= 3,800
unresolved literal @@@ inside a chunk == 0
```

If MISO credentials and a Knowledge test space are available, upload this one TXT with separator `@@@` and maximum 4,000, then compare MISO's resulting chunk count. If external access is unavailable, report the manual MISO upload check as the only remaining user-side verification rather than blocking local completion.

- [ ] **Step 5: Commit golden tests and any verified corrections**

```powershell
git add lib/__fixtures__ lib/preprocessing-golden.test.mjs
git commit -m "test: add preprocessing golden documents"
```

---

## Completion Checklist

- [ ] `@@@` is the only emitted delimiter and appears only between chunks.
- [ ] Every final chunk, including context and table headers, is at most 3,800 characters.
- [ ] No normal business repetition is deleted and no long-text split removes spaces.
- [ ] Legal articles, manual sections, general headings, Excel sheets, and separate tables never mix across strong boundaries.
- [ ] Every continuation has the required legal/manual context or table header.
- [ ] SheetJS is the official 0.20.3 tarball; no `xlsx@0.18.5` remains.
- [ ] UTF-8 and EUC-KR decoding are test-covered; suspicious text is review status rather than silently cleaned.
- [ ] DOCX uses Mammoth locally, does not render raw HTML, and falls back to MISO once on failure.
- [ ] Ready/review/blocked states and both download paths behave as specified.
- [ ] Existing user changes remain untouched.
- [ ] Full tests, explicit TypeScript check, and production build pass.
