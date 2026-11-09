import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commentsAddress, commentsHeading, commentsRequest, pendingComments, selectionQuote, sessionFilePath } from '../src/client/prompts.js';
import { createCommentOperations } from '../src/host/comments.js';
import { createResolveCommentTool } from '../src/host/tool.js';

const ADDRESS = 'dsh-resource://file/session/s1/notes/a.md';
const SIDECAR = 'notes/.a.md.comments.json';

/**
 * @param {Record<string, string>} files - initial files.
 * @param {string} [mode] - sandbox mode.
 * @returns {object} comment operations and the file map.
 */
function setup(files, mode = 'workspace-write') {
  const fs = {
    resolve: async path => ({ targetKey: path }),
    contains: (root, target) => root.targetKey === '/w' && !target.targetKey.startsWith('/'),
    lstat: async (path) => {
      if (path === 'notes/a.md' || files[path] !== undefined) return { type: path.includes('link') ? 'symlink' : 'file' };
      throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' });
    },
    readText: async (target) => {
      if (files[target.targetKey] === undefined) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' });
      return files[target.targetKey];
    },
    writeText: async (target, text) => { files[target.targetKey] = text; },
  };
  const operations = createCommentOperations({
    fs,
    sessions: { get: () => ({ header: { cwd: '/w' } }) },
    sandboxPolicy: { resolve: () => ({ mode }) },
  });
  return { ...operations, files };
}

test('reads nothing when the comment file is missing or damaged', async () => {
  assert.equal(await setup({}).read(ADDRESS), null);
  assert.equal(await setup({ [SIDECAR]: '{broken' }).read(ADDRESS), null);
});

test('saves beside the document and reads it back', async () => {
  const { save, read, files } = setup({});
  assert.deepEqual(await save({ address: ADDRESS, comments: { threads: [] } }), { ok: true });
  assert.ok(files[SIDECAR]);
  assert.deepEqual(await read(ADDRESS), { threads: [] });
});

test('refuses read-only sessions and a comment path that is not a regular file', async () => {
  assert.equal((await setup({}, 'read-only').save({ address: ADDRESS, comments: {} })).code, 'sandbox-denied');
  const linked = 'dsh-resource://file/session/s1/notes/link.md';
  const { save } = setup({ 'notes/link.md': '# a', 'notes/.link.md.comments.json': '{}' });
  assert.equal((await save({ address: linked, comments: {} })).code, 'sandbox-denied');
});

test('a selection quote names its file and lines', () => {
  assert.equal(selectionQuote('a.md', 3, 3, 'x'), 'a.md:3\nx');
  assert.equal(selectionQuote('a.md', 3, 5, 'x'), 'a.md:3-5\nx');
  assert.equal(selectionQuote('a.md', 3, 5, 'x\n\n'), 'a.md:3\nx');
});

test('resolving marks threads on disk and hands them to the editor once', async () => {
  const stored = JSON.stringify({ threads: [{ id: 'a', resolved: false, messages: [] }, { id: 'b', resolved: false, messages: [] }] });
  const { resolve, takeResolved, files } = setup({ [SIDECAR]: stored });
  assert.deepEqual(await resolve({ address: ADDRESS, ids: ['a', 'missing'] }), { resolved: ['a'], unknown: ['missing'] });
  const [a, b] = JSON.parse(files[SIDECAR]).threads;
  assert.equal(a.resolved, true);
  assert.deepEqual(a.resolvedBy, { id: 'dsh-agent', name: 'DSH', agent: true });
  assert.equal(b.resolved, false);
  assert.deepEqual(takeResolved(ADDRESS), ['a']);
  assert.deepEqual(takeResolved(ADDRESS), []);
});

test('resolving is refused on a read-only session', async () => {
  const { resolve } = setup({ [SIDECAR]: '{"threads":[]}' }, 'read-only');
  await assert.rejects(resolve({ address: ADDRESS, ids: ['a'] }), { code: 'sandbox-denied' });
});

test('the resolve tool addresses the file in the calling Session', async () => {
  const calls = [];
  const tool = createResolveCommentTool({ resolve: async (request) => { calls.push(request); return { resolved: request.ids, unknown: [] }; } });
  await tool.execute({ file: 'notes/my a.md', comment_ids: ['a'] }, { agent: { session: { id: 's 1' } } });
  assert.equal(calls[0].address, 'dsh-resource://file/session/s%201/notes/my%20a.md');
  await assert.rejects(tool.execute({ file: 'a.md', comment_ids: 'a' }, { agent: { session: { id: 's' } } }));
});

test('the comment file address sits beside the document', () => {
  assert.equal(commentsAddress('dsh-resource://file/session/s1/notes/a.md?x=1'), 'dsh-resource://file/session/s1/notes/.a.md.comments.json');
});

test('a session address reads as a workspace path', () => {
  assert.equal(sessionFilePath('dsh-resource://file/session/s1/notes/my%20a.md?x=1'), 'notes/my a.md');
});

test('the request heading names the document and its comment file', () => {
  assert.equal(commentsHeading('Edit {file}, not {comments}; then {file}', 'notes/$&.md'), 'Edit notes/$&.md, not .$&.md.comments.json; then notes/$&.md');
});

test('the comment request sends actionable threads with their lines', () => {
  const placed = (id, from, exact, body) => ({ status: 'placed', range: { from }, thread: { id, resolved: false, anchor: { quote: { exact } }, messages: body.map(text => ({ body: text })) } });
  const views = [
    placed('t2', 40, 'later\n', ['second']),
    placed('t1', 4, 'old text\n', ['fix this', 'and that']),
    { status: 'placed', range: { from: 9 }, thread: { resolved: true, anchor: { quote: { exact: 'done' } }, messages: [{ body: 'ok' }] } },
    { status: 'orphaned', range: null, thread: { resolved: false, anchor: { quote: { exact: 'gone' } }, messages: [{ body: 'lost' }] } },
    { status: 'document', range: null, thread: { id: 't3', resolved: false, messages: [{ body: 'tighten it' }] } },
  ];
  const comments = pendingComments(views, position => position + 1);
  assert.equal(
    commentsRequest('Apply:', 'Whole document', comments),
    'Apply:\n\n1. [t3] Whole document: tighten it\n2. [t1] L5 「old text」: fix this / and that\n3. [t2] L41 「later」: second',
  );
});
