/** Document renderer body: loads the file, mounts the editor island and shows save state. */
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { callHost, createImageBridge } from './channel.js';
import { mountEditorFrame } from './frame.js';
import { actionableComment, commentsAddress, commentsHeading, commentsRequest, pendingComments as commentsToSend, selectionQuote, sessionFilePath } from './prompts.js';
import { createSaveSession, settledSave } from './save-session.js';
import { clearTabView, getSettings, nextView, resolveTabView, setTabView, useSettings, useTabView } from './settings.js';

/**
 * Read the file name from a resource address for the editor's accessible label.
 * @param {string} address - file resource address.
 * @returns {string} decoded file name.
 */
function fileNameOf(address) {
  return decodeURIComponent(address.split(/[?#]/u, 1)[0].split('/').pop() ?? address);
}

/**
 * Resolve a failure code to specific text, or the generic fallback.
 * @param {(key: string) => string} t - locale reader.
 * @param {string} code - failure code.
 * @returns {string} visible message.
 */
function failureText(t, code) {
  const specific = `failed.${code}`;
  const text = t(specific);
  return text === specific || text === '' ? t('failed') : text;
}

/**
 * Read the owning Session from a resource address.
 * @param {string} address - file resource address.
 * @returns {string} Session id.
 */
function sessionIdOf(address) {
  return decodeURIComponent(address.slice('dsh-resource://file/session/'.length).split('/', 1)[0]);
}

/** How long a composer notice stays visible, in milliseconds. */
const NOTICE_DURATION = 2500;

/** Keeps an editor failure inside its tab so the preview toolbar stays usable. */
export class EditorBoundary extends Component {
  /** @param {any} props - boundary props. */
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  /** @returns {{ failed: boolean }} the failed state. */
  static getDerivedStateFromError() {
    return { failed: true };
  }

  /** @param {unknown} error - the render failure. */
  componentDidCatch(error) {
    console.error('[quirekit-md-editor]', error);
  }

  /** @returns {any} children, or the failure notice. */
  render() {
    if (this.state.failed) return <div className="qk-dsh-failure">{this.props.t('failed')}</div>;
    return this.props.children;
  }
}

/**
 * Editable Markdown body for the sidebar document preview.
 * @param {any} props - DSH document body owner props.
 * @returns {JSX.Element} the editor surface.
 */
export function MarkdownEditorBody(props) {
  const { resourceAddress, content, setResources, t, useTabInfo, sendToComposer } = props;
  const { tab } = useTabInfo();
  const view = useTabView(tab.id);
  const { toolbar } = useSettings();
  const revision = content.kind === 'renderer' ? content.revision : undefined;
  const container = useRef(null);
  const session = useRef(undefined);
  const island = useRef(undefined);
  const [status, setStatus] = useState('loading');
  const [writable, setWritable] = useState(true);
  const [pendingComments, setPendingComments] = useState([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentsOffRail, setCommentsOffRail] = useState(0);
  const [notice, setNotice] = useState(undefined);
  const noticeTimer = useRef(undefined);

  /**
   * Put text in this Session's composer and report the outcome.
   * @param {string} text - quote text.
   */
  const send = (text) => {
    setNotice(sendToComposer(sessionIdOf(resourceAddress), text) ? 'sentToComposer' : 'composerBusy');
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(undefined), NOTICE_DURATION);
  };
  /**
   * Store comments and refresh the comment buttons.
   * @param {{ exchange: any, pending: any[], offRail: number } | undefined} state - current comments.
   */
  const storeComments = (state) => {
    if (state === undefined) return;
    setPendingComments(state.pending);
    setCommentCount(state.exchange.threads.length);
    setCommentsOffRail(state.offRail);
    void callHost('comments', { address: resourceAddress, comments: state.exchange }).catch(() => {});
  };

  /**
   * Put a comment request in the composer.
   * @param {readonly any[]} comments - comments to send.
   */
  const sendComments = comments => send(commentsRequest(commentsHeading(t('commentsRequest'), sessionFilePath(resourceAddress)), t('wholeDocument'), comments));

  // Watching the comment file is how the editor learns that an agent resolved a comment.
  useEffect(() => { setResources(commentCount > 0 ? [resourceAddress, commentsAddress(resourceAddress)] : [resourceAddress]); }, [resourceAddress, setResources, commentCount > 0]);
  useEffect(() => { island.current?.setDisplay({ view, toolbar }); }, [view, toolbar]);
  useEffect(() => {
    const forget = () => clearTabView(tab.id);
    tab.signal.addEventListener('abort', forget, { once: true });
    return () => tab.signal.removeEventListener('abort', forget);
  }, [tab.id, tab.signal]);

  // Each revision re-reads the file: the first mounts the editor, later ones reconcile.
  useEffect(() => {
    if (content.kind !== 'renderer') return undefined;
    const controller = new AbortController();
    void (async () => {
      await settledSave(resourceAddress);
      const file = await callHost('open', { address: resourceAddress }, controller.signal);
      if (controller.signal.aborted) return;
      if (!file.ok) {
        if (session.current === undefined) setStatus(`failed:${file.code}`);
        else session.current.suspend(file.code);
        content.failed();
        return;
      }
      setWritable(file.writable);
      if (island.current === undefined) {
        const mounted = await mountEditorFrame(container.current, {
          markdown: file.text,
          documentId: resourceAddress,
          label: fileNameOf(resourceAddress),
          locale: t('editorLocale'),
          readOnly: !file.writable,
          view: resolveTabView(tab.id),
          toolbar: getSettings().toolbar,
          onViewRequest: () => setTabView(tab.id, nextView(resolveTabView(tab.id))),
          ...createImageBridge(resourceAddress),
          comments: file.comments,
          commentAuthor: t('commentAuthor'),
          onCommentsChange: storeComments,
          commentActions: [{
            id: 'send-to-dsh',
            label: t('sendComment'),
            icon: 'send',
            visible: actionableComment,
            run: context => sendComments(commentsToSend([context], () => context.startLine)),
          }],
          selectionActions: [{
            id: 'send-to-dsh',
            label: t('sendSelection'),
            icon: 'send',
            run: ({ text, startLine, endLine }) => send(selectionQuote(sessionFilePath(resourceAddress), startLine, endLine, text)),
          }],
          onChange: () => session.current?.changed(),
          onSaveShortcut: () => { void session.current?.flush(); },
          onError: (error) => { console.error('[quirekit-md-editor]', error); setStatus('failed:editor'); },
        });
        if (controller.signal.aborted) { mounted.destroy(); return; }
        island.current = mounted;
        session.current = createSaveSession({
          address: resourceAddress, text: file.text, version: file.version, call: callHost,
          read: mounted.read, replace: mounted.replace, onStatus: setStatus,
          // Editing moves comment ranges without a change event, so anchors are stored with each save.
          onSaved: () => {
            const state = mounted.commentState();
            if (state?.exchange.threads.length > 0) storeComments(state);
          },
        });
        setStatus('saved');
      } else {
        island.current.setReadOnly(!file.writable);
        session.current.reconcile(file.text, file.version);
        island.current.resolveComments(file.resolvedComments ?? []);
      }
      content.loaded(file.version);
    })().catch((error) => {
      if (controller.signal.aborted) return;
      console.error('[quirekit-md-editor]', error);
      setStatus('failed:unavailable');
      content.failed();
    });
    return () => controller.abort();
  }, [revision, resourceAddress]);

  useEffect(() => {
    const persist = () => { void session.current?.flush(); };
    window.addEventListener('pagehide', persist);
    return () => {
      window.removeEventListener('pagehide', persist);
      clearTimeout(noticeTimer.current);
      session.current?.dispose();
      island.current?.destroy();
      session.current = undefined;
      island.current = undefined;
    };
  }, [resourceAddress]);

  const saveShortcut = useCallback((event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      void session.current?.flush();
    }
  }, []);

  const label = !writable && status === 'saved' ? 'readOnly' : status;
  return (
    <div className="qk-dsh-body" onKeyDownCapture={saveShortcut}>
      <div className="qk-dsh-editor" ref={container} />
      {commentCount > 0 && (
        <div className="qk-dsh-comment-actions">
          {commentCount > commentsOffRail && (
            <>
              <button type="button" className="qk-dsh-rail-hide" onClick={() => island.current?.setCommentRailVisible(false)}>{t('hideCommentRail')}</button>
              <button type="button" className="qk-dsh-rail-show" onClick={() => island.current?.setCommentRailVisible(true)}>{t('showCommentRail')}</button>
            </>
          )}
          <button type="button" className="qk-dsh-view-comments" data-all-on-rail={commentsOffRail === 0} onClick={() => island.current?.showComments()}>
            {t('viewComments').replace('{count}', String(commentCount))}
          </button>
          {pendingComments.length > 0 && (
            <button
              type="button"
              onClick={() => sendComments(pendingComments)}
            >
              {t('sendComments').replace('{count}', String(pendingComments.length))}
            </button>
          )}
        </div>
      )}
      {notice !== undefined && <div className="qk-dsh-notice" role="status">{t(notice)}</div>}
      <div className="qk-dsh-status" data-status={status}>
        {status === 'conflict'
          ? <>
              <span>{t('conflict')}</span>
              <button type="button" onClick={() => session.current?.loadDisk()}>{t('loadDisk')}</button>
              <button type="button" onClick={() => session.current?.overwrite()}>{t('keepMine')}</button>
            </>
          : status.startsWith('failed:')
            ? <span>{failureText(t, status.slice(7))}</span>
            : <span>{t(label)}</span>}
      </div>
    </div>
  );
}
