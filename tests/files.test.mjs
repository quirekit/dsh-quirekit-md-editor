import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFileOperations, parseSessionFileAddress } from '../src/host/files.js';

const ADDRESS = 'dsh-resource://file/session/s1/notes/a%20b.md';

/**
 * Build an in-memory filesystem service with the DSH version-guard contract.
 * @param {Record<string, string>} files - initial files by workspace path.
 * @returns {{ fs: any, files: Record<string, string>, bump: (path: string, text: string) => void }} the fake.
 */
function memoryFs(files) {
  const versions = Object.fromEntries(Object.keys(files).map(path => [path, 'v1']));
  let next = 2;
  const fs = {
    resolve: async path => ({ targetKey: path, displayPath: path }),
    contains: (root, target) => root.targetKey === '/w' && !target.targetKey.startsWith('/'),
    stat: async (target) => ({ type: 'file', version: versions[target.targetKey], size: files[target.targetKey].length }),
    lstat: async path => ({ type: path === 'link.md' ? 'symlink' : 'file' }),
    readText: async target => files[target.targetKey].replace(/^﻿/, ''),
    readByteRange: async target => (files[target.targetKey].startsWith('﻿') ? Uint8Array.of(0xef, 0xbb, 0xbf) : Uint8Array.of(0x23, 0x20, 0x61)),
    writeText: async (target, text, intent) => {
      if (versions[target.targetKey] !== intent.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' });
      files[target.targetKey] = text;
      versions[target.targetKey] = `v${next++}`;
      return { operation: 'update', version: versions[target.targetKey] };
    },
  };
  return { fs, files, bump: (path, text) => { files[path] = text; versions[path] = `v${next++}`; } };
}

/**
 * Build file operations over a fake filesystem and one live session.
 * @param {Record<string, string>} files - initial files.
 * @param {string} [mode] - sandbox mode.
 * @returns {object} operations and the fake.
 */
function setup(files, mode = 'workspace-write') {
  const memory = memoryFs(files);
  const policies = [];
  const operations = createFileOperations({
    fs: memory.fs,
    sessions: { get: id => (id === 's1' ? { header: { cwd: '/w' } } : undefined) },
    sandboxPolicy: { workspaceRoot: '/fallback', resolve: (input) => { policies.push(input); return { mode }; } },
  });
  return { ...operations, ...memory, policies };
}

test('address decoding keeps the session and encoded path', () => {
  assert.deepEqual(parseSessionFileAddress(ADDRESS), { sessionId: 's1', path: 'notes/a b.md' });
  assert.throws(() => parseSessionFileAddress('dsh-resource://file/absolute/etc/hosts'), { code: 'unsupported-address' });
});

test('open returns the text with its version and restores a dropped BOM', async () => {
  const { open } = setup({ 'notes/a b.md': '﻿# a\r\n' });
  assert.deepEqual(await open({ address: ADDRESS }), { ok: true, text: '﻿# a\r\n', version: 'v1', writable: true });
});

test('open refuses mixed line endings the editor cannot round-trip', async () => {
  const { open } = setup({ 'notes/a b.md': '# a\r\nb\nc\n' });
  assert.equal((await open({ address: ADDRESS })).code, 'mixed-line-endings');
});

test('open reports read-only for a read-only session and files outside the workspace', async () => {
  const readOnly = setup({ 'notes/a b.md': '# a\n' }, 'read-only');
  assert.equal((await readOnly.open({ address: ADDRESS })).writable, false);
  const outside = setup({ '/etc/x.md': '# a\n' });
  assert.equal((await outside.open({ address: 'dsh-resource://file/session/s1//etc/x.md' })).writable, false);
});

test('open reports a file that no longer exists', async () => {
  const { open, fs } = setup({ 'notes/a b.md': '# a\n' });
  fs.stat = async () => undefined;
  assert.equal((await open({ address: ADDRESS })).code, 'not-found');
});

test('save carries the session policy and returns the next version', async () => {
  const { open, save, files, policies } = setup({ 'notes/a b.md': '# a\n' });
  const { version } = await open({ address: ADDRESS });
  assert.deepEqual(await save({ address: ADDRESS, text: '# b\n', baseVersion: version }), { ok: true, version: 'v2' });
  assert.equal(files['notes/a b.md'], '# b\n');
  assert.ok(policies[0].session);
});

test('a save based on an older version reports a conflict and leaves the file alone', async () => {
  const { open, save, files, bump } = setup({ 'notes/a b.md': '# a\n' });
  const { version } = await open({ address: ADDRESS });
  bump('notes/a b.md', '# agent\n');
  const result = await save({ address: ADDRESS, text: '# mine\n', baseVersion: version });
  assert.equal(result.code, 'conflict');
  assert.equal(files['notes/a b.md'], '# agent\n');
});

test('saves refuse symlinks, paths outside the workspace and unknown sessions', async () => {
  const { save } = setup({ 'link.md': '# a\n', '/etc/x.md': '# a\n' });
  const of = path => `dsh-resource://file/session/s1/${path}`;
  assert.equal((await save({ address: of('link.md'), text: 'x', baseVersion: 'v1' })).code, 'outside-workspace');
  assert.equal((await save({ address: of('/etc/x.md'), text: 'x', baseVersion: 'v1' })).code, 'outside-workspace');
  assert.equal((await save({ address: 'dsh-resource://file/session/none/a.md', text: 'x', baseVersion: 'v1' })).code, 'unknown-session');
});
