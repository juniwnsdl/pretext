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

test('skips unknown and unsafe subtrees while preserving allowlisted inline text', () => {
  const { blocks } = parseMammothHtml(
    '<script>steal()</script><style>.secret{}</style><img src="file:///secret" alt="secret"/>' +
      '<object><p>object secret</p></object><iframe><p>iframe secret</p></iframe>' +
      '<template><p>template secret</p></template><svg><text><p>svg secret</p></text></svg>' +
      '<mystery><p>unknown secret</p></mystery>' +
      '<p>Keep <span>span <strong>strong</strong> <em>em</em> ' +
      '<a href="https://example.test">link</a></span>' +
      '<mystery> inline unknown secret</mystery>.</p><h3>Safe heading</h3>',
    'safe.docx',
  );

  assert.deepEqual(blocks.map((block) => [block.kind, block.text]), [
    ['paragraph', 'Keep span strong em link.'],
    ['heading', 'Safe heading'],
  ]);
  assert.equal(JSON.stringify(blocks).includes('steal'), false);
  assert.equal(JSON.stringify(blocks).includes('secret'), false);
  for (const secret of [
    'object secret', 'iframe secret', 'template secret', 'svg secret', 'unknown secret',
    'inline unknown secret',
  ]) {
    assert.equal(JSON.stringify(blocks).includes(secret), false);
  }
});

test('preserves br boundaries in paragraphs, list items, and table cells', () => {
  const { blocks } = parseMammothHtml(
    '<p>Line A<br/>Line B.</p><ul><li>Step A<br/>Step B</li></ul>' +
      '<table><tr><td>Cell A<br/>Cell B</td><td></td></tr></table>',
    'breaks.docx',
  );

  assert.equal(blocks[0].text, 'Line A\nLine B.');
  assert.equal(blocks[1].text, 'Step A\nStep B');
  assert.deepEqual(blocks[2].rows, [['Cell A\nCell B', '']]);
});

test('returns parser warnings for usable recovered content and rejects error or fatal diagnostics', () => {
  const recovered = parseMammothHtml(
    '<p>Keep this</p><p>discarded by recovery</div>',
    'warning.docx',
  );

  assert.deepEqual(recovered.blocks.map((block) => block.text), ['Keep this']);
  assert.equal(recovered.warnings.length, 1);
  assert.equal(recovered.warnings[0].code, 'DOCX_PARSE_WARNING');
  assert.match(recovered.warnings[0].message, /unclosed|mismatch|parser/i);

  assert.throws(
    () => parseMammothHtml('<p>Unknown &bogus; entity</p>', 'error.docx'),
    /parse|parser|entity|error/i,
  );
  assert.throws(
    () => parseMammothHtml('<p>Case mismatch</P>', 'fatal.docx'),
    /parse|parser|mismatch|fatal/i,
  );
});

test('expands rowspan and colspan into a rectangular grid with merge metadata', () => {
  const { blocks } = parseMammothHtml(
    '<table>' +
      '<tr><th rowspan="2">Asset</th><th colspan="2">Checks</th><th></th></tr>' +
      '<tr><td>Valve</td><td>Pump</td><td>Tail</td></tr>' +
      '<tr><td rowspan="2" colspan="2">Combined</td><td>State</td><td>Note</td></tr>' +
      '<tr><td>Ready</td><td></td></tr>' +
      '</table>',
    'spans.docx',
  );

  assert.deepEqual(blocks[0].rows, [
    ['Asset', 'Checks', '', ''],
    ['', 'Valve', 'Pump', 'Tail'],
    ['Combined', '', 'State', 'Note'],
    ['', '', 'Ready', ''],
  ]);
  assert.deepEqual(blocks[0].merges, [
    { range: 'A1:A2', start: { row: 0, column: 0 }, end: { row: 1, column: 0 } },
    { range: 'B1:C1', start: { row: 0, column: 1 }, end: { row: 0, column: 2 } },
    { range: 'A3:B4', start: { row: 2, column: 0 }, end: { row: 3, column: 1 } },
  ]);
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
