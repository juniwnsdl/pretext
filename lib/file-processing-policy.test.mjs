import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as filePolicy from './file-processing-policy.ts';
import * as preprocessLimits from './preprocess-limits.ts';

const {
  FILE_INPUT_ACCEPT,
  getFileProcessingRoute,
  isFileSizeAllowed,
} = filePolicy;

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

test('route disclosures distinguish never, fallback-only, and always transmission', () => {
  assert.equal(typeof filePolicy.getFileProcessingDisclosure, 'function');

  const text = filePolicy.getFileProcessingDisclosure('local-text');
  const excel = filePolicy.getFileProcessingDisclosure('local-excel');
  const docx = filePolicy.getFileProcessingDisclosure('local-docx');
  const miso = filePolicy.getFileProcessingDisclosure('miso');

  assert.equal(text.transmission, 'never');
  assert.equal(excel.transmission, 'never');
  assert.equal(text.transmissionLabel, '전송 안 함');
  assert.equal(excel.transmissionLabel, '전송 안 함');
  assert.equal(docx.transmission, 'on-local-failure');
  assert.equal(docx.transmissionLabel, '실패 시 전송');
  assert.equal(miso.transmission, 'always');
  assert.equal(miso.transmissionLabel, '항상 전송');
});

test('DOCX disclosure explains the original-file fallback and offers a TXT alternative', () => {
  assert.equal(typeof filePolicy.getFileProcessingDisclosure, 'function');

  const docx = filePolicy.getFileProcessingDisclosure('local-docx');

  assert.match(docx.message, /원본 파일.*MISO.*전송/u);
  assert.match(docx.message, /실패/u);
  assert.match(docx.message, /TXT/u);
  assert.equal(docx.buttonLabel, '텍스트 추출');
});

test('each supported route uses one extraction label and sets time and size expectations', () => {
  assert.equal(typeof filePolicy.getFileProcessingDisclosure, 'function');

  for (const route of ['local-text', 'local-excel', 'local-docx', 'miso']) {
    const disclosure = filePolicy.getFileProcessingDisclosure(route);
    assert.equal(disclosure.buttonLabel, '텍스트 추출', route);
    assert.match(disclosure.message, /50MB/u, route);
    assert.match(disclosure.message, /시간/u, route);
  }
});

test('shows the shared row and cell guidance only for local Excel uploads', () => {
  assert.equal(typeof preprocessLimits.getUploadPreprocessLimitGuidance, 'function');

  assert.equal(
    preprocessLimits.getUploadPreprocessLimitGuidance('local-excel'),
    '시트당 20,000행·300,000셀을 초과하면 파일을 나눠 처리해 주세요.',
  );
  assert.equal(preprocessLimits.getUploadPreprocessLimitGuidance('local-text'), null);
  assert.equal(preprocessLimits.getUploadPreprocessLimitGuidance('local-docx'), null);
  assert.equal(preprocessLimits.getUploadPreprocessLimitGuidance('miso'), null);
  assert.equal(preprocessLimits.getUploadPreprocessLimitGuidance(null), null);
  assert.equal(
    preprocessLimits.EXCEL_PREPROCESS_HELP_GUIDANCE,
    '파일 용량과 별도로 시트당 20,000행·300,000셀을 초과하면 파일을 나눠 처리해 주세요.',
  );
});

test('upload and guide UI consume the shared selected-route disclosure', () => {
  const pageSource = readFileSync(
    fileURLToPath(new URL('../app/page.tsx', import.meta.url)),
    'utf8',
  );
  const guideSource = readFileSync(
    fileURLToPath(new URL('../components/usage-guide.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(pageSource, /getFileProcessingRoute\(file\.name\)/u);
  assert.match(pageSource, /getFileProcessingDisclosure/u);
  assert.match(pageSource, /selectedFileDisclosure\.message/u);
  assert.doesNotMatch(pageSource, /selectedFileDisclosure\.buttonLabel/u);
  assert.match(pageSource, /2\. 텍스트 추출 확인/u);
  assert.match(pageSource, /3\. 전처리 설정/u);
  assert.doesNotMatch(pageSource, /MISO 구분자:/u);
  assert.doesNotMatch(pageSource, /MISO 최대 길이:/u);
  assert.doesNotMatch(pageSource, /앱 안전 상한:/u);
  assert.match(guideSource, /LOCAL_DOCX_EXTENSIONS/u);
  assert.match(guideSource, /transmissionLabel/u);
});
