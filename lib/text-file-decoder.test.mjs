import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeTextBuffer } from './text-file-decoder.ts';

test('falls back from strict UTF-8 to Korean EUC-KR bytes', () => {
  const cp949 = Uint8Array.from([
    188, 179, 186, 241, 44, 187, 243, 197, 194, 13, 10,
    186, 184, 192, 207, 183, 175, 44, 193, 164, 187, 243,
  ]).buffer;

  const result = decodeTextBuffer(cp949, { choice: 'auto', format: 'csv' });

  assert.equal(result.text, '설비,상태\r\n보일러,정상');
  assert.equal(result.encoding, 'euc-kr');
  assert.equal(result.detection, 'utf8-fallback-euc-kr');
  assert.equal(result.reviewRequired, false);
});

test('uses a UTF-8 BOM before all other auto detection paths', () => {
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('제목\r\n내용')]).buffer;

  const result = decodeTextBuffer(bytes, { choice: 'auto', format: 'txt' });

  assert.equal(result.text, '제목\r\n내용');
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.detection, 'utf-8-bom');
});

test('recognizes valid UTF-8 without a BOM', () => {
  const bytes = new TextEncoder().encode('한글\nUTF-8').buffer;

  const result = decodeTextBuffer(bytes, { choice: 'auto', format: 'txt' });

  assert.equal(result.text, '한글\nUTF-8');
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.detection, 'valid-utf8');
});

test('uses the manually selected encoding without auto detection', () => {
  const cp949 = Uint8Array.from([188, 179, 186, 241]).buffer;

  const result = decodeTextBuffer(cp949, { choice: 'euc-kr', format: 'txt' });

  assert.equal(result.text, '설비');
  assert.equal(result.encoding, 'euc-kr');
  assert.equal(result.detection, 'manual');
});

test('keeps replacement characters and requires review when decoding is suspect', () => {
  const malformedUtf8 = Uint8Array.from([0x61, 0xc3, 0x28, 0x62]).buffer;

  const result = decodeTextBuffer(malformedUtf8, { choice: 'utf-8', format: 'txt' });

  assert.equal(result.text, 'a�(b');
  assert.equal(result.replacementCharacterCount, 1);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.warnings, [{
    code: 'SUSPECT_ENCODING',
    severity: 'warning',
    message: 'Decoded text contains replacement characters and should be reviewed.',
    count: 1,
  }]);
});

test('checks CSV columns by quoted records without treating quoted commas or newlines as rows', () => {
  const csv = 'name,notes,status\r\nalpha,"comma, and a newline\r\nhere with ""quotes""",ok\r\nbeta,plain,ok';

  const result = decodeTextBuffer(new TextEncoder().encode(csv).buffer, { choice: 'auto', format: 'csv' });

  assert.equal(result.text, csv);
  assert.equal(result.warnings.some((issue) => issue.code === 'IRREGULAR_COLUMNS'), false);
  assert.equal(result.reviewRequired, false);
});

test('reports true irregular CSV records with physical line locations and trailing empty fields', () => {
  const csv = 'a,b,c\r\n1,2,\r\n3,4';

  const result = decodeTextBuffer(new TextEncoder().encode(csv).buffer, { choice: 'auto', format: 'csv' });

  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.warnings, [{
    code: 'IRREGULAR_COLUMNS',
    severity: 'warning',
    message: 'CSV rows have inconsistent column counts.',
    count: 1,
    locations: ['row 3'],
  }]);
});
