import assert from 'node:assert/strict';
import { test } from 'node:test';

const stored = new Map();
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
};
const { DEFAULT_SETTINGS, getSettings, nextView, normalizeSettings, resolveTabView, setTabView, updateSettings } = await import('../src/client/settings.js');

test('unknown or damaged values fall back to the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings({ defaultView: 'x', viewSwitcher: 'yes', toolbar: 1 }), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings({ defaultView: 'source', viewSwitcher: false, toolbar: 'hidden' }), { defaultView: 'source', viewSwitcher: false, toolbar: 'hidden' });
});

test('changes merge and persist', () => {
  updateSettings({ toolbar: 'floating' });
  updateSettings({ defaultView: 'preview' });
  assert.deepEqual(getSettings(), { defaultView: 'preview', viewSwitcher: true, toolbar: 'floating' });
  assert.deepEqual(JSON.parse([...stored.values()][0]), getSettings());
});

test('a tab keeps its own view until the switcher is turned off', () => {
  updateSettings({ defaultView: 'document', viewSwitcher: true });
  assert.equal(resolveTabView('a'), 'document');
  setTabView('a', 'source');
  setTabView('a', 'reading');
  assert.equal(resolveTabView('a'), 'source');
  assert.equal(resolveTabView('b'), 'document');
  updateSettings({ viewSwitcher: false });
  assert.equal(resolveTabView('a'), 'document');
  updateSettings({ viewSwitcher: true });
  assert.equal(resolveTabView('a'), 'source');
});

test('the view shortcut cycles through the three views', () => {
  assert.deepEqual(['document', 'preview', 'source'].map(nextView), ['preview', 'source', 'document']);
});
