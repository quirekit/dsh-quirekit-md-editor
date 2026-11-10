/** Serves the editor document: the browser half loads it in an iframe to keep the host page's styles out. */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Public prefix of the editor document's files. */
export const FRAME_ROUTE = '/dsh-quirekit-md-editor/frame';

const FRAME_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'frame');

/** Types of the files the build writes; the editor is split into chunks named by content hash. */
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
};

/** A plain file name directly in the frame directory, so no path can leave it. */
const FILE_NAME = /^[\w-]+\.(html|js|css)$/u;

/**
 * Answer a request under the route; each URL carries a content hash, so files can be cached for good.
 * @param {import('node:http').IncomingMessage} request - incoming request.
 * @param {import('node:http').ServerResponse} response - outgoing response.
 * @returns {Promise<void>} settles when the response ends.
 */
export async function serveEditorFrame(request, response) {
  const file = new URL(request.url ?? '/', 'http://localhost').pathname.split('/').pop() ?? '';
  const extension = FILE_NAME.exec(file)?.[1];
  const bytes = extension === undefined || (request.method !== 'GET' && request.method !== 'HEAD')
    ? undefined
    : await readFile(join(FRAME_DIRECTORY, file)).catch(() => undefined);
  if (bytes === undefined) {
    response.writeHead(404);
    response.end();
    return;
  }
  const type = TYPES[extension];
  response.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'cache-control': 'public, max-age=31536000, immutable' });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}
