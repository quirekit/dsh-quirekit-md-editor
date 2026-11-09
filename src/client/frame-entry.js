/** Editor document entry: exposes the mount function to the shell in the host page. */
import { mountEditor } from './island.js';
import './frame.css';

// Breakpoints describe the window, not this sidebar-sized frame.
window.matchMedia = query => window.parent.matchMedia(query);

/**
 * Mount the editor in this document and route its save shortcut to the shell.
 * @param {object} options - the options of {@link mountEditor}, plus `onSaveShortcut`.
 * @returns {ReturnType<typeof mountEditor>} editor controls.
 */
window.mountQuireKitEditor = (options) => {
  const save = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      options.onSaveShortcut?.();
    }
  };
  window.addEventListener('keydown', save, true);
  return mountEditor(document.getElementById('root'), options);
};
