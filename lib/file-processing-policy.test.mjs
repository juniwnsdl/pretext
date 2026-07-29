import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FILE_INPUT_ACCEPT,
  getFileProcessingRoute,
  isFileSizeAllowed,
} from './file-processing-policy.ts';

test('routes DOCX locally while keeping extraction-required files on MISO', () => {
  assert.equal(getFileProcessingRoute('notice.txt'), 'local-text');
  assert.equal(getFileProcessingRoute('data.csv'), 'local-text');
  assert.equal(getFileProcessingRoute('book.ods'), 'local-excel');
  assert.equal(getFileProcessingRoute('contract.docx'), 'local-docx');
  assert.equal(getFileProcessingRoute('scan.pdf'), 'miso');
  assert.equal(getFileProcessingRoute('briefing.pptx'), 'miso');
  assert.equal(getFileProcessingRoute('diagram.png'), 'miso');
  assert.equal(getFileProcessingRoute('policy.hwp'), 'unsupported');
});

test('accepts files up to 50MB and rejects larger files', () => {
  assert.equal(isFileSizeAllowed(50 * 1024 * 1024), true);
  assert.equal(isFileSizeAllowed(50 * 1024 * 1024 + 1), false);
});

test('file picker accepts ODS but not unsupported HWP files', () => {
  assert.equal(FILE_INPUT_ACCEPT.split(',').includes('.ods'), true);
  assert.equal(FILE_INPUT_ACCEPT.split(',').includes('.hwp'), false);
});
