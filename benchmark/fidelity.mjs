/**
 * Verifies that editing one line leaves the rest of a Markdown file byte-for-byte unchanged.
 * Usage: npm run benchmark:fidelity
 * Set QUIREKIT_LOCAL to test against a QuireKit checkout.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bundleOptions } from '../scripts/bundle-options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build', 'benchmark');
const ORIGIN = 'http://benchmark.invalid';
const VIEWS = ['document', 'preview', 'source'];
const EDIT_AFTER = 'Edit this line.';

/** Valid Markdown written in forms that editors often normalize away. */
const SOURCE = [
  'Setext Title', '============', '',
  '__bold__ and _italic_ with two trailing spaces  ', 'next line of the same paragraph', '',
  EDIT_AFTER, '',
  '* star item', '* another', '', '+ plus item', '', '1) parenthesis item', '2) second', '',
  '|a|  b |', '|:-|--:|', '|1 |2|', '',
  '~~~js', 'const tilde = "fence"', '~~~', '',
  '    indented code', '',
  '<div align="center">raw html</div>', '',
  '> quote without a space after the second line', '>continued', '',
  '\\* escaped star and &amp; entity', '', '***', '', '___', '',
  '- [ ] task', '- [X] upper-case done', '',
  'A [reference][Ref] and <https://example.org>.', '',
  '[Ref]:   https://example.org   "Title"', '',
  'Last line without a final newline',
].join('\n');

await build({ ...bundleOptions, entryPoints: ['benchmark/page.js'], outfile: join(out, 'page.js'), format: 'iife' });
const browser = await chromium.launch();
let failed = false;
for (const view of VIEWS) {
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
  await page.route(`${ORIGIN}/**`, route => route.fulfill(new URL(route.request().url()).pathname === '/'
    ? { contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css"><div id="editor" style="height:100vh;overflow:auto"></div><script src="/page.js"></script>' }
    : { path: join(out, new URL(route.request().url()).pathname) }));
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(([markdown, mode]) => window.openDocument(markdown, mode), [SOURCE, view]);
  await page.waitForTimeout(1000);
  const opened = await page.evaluate(() => window.benchmark.editor.getMarkdown());
  const position = SOURCE.indexOf(EDIT_AFTER) + EDIT_AFTER.length;
  await page.evaluate(offset => window.placeCaret(offset), position);
  await page.waitForTimeout(200);
  await page.keyboard.type('!');
  await page.waitForFunction(() => window.benchmark.updates.length > 0);
  const edited = await page.evaluate(() => window.benchmark.editor.getMarkdown());
  const expected = `${SOURCE.slice(0, position)}!${SOURCE.slice(position)}`;
  const passed = opened === SOURCE && edited === expected;
  failed ||= !passed;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${view}: ${SOURCE.length} characters, one character inserted, everything else identical`);
  if (!passed) console.log({ openedSame: opened === SOURCE, editedLength: edited.length, expectedLength: expected.length });
  await page.close();
}
await browser.close();
process.exitCode = failed ? 1 : 0;
