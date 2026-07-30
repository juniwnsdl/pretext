# Preprocess Limit Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the practical preprocessing input budgets and show one consistent Excel split-file warning in upload, error, and help surfaces.

**Architecture:** Move preprocessing budget constants and derived Korean guidance strings into a small browser/server-safe shared module. Keep `lib/preprocess-request.ts` as the validation entry point and re-export its existing constant API, while `app/page.tsx` and `components/usage-guide.tsx` consume the same guidance string so displayed values cannot drift from validation.

**Tech Stack:** TypeScript, React, Next.js App Router, Node test runner, pnpm

## Global Constraints

- Set the table row limit to exactly `20_000`.
- Set the table cell limit to exactly `300_000`.
- Set the aggregate structure item limit to exactly `2_000_000`.
- Keep the table column limit at `512` and aggregate text limit at `50_000_000`.
- Show the concise red upload warning only for locally processed Excel files.
- Keep `INPUT_TOO_LARGE` error codes stable while replacing English messages with actionable Korean copy.
- Do not add automatic file splitting or per-budget error diagnosis.
- Preserve all pre-existing uncommitted workspace changes.

---

### Task 1: Shared preprocessing limits and error copy

**Files:**
- Create: `lib/preprocess-limits.ts`
- Modify: `lib/preprocess-request.ts`
- Test: `lib/preprocess-request.test.mjs`

**Interfaces:**
- Produces: `PREPROCESS_MAX_TABLE_ROWS`, `PREPROCESS_MAX_TABLE_CELLS`, `PREPROCESS_MAX_AGGREGATE_STRUCTURE_ITEMS`, the unchanged remaining budget constants, `EXCEL_PREPROCESS_LIMIT_GUIDANCE`, `PREPROCESS_INPUT_TOO_LARGE_MESSAGE`, and `PREPROCESS_TEXT_TOO_LARGE_MESSAGE` from `lib/preprocess-limits.ts`.
- Preserves: all existing budget constant exports from `lib/preprocess-request.ts` through re-export.

- [ ] **Step 1: Add failing assertions for the new limits and Korean errors**

Add assertions to `lib/preprocess-request.test.mjs` that require:

```js
assert.equal(PREPROCESS_MAX_TABLE_ROWS, 20_000);
assert.equal(PREPROCESS_MAX_TABLE_CELLS, 300_000);
assert.equal(PREPROCESS_MAX_AGGREGATE_STRUCTURE_ITEMS, 2_000_000);
assert.match(tooLarge.error.message, /20,000행·300,000셀/u);
assert.match(textTooLarge.error.message, /텍스트.*여러 개로 나눠/u);
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --test lib/preprocess-request.test.mjs`

Expected: FAIL because the current values are `5_000`, `100_000`, and `1_000_000`, and current limit errors are English.

- [ ] **Step 3: Implement the shared limit module and validation imports**

Create `lib/preprocess-limits.ts` with all current budget constants, the three updated values, and strings derived from `PREPROCESS_MAX_TABLE_ROWS` and `PREPROCESS_MAX_TABLE_CELLS`. Import these values into `lib/preprocess-request.ts`, re-export the constants, and use the Korean message constants for document and text overflow failures.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `node --test lib/preprocess-request.test.mjs`

Expected: all preprocess request tests pass.

### Task 2: Upload and help guidance

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/usage-guide.tsx`
- Test: `lib/file-processing-policy.test.mjs`

**Interfaces:**
- Consumes: `EXCEL_PREPROCESS_LIMIT_GUIDANCE` from `lib/preprocess-limits.ts`.
- Produces: a local-Excel-only red upload hint and a help-list item that uses the same derived limit text.

- [ ] **Step 1: Add failing source-level UI contract assertions**

Extend the existing `upload and guide UI consume...` test to require both UI files to import/use `EXCEL_PREPROCESS_LIMIT_GUIDANCE`, require the page to render it only when `selectedFileRoute === 'local-excel'`, and require the page warning class to include `text-destructive`.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --test lib/file-processing-policy.test.mjs`

Expected: FAIL because neither UI surface currently consumes the common Excel guidance.

- [ ] **Step 3: Add the concise upload and help messages**

In `app/page.tsx`, retain the selected route, render `EXCEL_PREPROCESS_LIMIT_GUIDANCE` beneath the selected-file disclosure only for `local-excel`, and use small destructive-colored text. In `components/usage-guide.tsx`, add a separate list item stating that the row/cell budget is independent of the 50MB file-size budget and append the common guidance.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `node --test lib/file-processing-policy.test.mjs`

Expected: all file processing policy tests pass.

### Task 3: Full verification

**Files:**
- Verify all files changed in Tasks 1 and 2.

**Interfaces:**
- Consumes: the completed shared limits and both UI surfaces.
- Produces: test, type-check, whitespace, and visual evidence.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm test`

Expected: zero failed tests.

- [ ] **Step 2: Run TypeScript validation**

Run: `pnpm exec tsc --noEmit`

Expected: exit code `0` with no type errors.

- [ ] **Step 3: Check patch whitespace**

Run: `git diff --check -- lib/preprocess-limits.ts lib/preprocess-request.ts lib/preprocess-request.test.mjs lib/file-processing-policy.test.mjs app/page.tsx components/usage-guide.tsx`

Expected: no whitespace errors; line-ending conversion warnings are acceptable.

- [ ] **Step 4: Verify the three user-facing surfaces**

Use the running local app in the in-app browser. Confirm that an Excel selection shows the concise red warning, the Help usage tab shows the Excel limit note, and an oversized synthetic request returns the Korean actionable error. Confirm that non-Excel file selection does not show the red Excel warning.

- [ ] **Step 5: Review the final diff without staging unrelated changes**

Run targeted `git diff` and `git status --short`. Do not stage or commit `app/page.tsx`, `components/usage-guide.tsx`, or any other implementation file that contains pre-existing user changes unless the user explicitly requests it.
