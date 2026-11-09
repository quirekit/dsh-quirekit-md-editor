import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textChanges } from '../src/client/text-changes.js';

/**
 * @param text - Starting text.
 * @param changes - Ascending changes.
 * @returns The text after applying them.
 */
function apply(text, changes) {
  let result = '', position = 0;
  for (const { from, to, insert } of changes) {
    assert.ok(from >= position && to >= from, 'changes stay ascending');
    result += text.slice(position, from) + insert;
    position = to;
  }
  return result + text.slice(position);
}

test('identical text needs no change', () => {
  assert.deepEqual(textChanges('# a\n\nb\n', '# a\n\nb\n'), []);
});

test('an edit narrows to the characters that differ', () => {
  assert.deepEqual(textChanges('one\ntwo line\nthree\n', 'one\ntwo lines\nthree\n'), [{ from: 12, to: 12, insert: 's' }]);
});

test('separate edits stay separate so text between them is untouched', () => {
  const current = 'A\nB\nC\nD\nE\n';
  const changes = textChanges(current, 'A1\nB\nC\nD\nE2\n');
  assert.equal(changes.length, 2);
  assert.equal(apply(current, changes), 'A1\nB\nC\nD\nE2\n');
  assert.ok(changes[0].to <= current.indexOf('C') && changes[1].from >= current.indexOf('D'));
});

test('insertions, deletions and repeated lines reproduce the target', () => {
  const cases = [
    ['', 'new\n'], ['old\n', ''], ['a\na\na\n', 'a\nb\na\nc\na\n'], ['x\ny\nz', 'z\ny\nx'],
    ['no final newline', 'no final newline\n'], ['中文\n😀 第二行\n', '中文\n😁 第二行\n加一行\n'],
  ];
  for (const [current, target] of cases) assert.equal(apply(current, textChanges(current, target)), target);
});

test('a rewrite beyond the edit limit still reproduces the target', () => {
  const current = Array.from({ length: 3000 }, (_, index) => `a${index}\n`).join('');
  const target = Array.from({ length: 3000 }, (_, index) => `b${index}\n`).join('');
  assert.equal(apply(current, textChanges(current, target)), target);
});
