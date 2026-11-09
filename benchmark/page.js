/** Benchmark page: mounts the same editor island the plugin runs inside DeepSeek Harness. */
import { mountEditor } from '../src/client/island.js';

/**
 * Open a document and report how long it took to become editable.
 * @param {string} markdown - document source.
 * @param {string} view - editing mode.
 * @returns {Promise<number>} milliseconds until the editor painted.
 */
window.openDocument = async (markdown, view) => {
  const began = performance.now();
  const updates = [];
  const editor = mountEditor(document.querySelector('#editor'), {
    markdown, view, documentId: 'benchmark', label: 'benchmark.md', locale: 'en', readOnly: false, toolbar: 'fixed',
    onViewRequest() {}, imageSource: async url => url, images: { upload: async () => '' }, comments: null, commentAuthor: 'Me',
    commentActions: [], onCommentsChange() {}, selectionActions: [], onError(error) { throw error; },
    onChange() { updates.push(performance.now() - window.keyPressedAt); },
  });
  while (editor.editor() === undefined) await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  window.benchmark = { editor: editor.editor(), updates, paints: [] };
  return performance.now() - began;
};

/** @param {number} position - source offset to type at. */
window.placeCaret = (position) => {
  const { editor } = window.benchmark;
  editor.setSelection(editor.state.selection.constructor.single(position));
  editor.scrollTo(position);
  editor.focus();
};

// Runs in the capture phase, before the editor sees the key.
document.addEventListener('keydown', () => {
  window.keyPressedAt = performance.now();
  // The message runs after the frame that rAF belongs to has been produced.
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => window.benchmark.paints.push(performance.now() - window.keyPressedAt);
    channel.port2.postMessage(0);
  });
}, true);
