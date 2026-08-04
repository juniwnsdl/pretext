'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ExcelFormulaOutput } from '@/lib/preprocessing/contracts';
import type {
  ExcelHeaderRowUpdate,
  ExcelProcessingUpdate,
  ExcelSheetSetting,
} from '@/lib/excel-layout-settings';

interface ExcelSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ExcelSheetSetting[];
  formulaOutput: ExcelFormulaOutput;
  processing: boolean;
  onApply: (update: ExcelProcessingUpdate) => Promise<void>;
}

interface DraftRange {
  startRow: string;
  endRow: string;
}

function sourceLabel(source: ExcelSheetSetting['source']): string {
  if (source === 'print-titles') return 'Excel에 저장된 반복 머리행';
  if (source === 'manual') return '직접 설정';
  return '자동 감지';
}

export function ExcelSettingsDialog({
  open,
  onOpenChange,
  settings,
  formulaOutput,
  processing,
  onApply,
}: ExcelSettingsDialogProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftRange>>({});
  const [draftFormulaOutput, setDraftFormulaOutput] = useState<ExcelFormulaOutput>('value-only');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts(Object.fromEntries(settings.map((setting) => [
      setting.blockId,
      { startRow: String(setting.startRow), endRow: String(setting.endRow) },
    ])));
    setDraftFormulaOutput(formulaOutput);
    setValidationError(null);
  }, [formulaOutput, open, settings]);

  const updateDraft = (blockId: string, field: keyof DraftRange, value: string) => {
    setDrafts((current) => ({
      ...current,
      [blockId]: {
        ...current[blockId],
        [field]: value,
      },
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const updates: ExcelHeaderRowUpdate[] = [];
    for (const setting of settings) {
      const draft = drafts[setting.blockId];
      const startRow = Number(draft?.startRow);
      const endRow = Number(draft?.endRow);
      if (
        !Number.isInteger(startRow)
        || !Number.isInteger(endRow)
        || startRow > endRow
        || startRow < setting.minimumRow
        || endRow > setting.maximumRow
      ) {
        setValidationError(
          `${setting.sheetName} 시트는 ${setting.minimumRow}~${setting.maximumRow}행 안에서 시작 행과 마지막 행을 입력하세요.`,
        );
        return;
      }
      updates.push({ blockId: setting.blockId, startRow, endRow });
    }

    setValidationError(null);
    onOpenChange(false);
    await onApply({ headerRows: updates, formulaOutput: draftFormulaOutput });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>엑셀 처리 설정</DialogTitle>
            <DialogDescription>
              머리행 범위와 수식 출력 방식을 확인한 뒤 이 설정으로 결과를 다시 만듭니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {settings.map((setting) => {
              const draft = drafts[setting.blockId] ?? {
                startRow: String(setting.startRow),
                endRow: String(setting.endRow),
              };
              return (
                <section key={setting.blockId} className="space-y-3 rounded-lg border p-4">
                  <div>
                    <p className="font-medium">{setting.sheetName}</p>
                    <p className="text-xs text-muted-foreground">
                      {sourceLabel(setting.source)}: {setting.startRow}~{setting.endRow}행
                    </p>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${setting.blockId}-header-start`}>시작 행</Label>
                      <Input
                        id={`${setting.blockId}-header-start`}
                        type="number"
                        min={setting.minimumRow}
                        max={setting.maximumRow}
                        value={draft.startRow}
                        onChange={(event) => updateDraft(
                          setting.blockId,
                          'startRow',
                          event.target.value,
                        )}
                      />
                    </div>
                    <span className="pb-2 text-muted-foreground">~</span>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${setting.blockId}-header-end`}>마지막 행</Label>
                      <Input
                        id={`${setting.blockId}-header-end`}
                        type="number"
                        min={setting.minimumRow}
                        max={setting.maximumRow}
                        value={draft.endRow}
                        onChange={(event) => updateDraft(
                          setting.blockId,
                          'endRow',
                          event.target.value,
                        )}
                      />
                    </div>
                  </div>
                </section>
              );
            })}

            <section className="space-y-3 rounded-lg border p-4">
              <div>
                <Label htmlFor="excel-formula-output">수식 출력</Label>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  엑셀에 저장된 표시값을 사용하며 수식을 다시 계산하지 않습니다.
                </p>
              </div>
              <Select
                value={draftFormulaOutput}
                onValueChange={(value) => setDraftFormulaOutput(value as ExcelFormulaOutput)}
              >
                <SelectTrigger id="excel-formula-output" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="value-only">표시값만</SelectItem>
                  <SelectItem value="value-and-formula">표시값 + 수식</SelectItem>
                </SelectContent>
              </Select>
            </section>
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">{validationError}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={processing || settings.length === 0}>
              이 설정으로 다시 전처리
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
