import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractDocxDocument,
  parseMammothHtml,
} from './docx-extractor.ts';

test('extracts semantic DOCX blocks in source order and translates converter warnings', async () => {
  let converterInput;
  let converterOptions;
  const fakeConverter = async (input, options) => {
    converterInput = input;
    converterOptions = options;
    return {
      value: '<h1>Maintenance Procedure</h1><p>Disconnect the power.</p>' +
        '<ol><li>Check the valve</li></ol>' +
        '<table><tr><th>Equipment</th><th>Status</th></tr>' +
        '<tr><td>Pump</td><td>Normal</td></tr></table>',
      messages: [{ type: 'warning', message: 'Sample warning' }],
    };
  };
  const buffer = new ArrayBuffer(3);

  const document = await extractDocxDocument(buffer, 'maintenance.DOCX', fakeConverter);

  assert.deepEqual(converterInput, { arrayBuffer: buffer });
  assert.deepEqual(converterOptions, { externalFileAccess: false });
  assert.equal(document.sourceFormat, 'docx');
  assert.equal(document.extractionMethod, 'local-docx');
  assert.deepEqual(document.blocks.map((block) => block.kind), [
    'heading', 'paragraph', 'list-item', 'table',
  ]);
  assert.deepEqual(document.blocks.map((block) => block.order), [0, 1, 2, 3]);
  assert.deepEqual(document.blocks[3].rows, [
    ['Equipment', 'Status'],
    ['Pump', 'Normal'],
  ]);
  assert.deepEqual(document.warnings, [{
    code: 'DOCX_CONVERSION_WARNING',
    severity: 'warning',
    message: 'Sample warning',
  }]);
});

test('tracks heading paths and nested ordered and unordered list metadata', () => {
  const { blocks } = parseMammothHtml(
    '<h1>Manual</h1><p>Introduction</p><h2>Safety</h2>' +
      '<ol><li>Stop<ul><li>Lock out</li><li>Tag out<ol><li>Verify</li></ol></li></ul></li></ol>' +
      '<h1>Appendix</h1><p>Reference</p>',
    'manual.docx',
  );

  assert.deepEqual(blocks.map((block) => ({
    kind: block.kind,
    text: block.text,
    headingPath: block.headingPath,
    depth: block.depth,
    ordered: block.ordered,
  })), [
    { kind: 'heading', text: 'Manual', headingPath: ['Manual'], depth: undefined, ordered: undefined },
    { kind: 'paragraph', text: 'Introduction', headingPath: ['Manual'], depth: undefined, ordered: undefined },
    { kind: 'heading', text: 'Safety', headingPath: ['Manual', 'Safety'], depth: undefined, ordered: undefined },
    { kind: 'list-item', text: 'Stop', headingPath: ['Manual', 'Safety'], depth: 0, ordered: true },
    { kind: 'list-item', text: 'Lock out', headingPath: ['Manual', 'Safety'], depth: 1, ordered: false },
    { kind: 'list-item', text: 'Tag out', headingPath: ['Manual', 'Safety'], depth: 1, ordered: false },
    { kind: 'list-item', text: 'Verify', headingPath: ['Manual', 'Safety'], depth: 2, ordered: true },
    { kind: 'heading', text: 'Appendix', headingPath: ['Appendix'], depth: undefined, ordered: undefined },
    { kind: 'paragraph', text: 'Reference', headingPath: ['Appendix'], depth: undefined, ordered: undefined },
  ]);
});

test('emits table cell paragraphs only as one table block', () => {
  const { blocks } = parseMammothHtml(
    '<p>Before</p><table><tr><td><p>Pump</p><p>Primary</p></td><td>Ready</td></tr></table><p>After</p>',
    'table.docx',
  );

  assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'table', 'paragraph']);
  assert.deepEqual(blocks[1].rows, [['Pump Primary', 'Ready']]);
  assert.equal(blocks.filter((block) => block.kind === 'paragraph').length, 2);
});

test('omits unsafe and unknown content while preserving safe inline text and semantic descendants', () => {
  const { blocks } = parseMammothHtml(
    '<script>steal()</script><style>.secret{}</style><img src="file:///secret" alt="secret"/>' +
      '<div>loose text<p>Keep <strong>useful</strong>.<img src="https://example.test/x"/></p></div>' +
      '<object>hidden</object><h3>Safe heading</h3>',
    'safe.docx',
  );

  assert.deepEqual(blocks.map((block) => [block.kind, block.text]), [
    ['paragraph', 'Keep useful.'],
    ['heading', 'Safe heading'],
  ]);
  assert.equal(JSON.stringify(blocks).includes('steal'), false);
  assert.equal(JSON.stringify(blocks).includes('secret'), false);
  assert.equal(JSON.stringify(blocks).includes('hidden'), false);
  assert.equal(JSON.stringify(blocks).includes('loose text'), false);
});

test('supports an injected parser and rejects extraction with no usable blocks', async () => {
  let parsedSource = '';
  const parser = {
    parseFromString(source) {
      parsedSource = source;
      return {
        documentElement: {
          childNodes: [],
        },
      };
    },
  };

  assert.throws(
    () => parseMammothHtml('<script>only unsafe content</script>', 'empty.docx', parser),
    /usable|content|empty/i,
  );
  assert.match(parsedSource, /^<docx-root>/);

  await assert.rejects(
    extractDocxDocument(new ArrayBuffer(0), 'empty.docx', async () => ({
      value: '<style>body{display:none}</style>',
      messages: [],
    })),
    /usable|content|empty/i,
  );
});
