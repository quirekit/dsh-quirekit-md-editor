import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createImageOperations } from '../src/host/images.js';

const ADDRESS = 'dsh-resource://file/session/s1/notes/a.md';
let workspace;
let mode;

/**
 * Build operations over a real temporary workspace.
 * @returns {object} image operations.
 */
function operations() {
  return createImageOperations({
    fs: {
      resolve: async (path, options) => ({ targetKey: resolve(options?.cwd ?? '/', path) }),
      contains: (root, target) => target.targetKey.startsWith(`${root.targetKey}/`),
      lstat: async () => ({ type: 'file' }),
      stat: async target => readFile(target.targetKey).then(bytes => ({ type: 'file', size: bytes.length }), () => undefined),
      readBytes: async target => new Uint8Array(await readFile(target.targetKey)),
      fileUrl: target => pathToFileURL(target.targetKey).href,
    },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
    sandboxPolicy: { workspaceRoot: workspace, resolve: () => ({ mode }) },
  });
}

beforeEach(async () => {
  mode = 'workspace-write';
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'dsh-md-images-')));
  await mkdir(join(workspace, 'notes', 'img'), { recursive: true });
  await writeFile(join(workspace, 'notes', 'a.md'), '# a\n');
  await writeFile(join(workspace, 'notes', 'img', 'a.png'), Uint8Array.of(1, 2, 3));
  await writeFile(join(workspace, 'secret.txt'), 'secret');
});
afterEach(() => rm(workspace, { recursive: true, force: true }));

test('reads an image relative to the document', async () => {
  const result = await operations().read({ address: ADDRESS, url: 'img/a.png?x=1' });
  assert.deepEqual([result.ok, result.type, [...result.bytes]], [true, 'image/png', [1, 2, 3]]);
});

test('refuses remote URLs and files that are not images', async () => {
  const { read } = operations();
  assert.equal((await read({ address: ADDRESS, url: 'https://example.com/a.png' })).code, 'unsupported-image');
  assert.equal((await read({ address: ADDRESS, url: '../secret.txt' })).code, 'unsupported-image');
  assert.equal((await read({ address: ADDRESS, url: join(workspace, 'secret.txt') })).code, 'unsupported-image');
});

test('reads screenshots outside the workspace by absolute or relative path', async () => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'dsh-md-shot-')));
  await writeFile(join(outside, 'shot.png'), Uint8Array.of(7));
  const { read } = operations();
  for (const url of [join(outside, 'shot.png'), relative(join(workspace, 'notes'), join(outside, 'shot.png'))]) {
    assert.deepEqual([...(await read({ address: ADDRESS, url })).bytes], [7], url);
  }
  await rm(outside, { recursive: true });
});

test('a slash-rooted path prefers the workspace over the disk', async () => {
  const result = await operations().read({ address: ADDRESS, url: '/notes/img/a.png' });
  assert.deepEqual([...result.bytes], [1, 2, 3]);
});

test('stores a pasted image beside the document and reuses identical content', async () => {
  const { store } = operations();
  const bytes = Uint8Array.of(9, 8, 7);
  const first = await store({ address: ADDRESS, bytes, type: 'image/png' });
  const second = await store({ address: ADDRESS, bytes, type: 'image/png' });
  assert.match(first.url, /^assets\/[0-9a-f]{16}\.png$/u);
  assert.equal(second.url, first.url);
  assert.deepEqual([...await readFile(join(workspace, 'notes', first.url))], [9, 8, 7]);
  assert.equal((await readdir(join(workspace, 'notes', 'assets'))).length, 1);
});

test('refuses read-only sessions, unsafe types and an assets link leaving the workspace', async () => {
  const { store } = operations();
  const bytes = Uint8Array.of(1);
  assert.equal((await store({ address: ADDRESS, bytes, type: 'image/svg+xml' })).code, 'unsupported-image');
  const outside = await mkdtemp(join(tmpdir(), 'dsh-md-outside-'));
  await symlink(outside, join(workspace, 'notes', 'assets'));
  assert.equal((await store({ address: ADDRESS, bytes, type: 'image/png' })).code, 'outside-workspace');
  assert.deepEqual(await readdir(outside), []);
  await rm(outside, { recursive: true });
  mode = 'read-only';
  assert.equal((await store({ address: ADDRESS, bytes, type: 'image/png' })).code, 'sandbox-denied');
});
