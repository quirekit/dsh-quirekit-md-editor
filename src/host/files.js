/** Session-scoped Markdown reads and version-guarded writes over the DSH filesystem service. */

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/session/';
const BOM = '﻿';

/** Largest Markdown file the editor opens, in bytes. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** A failure with a code the browser half can act on. */
export class FileRequestError extends Error {
  /**
   * @param {string} code - stable failure code.
   * @param {string} message - diagnostic text.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Decode a session-scoped file resource address.
 * @param {unknown} address - the tab's resource address.
 * @returns {{ sessionId: string, path: string }} the owning Session and its path.
 */
export function parseSessionFileAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) {
    throw new FileRequestError('unsupported-address', 'Only session file addresses can be edited.');
  }
  const end = address.search(/[?#]/);
  const raw = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end);
  const [id, ...segments] = raw.split('/');
  const path = segments.map(decodeURIComponent).join('/');
  if (id === undefined || id === '' || path === '') {
    throw new FileRequestError('unsupported-address', 'The file address has no session or path.');
  }
  return { sessionId: decodeURIComponent(id), path };
}

/**
 * Translate a filesystem failure into a browser-facing code.
 * @param {any} error - rejected value from the filesystem service.
 * @returns {string} the failure code.
 */
function failureCode(error) {
  switch (error?.code) {
    case 'FS_STALE_VERSION': return 'conflict';
    case 'FS_NOT_FOUND': return 'not-found';
    case 'FS_NOT_TEXT': return 'not-text';
    case 'FS_TOO_LARGE': return 'too-large';
    case 'FS_PERMISSION_DENIED': return 'forbidden';
    case 'FS_SANDBOX_DENIED': return 'sandbox-denied';
    default: return error?.code === undefined ? 'unavailable' : String(error.code);
  }
}

/**
 * Run one request and normalize its failure into a typed result.
 * @template T
 * @param {() => Promise<T>} work - the request body.
 * @returns {Promise<T | { ok: false, code: string, message: string }>} the outcome.
 */
export async function answer(work) {
  try {
    return await work();
  } catch (error) {
    return {
      ok: false,
      code: error instanceof FileRequestError ? error.code : failureCode(error),
      message: String(error?.message ?? error),
    };
  }
}

/**
 * Build the Session-scoped file resolver shared by document and image operations.
 * @param {{ fs: any, sessions: any, sandboxPolicy: any, sessionPersistence?: any }} services - DSH host services.
 * @returns {{ locate: Function, access: Function }} resolver functions.
 */
export function createFileLocator(services) {
  const { fs, sessions, sandboxPolicy } = services;
  return {
    /**
     * Resolve an address through its Session; the browser never chooses the workspace root.
     * @param {unknown} address - tab resource address.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<{ live: any, path: string, workspaceRoot: string, root: any, target: any }>} resolved file.
     */
    async locate(address, signal) {
      const { sessionId, path } = parseSessionFileAddress(address);
      const live = sessions.get(sessionId);
      const header = live?.header ?? (await services.sessionPersistence?.stat(sessionId))?.header;
      if (header === undefined) throw new FileRequestError('unknown-session', 'The session no longer exists.');
      const workspaceRoot = header.cwd ?? sandboxPolicy.workspaceRoot;
      const [root, target] = await Promise.all([
        fs.resolve(workspaceRoot, { signal }),
        fs.resolve(path, { cwd: workspaceRoot, signal }),
      ]);
      return { live, path, workspaceRoot, root, target };
    },

    /**
     * Decide whether a located file may be written under its Session's sandbox.
     * @param {{ live: any, path: string, workspaceRoot: string, root: any, target: any }} file - located file.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<{ writable: boolean, inside: boolean, policy: any }>} the write decision.
     */
    async access(file, signal) {
      // Reads may leave the workspace; writes stay inside it and never follow a final symlink.
      const entry = await fs.lstat(file.path, { cwd: file.workspaceRoot }, signal);
      const inside = fs.contains(file.root, file.target) && entry?.type === 'file';
      const policy = sandboxPolicy.resolve(file.live === undefined ? {} : { session: file.live });
      return { writable: inside && policy?.mode !== 'read-only', inside, policy };
    },
  };
}

/**
 * Build the open and save operations for one set of host services.
 * @param {{ fs: any, sessions: any, sandboxPolicy: any, sessionPersistence?: any }} services - DSH host services.
 * @returns {{ open: Function, save: Function }} the file operations.
 */
export function createFileOperations(services) {
  const { fs } = services;
  const { locate, access } = createFileLocator(services);

  /**
   * Restore a byte-order mark the text decoder may have dropped.
   * @param {any} target - resolved file.
   * @param {string} text - decoded text.
   * @param {AbortSignal} signal - request cancellation.
   * @returns {Promise<string>} the text with its original leading mark.
   */
  async function withOriginalBom(target, text, signal) {
    if (text.startsWith(BOM)) return text;
    const head = await fs.readByteRange(target, { offset: 0, length: 3 }, signal);
    return head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? BOM + text : text;
  }

  return {
    /**
     * Read the whole file with the version observed before the read.
     * @param {{ address: unknown }} request - file to open.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<object>} the text, version and write permission, or a typed failure.
     */
    open: (request, signal) => answer(async () => {
      const file = await locate(request?.address, signal);
      // A version older than the text can only make a later save conflict, never overwrite.
      const info = await fs.stat(file.target, signal);
      if (info === undefined) throw new FileRequestError('not-found', 'The file no longer exists.');
      if (info.type !== 'file') throw new FileRequestError('not-regular-file', 'Only regular files can be edited.');
      if ((info.size ?? 0) > MAX_FILE_BYTES) throw new FileRequestError('too-large', 'The file is too large to edit.');
      const text = await withOriginalBom(file.target, await fs.readText(file.target, signal), signal);
      // The editor keeps one uniform separator per file and cannot round-trip a mix.
      if (text.includes('\r\n') && /(^|[^\r])\n/u.test(text)) {
        throw new FileRequestError('mixed-line-endings', 'Files with mixed line endings cannot be edited safely.');
      }
      const { writable } = await access(file, signal);
      return { ok: true, text, version: info.version, writable };
    }),

    /**
     * Replace a workspace file only if it still has the version the editor loaded.
     * @param {{ address: unknown, text: unknown, baseVersion: unknown }} request - write request.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<object>} the new version, or a typed failure.
     */
    save: (request, signal) => answer(async () => {
      if (typeof request?.text !== 'string' || typeof request?.baseVersion !== 'string') {
        throw new FileRequestError('bad-request', 'A save needs text and the version it was based on.');
      }
      const file = await locate(request.address, signal);
      const { inside, policy } = await access(file, signal);
      if (!inside) throw new FileRequestError('outside-workspace', 'Only regular files inside the workspace can be saved.');
      const intent = { kind: 'replaceIfVersion', version: request.baseVersion };
      const outcome = await fs.writeText(file.target, request.text, intent, signal, policy);
      return { ok: true, version: outcome.version };
    }),
  };
}
