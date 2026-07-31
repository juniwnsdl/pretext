# Public Document Preprocessing Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the meaning of complex Excel headers, expose one user-controlled formula-output option, explain equivalent table risks across Excel/DOCX/HWP-converted/PDF inputs, and use public real-world documents to improve and re-evaluate all four preprocessing modes without regressing the current 192-test baseline.

**Architecture:** Extend the existing structured `ExtractedDocument` contract with backward-compatible Excel column/formula metadata. Compose display headers in the Excel chunker from the selected header row range plus merge geometry, while keeping the raw extracted rows unchanged. Store the formula-output preference at document level so reprocessing and API validation use one immutable input. Keep UI copy in the existing help/settings components. Public source files remain uncommitted under `.tmp`; commit only source metadata, minimal derived fixtures, tests, code, and an evaluation report.

**Tech Stack:** Next.js 16, React 19, TypeScript, SheetJS/xlsx, Node test runner, pnpm

## Global Constraints

- Default output remains displayed values only; existing documents without new metadata behave exactly as before.
- Multi-row headers are composed as `parent > child`; normalize newlines and `<br>`-like text to spaces and remove adjacent duplicate segments.
- Do not invent labels for genuinely blank columns. Preserve them and emit the approved complex-header review warning.
- The warning text is exactly: `복잡한 병합·다단 머리행이 감지되었습니다. 일부 열 이름이 데이터와 정확히 연결되지 않을 수 있습니다. 원본과 결과를 비교하거나 ‘엑셀 머리행 설정’에서 머리행 범위를 확인하세요.`
- The only new Excel user setting is formula output: `value-only` (default) or `value-and-formula`.
- Never recalculate formulas. If a formula has no cached result, retain the formula and emit `FORMULA_RESULT_MISSING`.
- Raw public documents and third-party community files are not committed. Record official source URL, retrieval date, file type, license/use note, checksum when downloaded, and the structural cases evaluated.
- No production rule changes without a focused failing regression test derived from a public-document structure or an already-confirmed audit defect.
- Run the full 192-test baseline (or its increased total) after every production task. Preserve all unrelated user changes.

---

### Task 1: Extend the Excel extraction contract without changing default output

**Files:**
- Modify: `lib/preprocessing/contracts.ts`
- Modify: `lib/preprocess-limits.ts`
- Modify: `lib/preprocess-request.ts`
- Modify: `lib/preprocess-request.test.mjs`
- Modify: `lib/excel-workbook-extractor.ts`
- Modify: `lib/excel-workbook-extractor.test.mjs`

**Interfaces:**

```ts
export type ExcelFormulaOutput = 'value-only' | 'value-and-formula';

export interface ExcelFormulaCell {
  row: number;       // absolute 1-based worksheet row
  column: number;    // absolute 1-based worksheet column
  formula: string;   // includes leading '='
  hasStoredResult: boolean;
}

// Optional additions:
DocumentBlock.excelLayout.usedRange.startColumn?: number;
DocumentBlock.excelLayout.usedRange.endColumn?: number;
DocumentBlock.formulaCells?: ExcelFormulaCell[];
ExtractedDocument.excelOptions?: { formulaOutput: ExcelFormulaOutput };
```

- [ ] Add request-validation tests accepting valid optional metadata, rejecting invalid coordinates/formulas/options, and cloning nested metadata without mutation.
- [ ] Run `node --no-warnings --experimental-strip-types --test lib/preprocess-request.test.mjs` and confirm failure.
- [ ] Add bounded validation and cloning for optional columns, `formulaCells`, and `excelOptions`; include formula strings/entries in aggregate budgets.
- [ ] Add extractor tests for non-A1 used ranges, formulas with cached results, and formulas without cached results. Expect 1-based coordinates and default `excelOptions.formulaOutput === 'value-only'`.
- [ ] Run `node --no-warnings --experimental-strip-types --test lib/excel-workbook-extractor.test.mjs` and confirm failure.
- [ ] Read formulas with `cellFormula: true`; keep displayed values in `rows`, record formula metadata separately, and emit one `FORMULA_RESULT_MISSING` warning with worksheet locations for uncached formulas.
- [ ] Run the two focused test files, then `pnpm test` and `pnpm exec tsc --noEmit --incremental false`.

---

### Task 2: Compose merged multi-row Excel headers generically

**Files:**
- Modify: `lib/preprocessing/excel-chunker.ts`
- Modify: `lib/text-preprocessor.excel.test.mjs`

**Behavioral examples:**

```text
Selected header rows:
| 시간 | SMP\n(수도권) | SMP\n(비 수도권) | 대상 발전기 |   |   |
|      |             |                | Generation [MW] | Fuel Offtake [GJ] | Available Capacity [MW] |

Composed columns:
| 시간 | SMP (수도권) | SMP (비 수도권) | 대상 발전기 > Generation [MW] | 대상 발전기 > Fuel Offtake [GJ] | 대상 발전기 > Available Capacity [MW] |
```

- [ ] Add a failing test for the screenshot-shaped two-row horizontal merge and assert six output columns, no first-data-row header, normalized whitespace, and three `대상 발전기 > ...` columns.
- [ ] Add failing regression cases for a vertically merged header, a non-A1 used range, duplicate parent/child text, an uncovered blank column, and a legacy single-row header.
- [ ] Run `node --no-warnings --experimental-strip-types --test lib/text-preprocessor.excel.test.mjs` and confirm only new expectations fail.
- [ ] Implement pure helpers that map raw row-relative columns to absolute zero-based merge coordinates, carry a merge anchor value across its covered header cells, normalize each segment, remove adjacent duplicates, and join remaining segments with ` > `.
- [ ] Replace only the selected header rows with one composed header row before existing region/chunk splitting. Do not mutate `block.rows`.
- [ ] Emit one `COMPLEX_EXCEL_HEADER` warning per affected sheet when selected headers span multiple rows with merges, include merge locations, and use the exact approved Korean message.
- [ ] Verify new and legacy cases, then run `pnpm test` and the non-incremental typecheck.

---

### Task 3: Add formula-output setting from UI to chunk text

**Files:**
- Modify: `lib/excel-layout-settings.ts`
- Modify: `lib/excel-layout-settings.test.mjs`
- Modify: `components/excel-settings-dialog.tsx`
- Modify: `hooks/useFileProcessor.ts`
- Modify: `lib/preprocessing/excel-chunker.ts`
- Modify: `lib/text-preprocessor.excel.test.mjs`

**Interfaces:**

```ts
export interface ExcelProcessingUpdate {
  headerRows: ExcelHeaderRowUpdate[];
  formulaOutput: 'value-only' | 'value-and-formula';
}

export function applyExcelProcessingSettings(
  document: ExtractedDocument,
  update: ExcelProcessingUpdate,
): ExtractedDocument;
```

- [ ] Add failing model tests showing `value-only` is the default, applying `value-and-formula` is immutable, and existing header-row validation is unchanged.
- [ ] Add failing chunker tests: cached formula renders `표시값 (수식: =...)` only in `value-and-formula`; uncached formula renders `(수식: =...)`; default output remains byte-for-byte equal to the prior value-only output.
- [ ] Implement the immutable settings helper, retaining `applyManualExcelHeaderRows` as a compatibility wrapper if current callers/tests require it.
- [ ] In the chunker, overlay formula annotations onto a copy of each row by converting absolute formula coordinates through `usedRange.startRow/startColumn`; never alter row/column count.
- [ ] Update `ExcelSettingsDialog` with one workbook-level radio/select control labeled `수식 출력`, options `표시값만` and `표시값 + 수식`, plus the note that formulas are not recalculated.
- [ ] Update `useFileProcessor.reprocessExcel` and page props to submit the combined settings object and re-run the existing preprocessing path.
- [ ] Run focused model/chunker tests, `pnpm test`, and the non-incremental typecheck.

---

### Task 4: Update help for Excel and equivalent document tables

**Files:**
- Modify: `components/usage-guide.tsx`
- Modify: `lib/document-handling-guide.ts`
- Verify: `lib/document-handling-guide.test.mjs`
- Verify: `lib/help-guide-layout.test.mjs`

- [ ] In `어떤 방법으로 문서를 처리하면 되나요?`, explain that merged/multi-row headers are expanded per column, parent/child titles use ` > `, repeated title segments are removed, and review is required when a label cannot be mapped confidently.
- [ ] Explain that formula cells default to stored displayed values; users can select `표시값 + 수식`; the app does not recalculate; missing cached values require review in Excel.
- [ ] Add an adjacent note that DOCX tables, HWP converted to DOCX/PDF, and extracted PDF tables follow the same checks for merged cells, multi-row headers, missing columns, and reading order. State that HWP remains unsupported directly.
- [ ] Keep existing four document-type selection rules and support limitations intact; change copy only.
- [ ] Run the two help tests, `pnpm test`, and typecheck. Inspect the rendered settings/help UI at desktop and narrow width.

---

### Task 5: Build a reproducible public-document evaluation corpus

**Files:**
- Add: `docs/evaluation/public-source-manifest.md`
- Add: `docs/evaluation/2026-07-31-public-document-baseline.md`
- Add/Modify only when necessary: `lib/__fixtures__/<type>/*`

- [ ] Dispatch read-only research agents for `law`, `excel`, `manual`, and `general`. Prefer official Korean government/public-institution sources; use community discussions only to discover failure shapes, not as committed content.
- [ ] For each type, identify at least three structurally distinct sources and record direct URLs, publisher, retrieval date, format, access/use note, and target structures.
- [ ] Download only files needed for local evaluation into `.tmp/public-corpus/<type>/`; calculate SHA-256; do not stage them.
- [ ] Run the current app pipeline against each source. For HWP, use an official DOCX/PDF conversion where available; do not add an HWP parser.
- [ ] Score each type in five passes: extraction fidelity, hierarchy/context retention, table fidelity, chunk boundary coherence, and regression/safety. Record concrete source location, expected meaning unit, observed output, severity, and reproducibility.
- [ ] Convert only the smallest necessary, non-sensitive structure into synthetic/derived fixtures with source metadata comments. Do not copy substantial document text.

---

### Task 6: Fix only evidence-backed law, manual, and general-document defects

**Files (as evidence requires):**
- Modify: `lib/preprocessing/law-chunker.ts`
- Modify: `lib/text-preprocessor.law.test.mjs`
- Modify: `lib/docx-extractor.ts`
- Modify: `lib/docx-extractor.test.mjs`
- Modify: `lib/preprocessing/manual-chunker.ts`
- Modify: `lib/text-preprocessor.manual.test.mjs`
- Modify: `lib/preprocessing/general-chunker.ts`
- Modify: `lib/text-preprocessor.general.test.mjs`
- Modify: `lib/preprocessing/table-chunker.ts`
- Modify: `lib/text-preprocessor.table.test.mjs`

- [ ] Triage corpus failures: accept only defects that are reproducible, meaning-affecting, and addressable by a generic structural rule. Document unsupported/OCR/source-extraction limitations instead of guessing.
- [ ] For every accepted defect, add one focused failing test plus one nearby legacy regression test before modifying production code.
- [ ] Prioritize previously audited risks when confirmed by corpus evidence: law annex/addendum boundaries and TOC deletion; style-less DOCX headings, list numbering, nested tables/blockquote; long-section identifier context and table ownership.
- [ ] Implement the smallest generic rule. Avoid source names, fixed row numbers, specific Korean titles, or one-document regexes.
- [ ] After each defect, run its focused test file and `pnpm test`; revert/refine any rule that breaks existing behavior.
- [ ] Record rejected changes and reasons in the evaluation report so remaining limitations are explicit.

---

### Task 7: Re-evaluate all four modes and verify the release candidate

**Files:**
- Add: `docs/evaluation/2026-07-31-public-document-final.md`
- Verify: all modified source/test/help files

- [ ] Re-run the same five evaluation passes for `law`, `excel`, `manual`, and `general` against the unchanged raw corpus/checksums.
- [ ] Compare baseline/final scores and list fixed, partially fixed, unsupported, and newly detected cases.
- [ ] Confirm the screenshot-shaped workbook yields the intended six columns and exact complex-header warning.
- [ ] Confirm `value-only` default and `value-and-formula` opt-in with cached and uncached formulas.
- [ ] Run `pnpm test` and record the exact passing test count.
- [ ] Run `pnpm exec tsc --noEmit --incremental false`.
- [ ] Run `git diff --check` and inspect `git status --short`; ensure `.tmp/public-corpus` and user files are not staged.
- [ ] Perform a final spec-compliance review and code-quality review before reporting results.
