/** Browser half: registers the editable renderer ahead of the shipped Markdown preview. */
import { createElement } from 'react';
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
 * Register the renderer metadata and its document body for the plugin lifetime.
 * @param {any} ctx - Cordis client context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE, { zh, en }), 'quirekit-md-editor: locale');
  const t = ctx.locale.bind(LOCALE);
  ctx.effect(() => ctx.documentPreviews.register({
    id: RENDERER_ID,
    extensions: ['md', 'markdown'],
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
}
