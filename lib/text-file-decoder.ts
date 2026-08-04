import type { PreprocessIssue } from './preprocessing/contracts.ts';

export type TextEncodingChoice = 'auto' | 'utf-8' | 'euc-kr';

export interface DecodeTextBufferOptions {
  choice: TextEncodingChoice;
  format: 'txt' | 'csv';
}

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'euc-kr';
  detection: 'utf-8-bom' | 'valid-utf8' | 'utf8-fallback-euc-kr' | 'manual';
  replacementCharacterCount: number;
  reviewRequired: boolean;
  warnings: PreprocessIssue[];
}

interface CsvRecord {
  columnCount: number;
  startLine: number;
}

function decode(bytes: Uint8Array, encoding: 'utf-8' | 'euc-kr', fatal = false): string {
  return new TextDecoder(encoding, { fatal }).decode(bytes);
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let columnCount = 1;
  let inQuotedField = false;
  let atFieldStart = true;
  let recordStarted = false;
  let line = 1;
  let recordStartLine = 1;

  const finishRecord = () => {
    if (recordStarted) records.push({ columnCount, startLine: recordStartLine });
    columnCount = 1;
    atFieldStart = true;
    recordStarted = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotedField) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          index += 1;
        } else {
          inQuotedField = false;
        }
        continue;
      }

      if (character === '\r') {
        if (text[index + 1] === '\n') index += 1;
        line += 1;
      } else if (character === '\n') {
        line += 1;
      }
      continue;
    }

    if (character === '"' && atFieldStart) {
      inQuotedField = true;
      atFieldStart = false;
      recordStarted = true;
      continue;
    }

    if (character === ',') {
      columnCount += 1;
      atFieldStart = true;
      recordStarted = true;
      continue;
    }

    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRecord();
      line += 1;
      recordStartLine = line;
      continue;
    }

    atFieldStart = false;
    recordStarted = true;
  }

  finishRecord();
  return records;
}

function csvIrregularColumnsWarning(text: string): PreprocessIssue | undefined {
  const records = parseCsvRecords(text);
  const expectedColumnCount = records[0]?.columnCount;
  if (expectedColumnCount === undefined) return undefined;

  const locations = records
    .filter((record) => record.columnCount !== expectedColumnCount)
    .map((record) => `row ${record.startLine}`);

  if (locations.length === 0) return undefined;

  return {
    code: 'IRREGULAR_COLUMNS',
    severity: 'warning',
    message: 'CSV rows have inconsistent column counts.',
    count: locations.length,
    locations,
  };
}

export function decodeTextBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: DecodeTextBufferOptions,
): DecodedText {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text: string;
  let encoding: 'utf-8' | 'euc-kr';
  let detection: DecodedText['detection'];

  if (options.choice !== 'auto') {
    encoding = options.choice;
    text = decode(bytes, encoding);
    detection = 'manual';
  } else if (hasUtf8Bom(bytes)) {
    encoding = 'utf-8';
    text = decode(bytes, encoding);
    detection = 'utf-8-bom';
  } else {
    try {
      text = decode(bytes, 'utf-8', true);
      encoding = 'utf-8';
      detection = 'valid-utf8';
    } catch {
      encoding = 'euc-kr';
      text = decode(bytes, encoding);
      detection = 'utf8-fallback-euc-kr';
    }
  }

  const replacementCharacterCount = Array.from(text).filter((character) => character === '�').length;
  const warnings: PreprocessIssue[] = [];

  if (replacementCharacterCount > 0) {
    warnings.push({
      code: 'SUSPECT_ENCODING',
      severity: 'warning',
      message: 'Decoded text contains replacement characters and should be reviewed.',
      count: replacementCharacterCount,
    });
  }

  if (options.format === 'csv') {
    const warning = csvIrregularColumnsWarning(text);
    if (warning) warnings.push(warning);
  }

  return {
    text,
    encoding,
    detection,
    replacementCharacterCount,
    reviewRequired: warnings.length > 0,
    warnings,
  };
}
