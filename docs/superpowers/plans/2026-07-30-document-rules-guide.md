# Document Rules Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine the duplicated document-type and automatic-rule help sections, update all four type descriptions from the current preprocessing behavior, and keep the setup-screen summaries concise.

**Architecture:** Keep help navigation metadata in `lib/help-guide-layout.ts`, detailed copy and presentation in `components/usage-guide.tsx`, and short selection copy in `app/page.tsx`. Replace the two old help section IDs with one `document-rules` ID, protect that layout contract with a Node test, and verify human-facing copy through type checking and rendered UI inspection rather than brittle source-string tests.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Node test runner

## Global Constraints

- The combined help section title is exactly `문서 종류별 정리 기준`.
- Help copy must distinguish common rules from the four type-specific selection and processing rules.
- The setup-screen descriptions remain one sentence per document type.
- Document type values remain exactly `law`, `excel`, `manual`, and `general`.
- Preprocessing algorithms and file-processing routes are out of scope.
- Preserve all unrelated, user-owned working-tree changes in overlapping files.
- Do not commit implementation files because `app/page.tsx` and `components/usage-guide.tsx` already contain user-owned uncommitted changes; commit only standalone planning documentation.

---

### Task 1: Consolidate the help layout model

**Files:**
- Modify: `lib/help-guide-layout.test.mjs`
- Modify: `lib/help-guide-layout.ts`

**Interfaces:**
- Consumes: `getHelpTab(id: HelpTabId): HelpTab`
- Produces: `HelpSectionId` member `'document-rules'` and a `usage.sectionIds` list containing it once

- [ ] **Step 1: Update the layout test to require one combined section**

Replace the usage expectation with:

```js
test('places one combined document rules section after file handling guidance', () => {
  const usage = getHelpTab('usage');

  assert.deepEqual(usage.sectionIds, [
    'tool-purpose',
    'steps',
    'file-routing',
    'support-scope',
    'document-rules',
    'review-cautions',
  ]);
});
```

- [ ] **Step 2: Run the focused test and confirm the old layout fails**

Run:

```powershell
node --no-warnings --experimental-strip-types --test lib/help-guide-layout.test.mjs
```

Expected: FAIL because the current layout still contains `document-types` and `automatic-rules`.

- [ ] **Step 3: Replace the two old section IDs with the combined ID**

Change the union and usage list in `lib/help-guide-layout.ts`:

```ts
export type HelpSectionId =
  | 'necessity'
  | 'handling-guide'
  | 'file-routing'
  | 'support-scope'
  | 'tool-purpose'
  | 'steps'
  | 'document-rules'
  | 'review-cautions';
```

```ts
sectionIds: [
  'tool-purpose',
  'steps',
  'file-routing',
  'support-scope',
  'document-rules',
  'review-cautions',
],
```

- [ ] **Step 4: Run the focused layout test**

Run the command from Step 2.

Expected: 2 tests pass.

---

### Task 2: Build the combined detailed help section

**Files:**
- Modify: `components/usage-guide.tsx`

**Interfaces:**
- Consumes: `HelpSectionId` member `'document-rules'`
- Produces: `DocumentRulesGuide()` with common rules and four `documentTypes` entries shaped as `{ name, selection, rules }`

- [ ] **Step 1: Expand the help data into explicit selection and rule fields**

Keep the four existing names and replace their descriptions with data equivalent to:

```ts
const commonDocumentRules = [
  '페이지 번호는 원문 대조를 위해 남기고, 페이지 주변에서 반복되는 짧은 머리말·꼬리말은 첫 번째만 남깁니다.',
  '각 청크에 문서명과 위치·섹션·시트처럼 검색에 필요한 문맥을 붙입니다.',
  'MISO 구분자는 @@@로 고정하며, 원문의 @@@는 구분자와 충돌하지 않게 바꿉니다.',
  'MISO의 4,000자 제한에 대비해 청크당 3,800자를 안전 상한으로 사용합니다.',
  '표와 반복되는 업무 문장은 최대한 보존하고, 원문에 없는 “(계속)” 문구를 만들지 않습니다.',
];

const documentTypes = [
  {
    name: '법령·사규',
    selection: '편·장·절·관·조, 부칙·별표·별지처럼 규정 계층이 중심인 문서',
    rules: '전체 계층과 조문 위치를 문맥으로 붙이고, 긴 조문은 항·호 등 자연스러운 경계를 우선해 나눕니다. 표도 해당 위치 문맥과 함께 보존합니다.',
  },
  {
    name: '엑셀·내부 데이터',
    selection: '행과 열로 구성된 표 데이터나 여러 시트가 있는 통합문서',
    rules: '시트와 빈 행으로 구분된 표 영역을 섞지 않습니다. 저장된 반복 머리행을 우선 사용하고, 없으면 자동 감지하며, 머리행 범위를 직접 수정할 수 있습니다.',
  },
  {
    name: '설명서·업무 매뉴얼',
    selection: '소제목, 번호 단계, 작업 절차, 주의·경고 문구가 중심인 문서',
    rules: '섹션과 작업 단계를 기준으로 묶고 주의·안전 문구를 인접한 작업과 함께 유지합니다. 표에는 해당 섹션 문맥을 붙입니다.',
  },
  {
    name: '일반 문서·보고서',
    selection: '보고서, 회의자료, 계약서 등 나머지 일반 문서',
    rules: '제목·문단·목록·표 경계를 기준으로 나눕니다. 구조화된 DOCX 계약서는 중복 조문 목차를 정리하고 완전한 조문과 조문 문맥을 우선 보존합니다.',
  },
];
```

- [ ] **Step 2: Replace the two old components with one combined card**

Implement this structure, following the existing card and grid styles:

```tsx
function DocumentRulesGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>문서 종류별 정리 기준</CardTitle>
        <CardDescription>
          먼저 공통 기준을 확인한 뒤, 내용의 주된 구조와 가장 가까운 유형 하나를 선택하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="rounded-lg border bg-muted/30 p-4">
          <h3 className="font-semibold">모든 문서에 공통으로 적용</h3>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {commonDocumentRules.map((rule) => (
              <li key={rule} className="flex gap-2 text-sm leading-6">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          {documentTypes.map((type) => (
            <section key={type.name} className="rounded-lg border p-4">
              <h3 className="font-semibold">{type.name}</h3>
              <p className="mt-3 text-xs font-medium text-foreground">이런 문서에 선택</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{type.selection}</p>
              <p className="mt-3 text-xs font-medium text-foreground">정리 방식</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{type.rules}</p>
            </section>
          ))}
        </div>

        <p className="rounded-lg bg-primary/10 px-4 py-3 text-sm leading-6">
          <strong>[위임전결규정 매뉴얼]</strong>과 A~J 항목 구조가 확인되면 선택한 종류와 관계없이 전용 기준으로 정리합니다.
        </p>
      </CardContent>
    </Card>
  );
}
```

Update `GuideSection` with:

```tsx
case 'document-rules':
  return <DocumentRulesGuide />;
```

Delete `DocumentTypesGuide`, `AutomaticRulesGuide`, and their two switch cases.

- [ ] **Step 3: Type-check the combined help component**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: exit code 0 with the new `document-rules` switch branch and data fields accepted.

---

### Task 3: Refresh the concise setup-screen summaries

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: existing `RadioGroup` values `law`, `excel`, `manual`, and `general`
- Produces: one concise summary sentence under each existing radio-card label

- [ ] **Step 1: Replace only the four summary strings**

Use exactly:

```tsx
편·장·절·관·조와 부칙·별표·별지의 위치 문맥을 유지합니다
```

```tsx
시트와 머리행을 감지해 표 영역별로 나누며 머리행을 직접 수정할 수 있습니다
```

```tsx
소제목·작업 단계와 주의·안전 문구가 떨어지지 않게 나눕니다
```

```tsx
제목·문단·목록·표를 기준으로 나누고 구조화된 계약서 조문도 인식합니다
```

Do not change radio IDs, values, or labels.

- [ ] **Step 2: Type-check the concise summaries in context**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: exit code 0; the radio IDs, values, and component structure remain valid.

---

### Task 4: Verify integration and presentation

**Files:**
- Verify: `lib/help-guide-layout.test.mjs`
- Verify: `components/usage-guide.tsx`
- Verify: `app/page.tsx`

**Interfaces:**
- Consumes: all prior task outputs
- Produces: tested, type-safe help and setup UI with no old duplicate section titles

- [ ] **Step 1: Run the focused tests together**

```powershell
node --no-warnings --experimental-strip-types --test lib/help-guide-layout.test.mjs
```

Expected: 2 tests pass.

- [ ] **Step 2: Run the complete Node test suite**

```powershell
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run TypeScript checking**

```powershell
pnpm exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 4: Inspect the local UI**

Run the local development server and confirm:

- `도움말` → `사용 방법` shows one `문서 종류별 정리 기준` card.
- Common rules precede the four type cards.
- Two columns collapse cleanly to one column at narrow width.
- `전처리 설정` keeps the four radio cards concise without changing selection behavior.

- [ ] **Step 5: Review the final diff**

```powershell
git diff --check
git diff -- lib/help-guide-layout.ts lib/help-guide-layout.test.mjs components/usage-guide.tsx app/page.tsx
```

Expected: no whitespace errors; only the intended help/layout/copy changes are present in the task portions of the diff.
