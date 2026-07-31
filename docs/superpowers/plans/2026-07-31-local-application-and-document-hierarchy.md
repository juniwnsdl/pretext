# Local Application and Document Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect unsupported Excel comments without exposing them, preserve confirmed manual/general heading parents, clarify table limitations in Help, and merge the verified result into the user's local `master` checkout.

**Architecture:** Keep extraction metadata minimal: Excel comments create only an aggregated warning, while raw-text heading inference is implemented inside the existing manual and general chunkers. Structured `headingPath` always wins. Human-facing limitations live in the shared guide data consumed by the Help tab.

**Tech Stack:** Next.js 16, TypeScript, Node test runner, SheetJS `xlsx` 0.20.3, React.

## Global Constraints

- MISO chunks must stay at or below the existing 3,800-character safe limit and use the existing `@@@` separator.
- Never include Excel comment text, author, replies, mentions, or resolution state in `ExtractedDocument`, warnings, or final chunks.
- Comment locations are capped at the first 20 cells in workbook/sheet order; `count` remains the exact number of commented cells.
- Do not infer missing manual ancestors; a direct observed parent is required for each dotted level.
- General-document inferred hierarchy is exactly two levels: strict Roman parent plus the current numbered heading.
- Explicit DOCX/structured `headingPath` overrides raw-text inference.
- Preserve existing checklist, safety-line, law-article, table-header, C/D rating, PPT, and A4 behavior.
- Complex PDF tables are documented as limited; do not add speculative cell reconstruction.
- Use TDD for production behavior: write the failing test, verify the expected failure, add the minimal implementation, then verify green.
- Preserve the user's existing local `next-env.d.ts`, `.claude/`, and `.tmp/` changes during final integration.

---

### Task 1: Excel comment detection and sparse display range

**Files:**
- Modify: `lib/excel-workbook-extractor.ts`
- Test: `lib/excel-workbook-extractor.test.mjs`

**Interfaces:**
- Produces: `extractSheetCommentSummary(sheet): { count: number; locations: string[] }` or an equivalently named exported pure helper that scans only materialized cells.
- Produces: workbook warning code `EXCEL_CELL_COMMENTS_UNSUPPORTED` with exact commented-cell count and at most 20 locations.
- Preserves: `extractWorkbookDocument(buffer, fileName): ExtractedDocument` and all formula metadata contracts.

- [ ] **Step 1: Write failing comment warning tests**

Create real SheetJS workbooks containing a legacy note, two threaded fragments on one cell, and a comment-only empty cell. Assert one workbook warning, commented-cell count rather than fragment count, ordered locations, and absence of secret comment text/author in `JSON.stringify(document)`.

```js
assert.equal(warning.code, 'EXCEL_CELL_COMMENTS_UNSUPPORTED');
assert.equal(warning.count, 3);
assert.deepEqual(warning.locations, ['검토!A1', '검토!B2', '검토!C1000']);
assert.equal(JSON.stringify(document).includes('비공개 검토 내용'), false);
```

- [ ] **Step 2: Run the focused extractor tests and verify RED**

Run: `node --no-warnings --experimental-strip-types --test --test-name-pattern="comment|memo|threaded" lib/excel-workbook-extractor.test.mjs`

Expected: FAIL because no comment warning/helper exists.

- [ ] **Step 3: Write failing location-cap and sparse-range tests**

Add 21 commented cells and assert `count === 21` with `locations.length === 20`. Add a sheet with `A1` data and a comment-only `XFD1048576`; assert extraction does not allocate the whole worksheet, the output rows contain only the meaningful range, and the far location is still reported. Add a comment-only workbook assertion for a dedicated Korean error mentioning unsupported comments and original Excel review.

- [ ] **Step 4: Run the focused tests and verify the new sparse tests fail for the intended reason**

Run: `node --no-warnings --experimental-strip-types --test --test-name-pattern="comment|memo|threaded|sparse" lib/excel-workbook-extractor.test.mjs`

Expected: FAIL because `displayedRows`/`sheetUsedRange` still trust the comment-expanded `!ref` and comment-only workbooks use the generic empty error.

- [ ] **Step 5: Implement materialized-cell comment scanning and an effective display range**

Scan `Object.keys(sheet)` once, ignore `!` keys, count cells whose `cell.c` is a non-empty array, and retain only the first 20 addresses. Compute the displayed/used range from cells with a stored value or formula, expanding through relevant merge endpoints. Exclude comment-only stub cells from the display range. Pass that range explicitly to `sheet_to_json`; retain existing offset coordinates, formula-only sheets, merges, and print-title behavior.

- [ ] **Step 6: Aggregate the unsupported warning without copying comment data**

Emit exactly one warning after all sheets:

```ts
{
  code: 'EXCEL_CELL_COMMENTS_UNSUPPORTED',
  severity: 'warning',
  message: '이 Excel 파일에서 셀 메모 또는 댓글이 감지되었습니다. 현재 앱은 메모·댓글의 내용, 작성자, 답글, 멘션 및 해결 상태를 전처리 결과에 포함하지 않습니다. 업무상 중요한 정보가 있을 수 있으므로 원본 Excel에서 확인하세요. 위치는 최대 20개만 표시합니다.',
  count: commentedCellCount,
  locations: firstTwentyLocations,
}
```

- [ ] **Step 7: Verify GREEN and run all Excel tests**

Run: `node --no-warnings --experimental-strip-types --test lib/excel-workbook-extractor.test.mjs lib/text-preprocessor.excel.test.mjs lib/excel-layout-settings.test.mjs`

Expected: all pass; no comment body or author appears in extracted output.

- [ ] **Step 8: Commit**

```bash
git add lib/excel-workbook-extractor.ts lib/excel-workbook-extractor.test.mjs
git commit -m "feat: 엑셀 셀 주석 감지 경고 추가"
```

### Task 2: Confirmed manual dotted-number hierarchy

**Files:**
- Modify: `lib/preprocessing/manual-chunker.ts`
- Test: `lib/text-preprocessor.manual.test.mjs`

**Interfaces:**
- Consumes: existing `classifyManualLine`, `ManualSection`, and structured `headingPath` behavior.
- Produces: raw-text section paths such as `1. 홈페이지 > 1.1. 시스템개요 > 1.1.1. 개요` only when every direct parent was observed.

- [ ] **Step 1: Write failing official-pattern hierarchy tests**

Use hand-written fixtures derived from the observed public manuals:

```text
1. 홈페이지
1.1. 시스템개요
1.1.1. 개요
교통정보를 제공합니다.
```

Assert the final chunk context contains the complete three-level path, each source line is preserved once, and no `manual-deep-numbering-unstructured` warning is emitted for a complete chain. Add a cross-raw-block version to prove state survives block boundaries.

- [ ] **Step 2: Run the focused manual tests and verify RED**

Run: `node --no-warnings --experimental-strip-types --test --test-name-pattern="dotted|deep numbering|parent" lib/text-preprocessor.manual.test.mjs`

Expected: FAIL because current code flattens deep numbering and always warns.

- [ ] **Step 3: Write failing missing-parent and regression tests**

Assert orphan `2.1.1 상세 절차` stays once as body and produces the existing review warning. Assert adjacent `1./2./3.` checklist lines remain steps/body rather than paths, safety text stays with its instruction, and explicit structured `headingPath` remains authoritative.

- [ ] **Step 4: Implement strict numbered-heading parsing and a direct-parent stack**

Recognize up to four numeric components with optional trailing dots and a short non-sentence, non-imperative title. Track observed numeric prefixes across raw blocks. Start a hierarchical section only when the direct parent prefix exists; otherwise preserve the line through the current body path and add one review warning per source block. Clear deeper descendants on a sibling or new top-level heading. Do not alter list demotion or safety attachment.

- [ ] **Step 5: Verify GREEN and run all manual tests**

Run: `node --no-warnings --experimental-strip-types --test lib/text-preprocessor.manual.test.mjs`

Expected: all pass with complete confirmed paths and unchanged checklist/safety behavior.

- [ ] **Step 6: Commit**

```bash
git add lib/preprocessing/manual-chunker.ts lib/text-preprocessor.manual.test.mjs
git commit -m "feat: 매뉴얼 숫자 계층 문맥 보존"
```

### Task 3: Roman parent context in general documents

**Files:**
- Modify: `lib/preprocessing/general-chunker.ts`
- Test: `lib/text-preprocessor.general.test.mjs`

**Interfaces:**
- Consumes: existing strict Roman and numbered heading recognizers.
- Produces: two-level paths `[romanParent, currentNumberedHeading]` without inferring missing numeric ancestors.

- [ ] **Step 1: Write failing ASCII/Unicode Roman-parent tests**

Parameterize `I. 사업 개요` and `Ⅰ. 사업 개요`, each followed by `1. 추진 배경`, body, and `1.1 추진 경과`. Assert contexts `상위 > 현재 숫자 제목`, parent provenance consumed once, and no parent title duplicated into body.

- [ ] **Step 2: Run focused general tests and verify RED**

Run: `node --no-warnings --experimental-strip-types --test --test-name-pattern="Roman parent|로마|사업 개요" lib/text-preprocessor.general.test.mjs`

Expected: FAIL because `acceptHeading` currently replaces `activePath` and folds empty parents into body.

- [ ] **Step 3: Write failing parent-reset and false-positive regressions**

Assert `Ⅱ.` replaces `Ⅰ.`, Markdown/legal/structured headings reset inferred parents, tables inherit the active two-level path, and `C 70%`, `D 55%`, `PPT`, `A4`, `가./나.`, and consecutive `1./2./3.` lists remain body.

- [ ] **Step 4: Implement a Roman-only parent state**

Distinguish strict Roman headings from other structural headings without widening recognition. When a valid numbered heading follows an active Roman parent, set the path to `[romanParent, heading.text]`. Carry a body-less parent's source IDs into the first child without emitting a context-only unit or inserting the parent into body. Reset inferred state on the boundaries listed in Global Constraints.

- [ ] **Step 5: Verify GREEN and run all general tests**

Run: `node --no-warnings --experimental-strip-types --test lib/text-preprocessor.general.test.mjs`

Expected: all pass with unchanged false-positive behavior.

- [ ] **Step 6: Commit**

```bash
git add lib/preprocessing/general-chunker.ts lib/text-preprocessor.general.test.mjs
git commit -m "feat: 일반문서 상위 제목 문맥 보존"
```

### Task 4: Help-tab and evaluation guidance

**Files:**
- Modify: `lib/document-handling-guide.ts`
- Modify: `components/usage-guide.tsx`
- Modify: `docs/evaluation/2026-07-31-public-document-evaluation.md`
- Test: existing `lib/document-handling-guide.test.mjs` only if its current behavioral contract requires updating.

**Interfaces:**
- Consumes: shared guide entries rendered by the Help tab.
- Produces: concise user guidance for comments, formulas, hierarchical headers, confirmed document paths, and complex PDF limitations.

- [ ] **Step 1: Update shared guidance without duplicating long prose**

Add concise Korean guidance covering:

```text
Excel 셀 메모·댓글은 존재만 감지하며 내용·작성자·답글은 결과에 포함하지 않습니다.
복잡한 PDF 표는 병합·다단 머리행·회전 글자·페이지 연결 관계를 정확히 복원하지 못할 수 있으므로 원본과 비교하세요.
확인된 매뉴얼 숫자 부모와 일반문서 로마 상위 제목은 청크 문맥에 함께 표시합니다.
```

Keep the existing formula/no-recalculation and `상위 > 하위` header guidance. State that Word/HWP-converted/PDF tables receive equivalent handling only when extraction preserves table structure.

- [ ] **Step 2: Update the evaluation report**

Record the new comment-detection boundary, manual/general parent behavior, public browser sources already listed in the design review, and remaining limitations. Do not claim absolute accuracy or complex-PDF reconstruction.

- [ ] **Step 3: Run existing guide and full unit tests**

Run: `node --no-warnings --experimental-strip-types --test lib/document-handling-guide.test.mjs`

Then: `pnpm test`

Expected: all pass. Pure prose does not require a new source-text assertion; update existing guide tests only if an established exported-guide contract changed.

- [ ] **Step 4: Commit**

```bash
git add lib/document-handling-guide.ts components/usage-guide.tsx docs/evaluation/2026-07-31-public-document-evaluation.md lib/document-handling-guide.test.mjs
git commit -m "docs: 도움말에 전처리 한계와 계층 안내 보강"
```

### Task 5: Whole-branch verification and local integration

**Files:**
- Verify only; no planned production-file edits.

**Interfaces:**
- Consumes: all commits from Tasks 1-4.
- Produces: a clean reviewed feature branch and a verified local `master` checkout.

- [ ] **Step 1: Run final branch verification**

Run:

```text
pnpm test
pnpm exec tsc --noEmit --incremental false
pnpm run build
git diff --check
```

Expected: zero test/type/build failures; existing unrelated Next.js warnings may remain documented.

- [ ] **Step 2: Verify the Help tab and Excel warning in the in-app browser**

Run the local app, confirm the Help content is visible, upload a generated non-sensitive XLSX containing a comment, and confirm only the unsupported-comment warning appears—not its body or author. Confirm no browser console errors.

- [ ] **Step 3: Run broad whole-branch review**

Review the complete diff from the branch merge base, including any deferred task-review findings. Resolve load-bearing findings before integration.

- [ ] **Step 4: Merge locally while preserving user changes**

Confirm the base branch is `master`, merge `codex/public-document-preprocessing` into the main checkout without discarding `next-env.d.ts`, `.claude/`, or `.tmp/`, then run `pnpm test` and TypeScript validation again from the main checkout.

- [ ] **Step 5: Report integration state**

Report the merge commit/fast-forward head, local path, verification counts, remaining unsupported cases, and whether the isolated worktree remains or was cleaned up.

