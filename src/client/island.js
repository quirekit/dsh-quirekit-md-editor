/** Vue island: DSH's React tree owns the container, Vue owns everything inside it. */
import { computed, createApp, h, ref, shallowRef, watch } from 'vue';
import { MdEditor } from '@quirekit/md-editor/vue';
import { mdComments } from '@quirekit/md-editor-comments';
import { getComments } from '@quirekit/msfe-comments';
import { createTheme, defaultBaseTokens, quireIconRegistry } from '@quirekit/ui';
import { QuireIconProvider, QuireThemeProvider } from '@quirekit/ui/vue';
import '@quirekit/unocss-preset/quirekit.css';
import '@quirekit/ui/styles.css';
import '@quirekit/md-editor/styles.css';
import '@quirekit/md-editor-comments/styles.css';
import { pendingComments } from './prompts.js';
import { textChanges } from './text-changes.js';

/** Sidebar width from which comments sit beside the text, in pixels. */
const SIDE_COMMENTS_MIN_WIDTH = 720;

/**
 * Read the colour scheme DSH's theme presenter applied to the page.
 * @returns {'light' | 'dark'} the active scheme.
 */
function pageScheme() {
  return window.parent.document.documentElement.style.colorScheme === 'dark' ? 'dark' : 'light';
}

/**
 * Mount the Markdown editor into a DOM node.
 * @param {HTMLElement} container - node owned by the React body.
 * @param {{ markdown: string, documentId: string, label: string, locale: string, readOnly: boolean, view: string, toolbar: string, imageSource: Function, images: object, selectionActions: readonly object[], comments: object | null, commentAuthor: string, commentActions: readonly object[], onCommentsChange: (state: object | undefined) => void, onChange: () => void, onError: (error: unknown) => void, onViewRequest: () => void, onLayoutChange?: (layout: { railFits: boolean, commentsSide: boolean, rails: boolean, commentDock: boolean }) => void }} options - initial source, identity, display and callbacks.
 * @returns {{ read: () => string | undefined, replace: (text: string) => boolean, setReadOnly: (value: boolean) => void, setDisplay: (display: { view: string, toolbar: string }) => void, commentState: () => object | undefined, showComments: () => void, setCommentRailVisible: (visible: boolean) => void, resolveComments: (ids: readonly string[]) => void, destroy: () => void }} editor controls.
 */
export function mountEditor(container, options) {
  const component = shallowRef();
  const scheme = ref(pageScheme());
  const readOnly = ref(options.readOnly);
  const view = ref(options.view);
  const toolbar = ref(options.toolbar);
  const theme = computed(() => createTheme({
    profile: 'precision',
    scheme: scheme.value,
    sources: { primary: defaultBaseTokens.color.source.cobalt },
  }));
  // The presenter writes the scheme inline, so a style observation follows theme switches.
  const observer = new MutationObserver(() => { scheme.value = pageScheme(); });
  observer.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['style'] });

  const comments = mdComments({
    user: { id: 'dsh-user', name: options.commentAuthor },
    canComment: !options.readOnly,
    // The DSH sidebar is narrower than a full page but still fits a text column beside the rail.
    sideMinWidth: SIDE_COMMENTS_MIN_WIDTH,
    actions: options.commentActions,
    onChange: () => options.onCommentsChange(commentState()),
  });
  const controller = () => {
    const editor = component.value?.editor;
    return editor === undefined ? undefined : getComments(editor);
  };
  /**
   * Summarize the comments for storage and the action buttons.
   * @returns {{ exchange: object, pending: object[], offRail: number } | undefined} current comments.
   */
  function commentState() {
    const owner = controller();
    if (owner === undefined) return undefined;
    const views = owner.threads();
    return {
      exchange: owner.exportComments(),
      pending: pendingComments(views, position => component.value.editor.state.doc.lineAt(position).number),
      // Resolved threads and threads whose text is gone are only reachable from the list.
      offRail: views.filter(view => view.thread.resolved || !view.range).length,
    };
  }
  const stopRestoring = watch(() => component.value?.editor, (editor) => {
    if (editor === undefined) return;
    if (options.comments !== null) {
      controller()?.importComments(options.comments);
      options.onCommentsChange(commentState());
    }
    queueMicrotask(() => stopRestoring());
  }, { flush: 'post' });
  // The list pins itself to this scroller rather than to the browser window.
  const viewport = new ResizeObserver(() => {
    container.style.setProperty('--md-editor-viewport-height', `${container.clientHeight}px`);
    reportLayout();
  });
  viewport.observe(container);
  let reported = '';
  /** Tell the surrounding shell how comments are laid out, only when that changes. */
  function reportLayout() {
    const editor = container.querySelector('.md-editor');
    const layout = {
      railFits: container.clientWidth >= SIDE_COMMENTS_MIN_WIDTH,
      commentsSide: editor?.getAttribute('data-comments') === 'side',
      rails: editor?.hasAttribute('data-rails') === true,
      commentDock: editor?.querySelector('.md-editor__comment-dock') != null,
    };
    const next = JSON.stringify(layout);
    if (next === reported) return;
    reported = next;
    options.onLayoutChange?.(layout);
  }

  const app = createApp({
    render: () => h('div', { class: 'qk-dsh-theme' }, h(QuireIconProvider, { registry: quireIconRegistry }, () => (
      h(QuireThemeProvider, { theme: theme.value }, () => h(MdEditor, {
        ref: component,
        markdown: options.markdown,
        label: options.label,
        locale: options.locale,
        readOnly: readOnly.value,
        // The document layout places comments in a rail beside the text.
        layout: 'document',
        view: view.value,
        toolbar: toolbar.value === 'hidden' ? false : toolbar.value,
        selectionToolbar: toolbar.value !== 'hidden',
        'onUpdate:view': options.onViewRequest,
        imageSource: options.imageSource,
        images: options.images,
        comments,
        selectionActions: options.selectionActions,
        onChange: options.onChange,
        onError: options.onError,
      }))
    ))),
  });
  app.mount(container);
  const layoutObserver = new MutationObserver(reportLayout);
  layoutObserver.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-comments', 'data-rails'] });
  reportLayout();

  return {
    /** The underlying editor, for the benchmark. */
    editor: () => component.value?.editor,
    read: () => component.value?.editor?.getMarkdown(),
    replace: (text) => {
      const editor = component.value?.editor;
      // Applying only the differences keeps the caret, scroll position, undo history and comment anchors.
      // Text the editor normalizes on load cannot be diffed against its canonical source.
      if (editor && !/^﻿|\r/u.test(text)) {
        const changes = textChanges(editor.state.doc.toString(), text);
        if (editor.applyChanges({ documentId: editor.documentId, baseRevision: editor.revision, changes }).ok) return true;
      }
      // A replaced source drops comment state; re-anchoring finds each thread by its quote.
      const saved = controller()?.exportComments();
      const accepted = editor?.replaceDocument(text, options.documentId).ok !== false;
      if (accepted && saved !== undefined) controller()?.importComments(saved);
      return accepted;
    },
    commentState,
    showComments: () => component.value?.showComments?.(),
    setCommentRailVisible: visible => component.value?.setCommentRailVisible?.(visible),
    resolveComments(ids) {
      const owner = controller();
      for (const view of owner?.threads() ?? []) if (ids.includes(view.thread.id) && !view.thread.resolved) owner.resolve(view.thread.id);
    },
    setReadOnly: (value) => { readOnly.value = value; },
    setDisplay: (display) => { view.value = display.view; toolbar.value = display.toolbar; },
    destroy() {
      stopRestoring();
      observer.disconnect();
      viewport.disconnect();
      layoutObserver.disconnect();
      app.unmount();
    },
  };
}
