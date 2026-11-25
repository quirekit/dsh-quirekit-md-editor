/** Browser half: registers the editable renderer ahead of the shipped Markdown preview. */
import { createElement } from 'react';
import { MarkdownClaimBody } from './claim-body.jsx';
import { CLAIM_ID, MARKDOWN_EXTENSIONS, previewKind, probeAddress, watchClaim } from './claim.js';
import { EditorSettings, ViewSwitcher } from './controls.jsx';
import { EditorBoundary, MarkdownEditorBody } from './body.jsx';
import { en, zh } from './locale.js';
import './styles.css';

const RENDERER_ID = 'dsh-quirekit-md-editor';
const LOCALE = 'dshQuirekitMdEditor';
const PACKAGE_NAME = 'dsh-quirekit-md-editor';

export const name = RENDERER_ID;
export const inject = ['slots', 'locale', 'documentPreviews', 'sessions'];

/**
 * Keep editor failures inside the document tab.
 * @param {(sessionId: string, text: string) => boolean} sendToComposer - composer bridge.
 * @returns {(props: any) => any} the guarded editor body.
 */
function createGuardedBody(sendToComposer) {
  return function GuardedBody(props) {
    return createElement(EditorBoundary, { t: props.t }, createElement(MarkdownEditorBody, { ...props, sendToComposer }));
  };
}

/**
 * Build the action that quotes text into a Session's composer without sending it.
 * @param {any} ctx - Cordis client context.
 * @returns {(sessionId: string, text: string) => boolean} whether the composer accepted the text.
 */
function createComposerBridge(ctx) {
  return (sessionId, text) => {
    const scope = ctx.sessions.scope(sessionId);
    const conversation = scope?.get('conversation');
    if (scope === undefined || conversation === undefined) return false;
    const input = conversation.input.for(scope);
    if (!input.insertQuote(text)) return false;
    input.focus();
    return true;
  };
}

/**
 * Build the action that hands one claimed Markdown tab to the built-in preview tab.
 * @param {any} ctx - Cordis client context.
 * @returns {(tab: any) => void} the hand-off; throws when the preview is unavailable.
 */
function createHandOff(ctx) {
  return (tab) => {
    const kind = previewKind(ctx.get('sidebarRightTabs')?.entries() ?? []);
    const sidebar = ctx.get('sidebarRight');
    if (kind === undefined || sidebar === undefined) throw new Error('the built-in document preview is not registered');
    // The tab action drops a named `kind` and re-ranks the address instead,
    // which would claim this very tab again, so the hand-off goes through the
    // controller, where naming the kind skips the ranking.
    sidebar.openResource(tab.contentId, { kind, replaceTab: tab.id, params: tab.navigation.params });
  };
}

/**
 * Register the renderer metadata and its document body for the plugin lifetime.
 * @param {any} ctx - Cordis client context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE, { zh, en }), 'quirekit-md-editor: locale');
  const t = ctx.locale.bind(LOCALE);
  ctx.effect(() => ctx.documentPreviews.register({
    id: RENDERER_ID,
    extensions: MARKDOWN_EXTENSIONS,
    priority: 'extension',
    title: () => t('title'),
    // The editor needs the whole file and the version token that guards its saves.
    loading: 'renderer',
  }), 'quirekit-md-editor: renderer');
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: RENDERER_ID, locale: LOCALE },
    createGuardedBody(createComposerBridge(ctx)),
  )), 'quirekit-md-editor: body');
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.action', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document.action', key: RENDERER_ID, locale: LOCALE },
    ViewSwitcher,
  )), 'quirekit-md-editor: view switcher');
  ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
    { name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: LOCALE },
    EditorSettings,
  )), 'quirekit-md-editor: settings');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: CLAIM_ID,
      inject: () => ({ handOff: createHandOff(ctx) }),
    },
    MarkdownClaimBody,
  )), 'quirekit-md-editor: markdown claim body');

  // Another plugin that claims file addresses (a Better Sidebar editor, a Mark
  // Text editor) outranks the built-in preview tab, and this editor lives inside
  // that tab. While such a competitor is registered, claim Markdown files with a
  // longer address pattern and hand them to the preview tab; with no competitor
  // the claim stays out of the way. See claim.js.
  ctx.inject(['sidebarRightTabs'], scope => watchClaim({
    tabs: scope.get('sidebarRightTabs'),
    probe: () => probeAddress(ctx.sessions.list.getSnapshot().ids),
  }));
}
