/**
 * Measures typing latency of the editor this plugin runs, in Chromium.
 * Usage: npm run benchmark [-- --inputs 200 --output results.json]
 * Set QUIREKIT_LOCAL to test against a QuireKit checkout.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { bundleOptions } from '../scripts/bundle-options.mjs';
import { createDocument } from './fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build', 'benchmark');
const ORIGIN = 'http://benchmark.invalid';
/** Long-form documents at two sizes, plus a structure-heavy worst case. */
const CASES = [{ profile: 'prose', characters: 100_000 }, { profile: 'prose', characters: 1_000_000 }, { profile: 'dense', characters: 1_000_000 }];
const VIEWS = [['document', 'Visual'], ['preview', 'Markup'], ['source', 'Source']];
/** Lets background parsing and first-paint work finish before measuring. */
const SETTLE_MS = 3000;

const { values } = parseArgs({ options: { inputs: { type: 'string', default: '200' }, output: { type: 'string' } } });
const inputs = Number(values.inputs);

/**
 * @param {readonly number[]} samples - raw milliseconds, cold inputs included.
 * @returns {Record<string, number>} nearest-rank percentiles rounded to 0.1 ms.
 */
function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = percent => Math.round(sorted[Math.ceil(sorted.length * percent) - 1] * 10) / 10;
  return { p50: rank(0.5), p90: rank(0.9), p95: rank(0.95), p99: rank(0.99), max: rank(1) };
}

/**
 * Measure one document in one editing mode.
 * @param {import('playwright').Browser} browser - shared browser.
 * @param {{ profile: 'prose' | 'dense', characters: number }} scenario - document to measure.
 * @param {string} view - editing mode.
 * @returns {Promise<{ open: number, update: Record<string, number>, paint: Record<string, number> }>} timings.
 */
async function measure(browser, { profile, characters }, view) {
  // The width matches the DeepSeek Harness sidebar with the comment rail available.
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
  await page.route(`${ORIGIN}/**`, route => route.fulfill(new URL(route.request().url()).pathname === '/'
    ? { contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css"><div id="editor" style="height:100vh;overflow:auto"></div><script src="/page.js"></script>' }
    : { path: join(out, new URL(route.request().url()).pathname) }));
  await page.goto(`${ORIGIN}/`);
  const { source, position } = createDocument(characters, profile);
  const open = await page.evaluate(([markdown, mode]) => window.openDocument(markdown, mode), [source, view]);
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(offset => window.placeCaret(offset), position);
  await page.waitForTimeout(300);
  for (let count = 1; count <= inputs; count += 1) {
    await page.keyboard.press('x');
    await page.waitForFunction(expected => window.benchmark.paints.length === expected, count);
  }
  const samples = await page.evaluate(() => ({ updates: window.benchmark.updates, paints: window.benchmark.paints, text: window.benchmark.editor.getMarkdown() }));
  const expected = source.slice(0, position) + 'x'.repeat(inputs) + source.slice(position);
  if (samples.text !== expected) throw new Error(`Typed text did not land correctly in ${view}.`);
  if (samples.updates.length !== inputs) throw new Error(`Expected ${inputs} updates, saw ${samples.updates.length}.`);
  await page.close();
  return { open: Math.round(open), update: summarize(samples.updates), paint: summarize(samples.paints) };
}

mkdirSync(out, { recursive: true });
await build({ ...bundleOptions, entryPoints: ['benchmark/page.js'], outfile: join(out, 'page.js'), format: 'iife' });
const browser = await chromium.launch();
const results = [];
for (const scenario of CASES) {
  for (const [view, mode] of VIEWS) {
    const timing = await measure(browser, scenario, view);
    results.push({ ...scenario, mode, inputs, ...timing });
    console.log(`${scenario.profile} ${scenario.characters.toLocaleString('en-US')} chars, ${mode}: update p50 ${timing.update.p50} ms, p95 ${timing.update.p95} ms`);
  }
}
const report = { measuredAt: new Date().toISOString(), browser: browser.version(), cpu: cpus()[0]?.model, os: `${platform()} ${release()}`, results };
await browser.close();

const row = result => [result.profile, result.characters.toLocaleString('en-US'), result.mode, `${result.open} ms`,
  ...['p50', 'p90', 'p95', 'p99'].map(key => result.update[key]), ...['p50', 'p95'].map(key => result.paint[key])];
console.log(`\n${report.cpu}, ${report.os}, Chromium ${report.browser}, ${inputs} keystrokes per row\n`);
console.log('| Document | Characters | Mode | Open | Update p50 | p90 | p95 | p99 | Paint p50 | Paint p95 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const result of results) console.log(`| ${row(result).join(' | ')} |`);
const output = values.output === undefined ? join(out, 'results.json') : resolve(values.output);
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nSaved ${output}`);
