import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { getResultPresentation } from './result-presentation.ts';

test('maps processing status to simple Korean guidance', () => {
  assert.deepEqual(getResultPresentation('ready'), {
    label: 'MISO 등록 가능',
    tone: 'success',
    allowMisoDownload: true,
  });
  assert.deepEqual(getResultPresentation('review'), {
    label: '원문 확인 필요',
    tone: 'warning',
    allowMisoDownload: true,
  });
  assert.deepEqual(getResultPresentation('blocked'), {
    label: '오류 확인 필요',
    tone: 'destructive',
    allowMisoDownload: false,
  });
});

test('renders the result summary at the top of the output review card', async () => {
  const pagePath = fileURLToPath(new URL('../app/page.tsx', import.meta.url));
  const page = await readFile(pagePath, 'utf8');

  assert.match(
    page,
    /import\s+\{\s*PreprocessResultSummary\s*\}\s+from\s+['"]@\/components\/preprocess-result-summary['"];/,
  );
  assert.match(
    page,
    /<CardContent className="space-y-4">\s*\{result && <PreprocessResultSummary result=\{result\}\s*\/?>\}/,
  );
});
