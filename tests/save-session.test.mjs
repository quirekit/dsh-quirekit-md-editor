import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSaveSession } from '../src/client/save-session.js';

/**
 * Build a session whose editor and host are plain objects.
 * @param {(endpoint: string, payload: any) => any} respond - host reply.
 * @returns {object} session, editor buffer, statuses and recorded calls.
 */
function setup(respond) {
  const state = { text: '# a\n', statuses: [], calls: [] };
  const session = createSaveSession({
    address: 'addr', text: '# a\n', version: 'v1',
    call: async (endpoint, payload) => { state.calls.push({ endpoint, payload }); return respond(endpoint, payload); },
    read: () => state.text,
    replace: (text) => { state.text = text; },
    onStatus: status => state.statuses.push(status),
  });
  return { session, state };
}

test('an unchanged document never writes', async () => {
  const { session, state } = setup(() => assert.fail('no call expected'));
  await session.flush();
  assert.deepEqual(state.calls, []);
});

test('a save advances the base version for the next save', async () => {
  let n = 1;
  const { session, state } = setup(() => ({ ok: true, version: `v${++n}` }));
  state.text = '# b\n';
  await session.flush();
  state.text = '# c\n';
  await session.flush();
  assert.deepEqual(state.calls.map(call => call.payload.baseVersion), ['v1', 'v2']);
});

test('its own write echoing back does not touch the editor', async () => {
  const { session, state } = setup(() => ({ ok: true, version: 'v2' }));
  state.text = '# b\n';
  await session.flush();
  session.reconcile('# stale\n', 'v2');
  assert.equal(state.text, '# b\n');
});

test('an external change replaces a clean editor', () => {
  const { session, state } = setup(() => assert.fail('no call expected'));
  session.reconcile('# agent\n', 'v9');
  assert.equal(state.text, '# agent\n');
  assert.equal(state.statuses.at(-1), 'saved');
});

test('an external change never replaces unsaved typing', async () => {
  const { session, state } = setup(() => assert.fail('no write expected while conflicted'));
  state.text = '# mine\n';
  session.reconcile('# agent\n', 'v9');
  assert.equal(state.text, '# mine\n');
  assert.equal(state.statuses.at(-1), 'conflict');
  await session.flush();
  assert.deepEqual(state.calls, []);
});

test('a rejected replacement stops autosave instead of writing stale text', async () => {
  const statuses = [];
  const calls = [];
  const session = createSaveSession({
    address: 'addr', text: '# a\n', version: 'v1',
    call: async (endpoint) => { calls.push(endpoint); return { ok: true, version: 'v2' }; },
    read: () => '# a\n',
    replace: () => false,
    onStatus: status => statuses.push(status),
  });
  session.reconcile('# agent\n', 'v9');
  await session.flush();
  assert.equal(statuses.at(-1), 'failed:replace-rejected');
  assert.deepEqual(calls, []);
});

test('the conflict choices load the disk version or overwrite it', async () => {
  const disk = { ok: true, text: '# agent\n', version: 'v9' };
  const first = setup(() => disk);
  first.state.text = '# mine\n';
  first.session.reconcile('# agent\n', 'v9');
  await first.session.loadDisk();
  assert.equal(first.state.text, '# agent\n');

  const second = setup(endpoint => (endpoint === 'open' ? disk : { ok: true, version: 'v10' }));
  second.state.text = '# mine\n';
  second.session.reconcile('# agent\n', 'v9');
  await second.session.overwrite();
  const write = second.state.calls.at(-1);
  assert.deepEqual([write.endpoint, write.payload.text, write.payload.baseVersion], ['save', '# mine\n', 'v9']);
});
