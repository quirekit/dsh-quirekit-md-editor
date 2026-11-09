/** Text placed in the DSH composer for selections and comments. */

/** Longest quoted passage repeated for one comment, in characters. */
const MAX_QUOTE_LENGTH = 200;

/**
 * @param {string} file - file name.
 * @param {number} startLine - first source line.
 * @param {number} endLine - last source line.
 * @param {string} text - selected Markdown.
 * @returns {string} quote with its location.
 */
export function selectionQuote(file, startLine, endLine, text) {
  // Selecting a whole paragraph also takes the blank lines after it.
  const body = text.replace(/\n+$/u, '');
  const lastLine = endLine - (text.length - body.length);
  return `${file}:${startLine === lastLine ? startLine : `${startLine}-${lastLine}`}\n${body}`;
}

/**
 * Read a Session file address as the path the agent resolves against its working directory.
 * @param {string} address - file resource address.
 * @returns {string} decoded path.
 */
export function sessionFilePath(address) {
  const [, ...segments] = address.split(/[?#]/u, 1)[0].slice('dsh-resource://file/session/'.length).split('/');
  return segments.map(decodeURIComponent).join('/');
}

/**
 * Select the comments an agent can act on. A thread whose text is gone has no place left to change.
 * @param {readonly any[]} views - controller thread views.
 * @param {(position: number) => number} lineAt - one-based source line of a source offset.
 * @returns {{ id: string, line: number | undefined, quote: string, body: string }[]} comments in document order.
 */
export function pendingComments(views, lineAt) {
  return views
    .filter(actionableComment)
    .map(view => ({
      id: view.thread.id,
      line: view.range ? lineAt(view.range.from) : undefined,
      quote: view.thread.anchor?.quote?.exact ?? '',
      body: view.thread.messages.map(message => message.body).join(' / '),
    }))
    .sort((left, right) => (left.line ?? 0) - (right.line ?? 0));
}

/**
 * @param {{ thread: any, status: string }} view - comment thread view.
 * @returns {boolean} whether an agent can act on the comment.
 */
export function actionableComment(view) {
  return !view.thread.resolved && view.status !== 'orphaned';
}

/**
 * @param {string} address - document resource address.
 * @returns {string} resource address of its comment file.
 */
export function commentsAddress(address) {
  const end = address.split(/[?#]/u, 1)[0];
  const slash = end.lastIndexOf('/');
  return `${end.slice(0, slash + 1)}.${end.slice(slash + 1)}.comments.json`;
}

/**
 * Fill the localized request heading.
 * @param {string} template - text with `{file}` and `{comments}` placeholders.
 * @param {string} path - document path.
 * @returns {string} request heading.
 */
export function commentsHeading(template, path) {
  const name = path.split('/').pop();
  return template.replaceAll('{file}', () => path).replaceAll('{comments}', () => `.${name}.comments.json`);
}

/**
 * Build the request asking the agent to act on open comments.
 * @param {string} heading - localized request naming the file and how to treat it.
 * @param {string} wholeDocument - localized label for a comment on the whole document.
 * @param {readonly { id: string, line: number | undefined, quote: string, body: string }[]} comments - comments to send.
 * @returns {string} composer text.
 */
export function commentsRequest(heading, wholeDocument, comments) {
  const lines = comments.map((comment, index) => {
    const exact = comment.quote.trim();
    const quoted = exact.length > MAX_QUOTE_LENGTH ? `${exact.slice(0, MAX_QUOTE_LENGTH)}…` : exact;
    const place = comment.line === undefined ? '' : `L${comment.line} `;
    return `${index + 1}. [${comment.id}] ${place}${quoted ? `「${quoted}」` : wholeDocument}: ${comment.body}`;
  });
  return [heading, '', ...lines].join('\n');
}
