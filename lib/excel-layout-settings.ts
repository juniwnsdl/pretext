import {
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
export function applyManualExcelHeaderRows(
  document: ExtractedDocument,
  updates: ExcelHeaderRowUpdate[],
): ExtractedDocument {
  if (document.extractionMethod !== 'local-excel') {
    throw new TypeError('Manual Excel header rows require a locally extracted workbook.');
  }

  const byBlockId = new Map<string, ExcelHeaderRowUpdate>();
  for (const update of updates) {
    if (byBlockId.has(update.blockId)) {
      throw new RangeError(`Duplicate Excel sheet block: ${update.blockId}`);
    }
    byBlockId.set(update.blockId, update);
  }

  for (const update of updates) {
    const block = document.blocks.find((candidate) => candidate.id === update.blockId);
    const layout = block?.excelLayout;
    if (!block || block.kind !== 'table' || !layout) {
      throw new RangeError(`Excel sheet block was not found: ${update.blockId}`);
    }
    const { startRow: minimumRow, endRow: maximumRow } = layout.usedRange;
    if (
      !Number.isInteger(update.startRow)
      || !Number.isInteger(update.endRow)
      || update.startRow > update.endRow
      || update.startRow < minimumRow
      || update.endRow > maximumRow
    ) {
      throw new RangeError(
        `Excel header row range must stay between ${minimumRow} and ${maximumRow}, with start before end.`,
      );
    }
  }

  return {
    ...document,
    blocks: document.blocks.map((block) => {
      const update = byBlockId.get(block.id);
      if (!update || !block.excelLayout) return block;
      return {
        ...block,
        excelLayout: {
          usedRange: { ...block.excelLayout.usedRange },
          headerRows: {
            startRow: update.startRow,
            endRow: update.endRow,
            source: 'manual',
          },
        },
      };
    }),
  };
}
