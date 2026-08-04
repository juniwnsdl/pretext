import {
  type ExcelFormulaOutput,
  type ExtractedDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/contracts.ts';

export interface ExcelSheetSetting {
  blockId: string;
  sheetName: string;
  startRow: number;
  endRow: number;
  minimumRow: number;
  maximumRow: number;
  source: 'print-titles' | 'detected' | 'manual';
}

export interface ExcelHeaderRowUpdate {
  blockId: string;
  startRow: number;
  endRow: number;
}

export interface ExcelProcessingUpdate {
  headerRows: ExcelHeaderRowUpdate[];
  formulaOutput: ExcelFormulaOutput;
}

export function getExcelFormulaOutput(
  document: ExtractedDocument | null,
): ExcelFormulaOutput {
  return document?.excelOptions?.formulaOutput ?? 'value-only';
}

/** Returns only locally extracted workbook sheets that have editable layout metadata. */
export function getExcelSheetSettings(document: ExtractedDocument | null): ExcelSheetSetting[] {
  if (!document || document.extractionMethod !== 'local-excel') return [];
  return document.blocks.flatMap((block) => {
    const layout = block.excelLayout;
    if (block.kind !== 'table' || !layout) return [];
    return [{
      blockId: block.id,
      sheetName: block.sheetName || block.headingPath.at(-1) || block.id,
      startRow: layout.headerRows.startRow,
      endRow: layout.headerRows.endRow,
      minimumRow: layout.usedRange.startRow,
      maximumRow: layout.usedRange.endRow,
      source: layout.headerRows.source,
    }];
  });
}

/** Clones a workbook document and marks validated sheet header ranges as manual overrides. */
export function applyExcelProcessingSettings(
  document: ExtractedDocument,
  update: ExcelProcessingUpdate,
): ExtractedDocument {
  if (document.extractionMethod !== 'local-excel') {
    throw new TypeError('Manual Excel header rows require a locally extracted workbook.');
  }
  if (update.formulaOutput !== 'value-only' && update.formulaOutput !== 'value-and-formula') {
    throw new TypeError('Excel formula output must be value-only or value-and-formula.');
  }

  const byBlockId = new Map<string, ExcelHeaderRowUpdate>();
  for (const headerUpdate of update.headerRows) {
    if (byBlockId.has(headerUpdate.blockId)) {
      throw new RangeError(`Duplicate Excel sheet block: ${headerUpdate.blockId}`);
    }
    byBlockId.set(headerUpdate.blockId, headerUpdate);
  }

  for (const headerUpdate of update.headerRows) {
    const block = document.blocks.find((candidate) => candidate.id === headerUpdate.blockId);
    const layout = block?.excelLayout;
    if (!block || block.kind !== 'table' || !layout) {
      throw new RangeError(`Excel sheet block was not found: ${headerUpdate.blockId}`);
    }
    const { startRow: minimumRow, endRow: maximumRow } = layout.usedRange;
    if (
      !Number.isInteger(headerUpdate.startRow)
      || !Number.isInteger(headerUpdate.endRow)
      || headerUpdate.startRow > headerUpdate.endRow
      || headerUpdate.startRow < minimumRow
      || headerUpdate.endRow > maximumRow
    ) {
      throw new RangeError(
        `Excel header row range must stay between ${minimumRow} and ${maximumRow}, with start before end.`,
      );
    }
  }

  return {
    ...document,
    blocks: document.blocks.map((block) => {
      const headerUpdate = byBlockId.get(block.id);
      if (!headerUpdate || !block.excelLayout) return block;
      return {
        ...block,
        excelLayout: {
          usedRange: { ...block.excelLayout.usedRange },
          headerRows: {
            startRow: headerUpdate.startRow,
            endRow: headerUpdate.endRow,
            source: 'manual',
          },
        },
      };
    }),
    excelOptions: { formulaOutput: update.formulaOutput },
  };
}

/** Backward-compatible wrapper for callers that only change header rows. */
export function applyManualExcelHeaderRows(
  document: ExtractedDocument,
  updates: ExcelHeaderRowUpdate[],
): ExtractedDocument {
  return applyExcelProcessingSettings(document, {
    headerRows: updates,
    formulaOutput: getExcelFormulaOutput(document),
  });
}
