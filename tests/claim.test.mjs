import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLAIM_ID,
  CLAIM_KIND,
  CLAIM_PATTERNS,
  PREVIEW_ID,
  claimDefinition,
  fileNameOf,
  needsClaim,
  previewKind,
  probeAddress,
  watchClaim,
} from '../src/client/claim.js';

/** The tab registry's priority bands, highest first. */
const RANK = { extension: 3, builtin: 2, fallback: 1 };

/** A Better-Sidebar-style file viewer: every file address, one general whole-address glob. */
const EDITOR = { id: 'dsh-better-sidebar:editor', kind: 'editor', patterns: ['dsh-resource://file/**'], priority: 'extension' };

/** The shipped preview tab type: every Session file address, at the fallback band. */
const PREVIEW = {
  id: PREVIEW_ID,
  kind: 'text',
  patterns: ['dsh-resource://file/**'],
  priority: 'fallback',
  canOpen: address => address.startsWith('dsh-resource://file/session/'),
};

/**
 * Match one whole-address glob the way the tab registry does for these fixtures.
 *
 * The registry runs picomatch with `nocase`; the patterns here use only `**`
 * (any run of characters) and `*` (one path segment), so a small translation
 * covers them without adding a dependency to the package.
 * @param {string} pattern - whole-address glob.
 * @param {string} address - file address.
 * @returns {boolean} whether the pattern matches.
 */
function matches(pattern, address) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if ('\\^$.|?+()[]{}'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`, 'iu').test(address);
}

/**
 * Rank candidates the way the tab registry does: band, then the longest matched
 * pattern, then registration order.
 * @param {readonly object[]} definitions - registered tab types.
 * @param {string} address - file address to claim.
 * @returns {object[]} the types that would open it, best first.
 */
function ranking(definitions, address) {
  return definitions.map((definition, order) => {
    let length = -1;
    for (const pattern of definition.patterns ?? []) {
      if (matches(pattern, address) && pattern.length > length) length = pattern.length;
    }
    if (length < 0) return undefined;
    if (definition.canOpen !== undefined && !definition.canOpen(address)) return undefined;
    return { definition, order, rank: RANK[definition.priority], length };
  }).filter(candidate => candidate !== undefined)
    .sort((left, right) => right.rank - left.rank || right.length - left.length || left.order - right.order)
    .map(candidate => candidate.definition);
}

const definition = claimDefinition();
const markdown = 'dsh-resource://file/session/s1/notes/draft.md';

test('the definition names one unique type and claims whole Markdown addresses', () => {
  assert.equal(definition.id, CLAIM_ID);
  assert.equal(definition.kind, CLAIM_KIND);
  assert.deepEqual(definition.patterns, [...CLAIM_PATTERNS]);
  assert.equal(definition.priority, 'extension');
  assert.equal(definition.canOpen(markdown), true);
  assert.equal(definition.canOpen('dsh-resource://file/session/s1/notes.txt'), true);
  // The preview refuses an absolute address, so the claim must not take one either.
  assert.equal(definition.canOpen('dsh-resource://file/absolute/tmp/draft.md'), false);
  assert.equal(definition.canOpen('sidebar://guide'), false);
});

test('the claim outranks a general file viewer for Markdown only', () => {
  const pdf = 'dsh-resource://file/session/s1/paper.pdf';
  assert.deepEqual(ranking([definition, EDITOR, PREVIEW], markdown), [definition, EDITOR, PREVIEW]);
  assert.deepEqual(ranking([definition, EDITOR, PREVIEW], 'dsh-resource://file/session/s1/deep/er/NOTES.MD'), [definition, EDITOR, PREVIEW]);
  assert.deepEqual(ranking([definition, EDITOR, PREVIEW], 'dsh-resource://file/session/s1/notes.markdown'), [definition, EDITOR, PREVIEW]);
  assert.deepEqual(ranking([definition, EDITOR, PREVIEW], pdf), [EDITOR, PREVIEW]);
});

test('each claim pattern is longer than a general file claim and names a Markdown suffix', () => {
  for (const pattern of CLAIM_PATTERNS) {
    assert.ok(pattern.length > 'dsh-resource://file/**'.length, pattern);
    assert.ok(pattern.startsWith('dsh-resource://file/**/'), pattern);
    assert.match(pattern, /\*\.(?:md|markdown)$/u);
  }
});

test('a claim is only needed while another type outranks the preview', () => {
  assert.equal(needsClaim([PREVIEW]), false);
  assert.equal(needsClaim([EDITOR, PREVIEW]), true);
  assert.equal(needsClaim([definition, EDITOR, PREVIEW]), true);
  // The claim plus the preview is the steady state once the competitor is gone.
  assert.equal(needsClaim([definition, PREVIEW]), false);
  // A competitor below the preview is not the one that hides the editor tab.
  assert.equal(needsClaim([PREVIEW, EDITOR]), false);
  // Without the shipped preview there is no tab to hand a file to.
  assert.equal(needsClaim([]), false);
  assert.equal(needsClaim([EDITOR]), false);
});

test('the hand-off kind is read from the live preview registration', () => {
  assert.equal(previewKind([EDITOR, PREVIEW]), 'text');
  assert.equal(previewKind([EDITOR]), undefined);
  assert.equal(previewKind([]), undefined);
});

test('the probe asks about a Markdown file in a listed Session', () => {
  assert.equal(probeAddress(['sess-1', 'sess-2']), 'dsh-resource://file/session/sess-1/probe.md');
  const fallback = probeAddress([]);
  assert.match(fallback, /^dsh-resource:\/\/file\/session\/[^/]+\/probe\.md$/u);
  assert.equal(needsClaim(ranking([EDITOR, PREVIEW], fallback)), true);
  assert.equal(needsClaim(ranking([PREVIEW], fallback)), false);
});

test('a claim tab is titled by the file it was opened for', () => {
  assert.equal(fileNameOf('dsh-resource://file/session/s1/notes/a%20b.md'), 'a b.md');
  assert.equal(fileNameOf('dsh-resource://file/session/s1/a.md?line=3'), 'a.md');
  assert.equal(fileNameOf('dsh-resource://file/session/s1/%E0%A4%A.md'), '%E0%A4%A.md');
});

/**
 * A tab registry stand-in with the one behaviour the watcher depends on:
 * registration and release publish synchronously to every subscriber.
 * @returns {{ tabs: object, state: { registered: object[], listeners: Set<() => void>, competitor: boolean } }} the registry and its mutable state.
 */
function fakeRegistry() {
  const state = { registered: [], listeners: new Set(), competitor: false };
  const publish = () => {
    for (const listener of [...state.listeners]) listener();
  };
  return {
    state,
    tabs: {
      candidates: address => ranking([...state.registered, ...(state.competitor ? [EDITOR] : []), PREVIEW], address),
      register(registered) {
        state.registered.push(registered);
        publish();
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          state.registered.splice(state.registered.indexOf(registered), 1);
          publish();
        };
      },
      subscribe(listener) {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
    },
  };
}

test('the watch registers a claim only while a competitor outranks the preview', () => {
  const { tabs, state } = fakeRegistry();
  const dispose = watchClaim({ tabs, probe: () => markdown });
  assert.equal(state.registered.length, 0);
  assert.equal(state.listeners.size, 1);

  state.competitor = true;
  for (const listener of [...state.listeners]) listener();
  assert.equal(state.registered.length, 1);
  assert.equal(state.registered[0].kind, CLAIM_KIND);
  // A publish for the state the claim already covers must not register again.
  for (const listener of [...state.listeners]) listener();
  assert.equal(state.registered.length, 1);

  state.competitor = false;
  for (const listener of [...state.listeners]) listener();
  assert.equal(state.registered.length, 0);
  dispose();
  assert.equal(state.listeners.size, 0);
});

test('disposing the watch releases a live claim', () => {
  const { tabs, state } = fakeRegistry();
  state.competitor = true;
  const dispose = watchClaim({ tabs, probe: () => markdown });
  assert.equal(state.registered.length, 1);
  dispose();
  assert.equal(state.registered.length, 0);
  assert.equal(state.listeners.size, 0);
});
