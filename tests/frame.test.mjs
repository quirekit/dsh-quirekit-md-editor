import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serveEditorFrame } from '../src/host/frame.js';

const frameDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'frame');

/**
 * Run the handler against a minimal response.
 * @param {string} url - request path.
 * @param {string} [method] - request method.
 * @returns {Promise<{ status: number, headers: object, body: unknown }>} what was sent.
 */
async function request(url, method = 'GET') {
  const sent = { status: 0, headers: {}, body: undefined };
  await serveEditorFrame({ url, method }, {
    writeHead(status, headers = {}) { sent.status = status; sent.headers = headers; },
    end(body) { sent.body = body; },
  });
  return sent;
}

test('serves the editor files under a versioned path', async (t) => {
  mkdirSync(frameDirectory, { recursive: true });
  const entry = join(frameDirectory, 'index.html');
  const built = existsSync(entry) ? readFileSync(entry) : undefined;
  t.after(() => (built === undefined ? rmSync(entry) : writeFileSync(entry, built)));
  writeFileSync(entry, '<!doctype html>');
  const page = await request('/dsh-quirekit-md-editor/frame/abc123/index.html');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.headers['cache-control'], /immutable/);
  assert.equal(String(page.body), '<!doctype html>');
});

test('serves the chunks the editor imports on demand', async (t) => {
  mkdirSync(frameDirectory, { recursive: true });
  const chunk = join(frameDirectory, 'chunk-TEST0000.js');
  t.after(() => rmSync(chunk, { force: true }));
  writeFileSync(chunk, 'export {};');
  const sent = await request('/dsh-quirekit-md-editor/frame/abc123/chunk-TEST0000.js');
  assert.equal(sent.status, 200);
  assert.match(sent.headers['content-type'], /text\/javascript/);
  assert.equal(String(sent.body), 'export {};');
});

test('answers nothing but plain files in the frame directory', async () => {
  for (const url of ['/dsh-quirekit-md-editor/frame/abc/client.js', '/dsh-quirekit-md-editor/frame/abc/..%2F..%2Fpackage.json', '/dsh-quirekit-md-editor/frame/abc/constructor', '/dsh-quirekit-md-editor/frame/abc/chunk-MISSING.js', '/dsh-quirekit-md-editor/frame/abc/.hidden.js']) {
    assert.equal((await request(url)).status, 404, url);
  }
  assert.equal((await request('/dsh-quirekit-md-editor/frame/abc/index.html', 'POST')).status, 404);
});
