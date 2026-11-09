/** Shell side of the editor document: an iframe keeps the host page's stylesheets from restyling the editor. */

/** Public prefix of the editor document; the host half serves it. */
const FRAME_ROUTE = '/dsh-quirekit-md-editor/frame';

/**
 * Load the editor document into a container and mount the editor there.
 * @param {HTMLElement} container - node owned by the React body.
 * @param {object} options - editor options, passed across the same-origin frame unchanged.
 * @returns {Promise<object>} the editor controls, whose `destroy` also removes the frame.
 */
export async function mountEditorFrame(container, options) {
  const frame = container.ownerDocument.createElement('iframe');
  frame.className = 'qk-dsh-frame';
  frame.title = options.label;
  frame.allow = 'clipboard-read; clipboard-write';
  frame.src = `${FRAME_ROUTE}/${__FRAME_VERSION__}/index.html`;
  const loaded = new Promise((resolve, reject) => {
    frame.addEventListener('load', resolve, { once: true });
    frame.addEventListener('error', reject, { once: true });
  });
  container.append(frame);
  await loaded;
  const editor = frame.contentWindow.mountQuireKitEditor({
    ...options,
    onLayoutChange(layout) {
      container.toggleAttribute('data-rail-fits', layout.railFits);
      container.toggleAttribute('data-comments-side', layout.commentsSide);
      container.toggleAttribute('data-rails', layout.rails);
      container.toggleAttribute('data-comment-dock', layout.commentDock);
    },
  });
  return { ...editor, destroy() { editor.destroy(); frame.remove(); } };
}
