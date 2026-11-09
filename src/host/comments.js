/** Stores document comments in a hidden file beside the Markdown, so the source stays clean. */
import { posix } from 'node:path';
import { FileRequestError, answer, createFileLocator, parseSessionFileAddress } from './files.js';

/** Largest comment file accepted, in bytes. */
export const MAX_COMMENTS_BYTES = 2 * 1024 * 1024;

/**
 * @param {string} path - Markdown path.
 * @returns {string} path of its comment file.
 */
function commentsPath(path) {
  const { dir, base } = posix.parse(path);
  return posix.join(dir, `.${base}.comments.json`);
}

/** Recorded on threads an agent closes while the editor is not open. */
const AGENT_RESOLVER = Object.freeze({ id: 'dsh-agent', name: 'DSH', agent: true });

/**
 * @param {unknown} address - document address.
 * @returns {string | undefined} key of the resolutions waiting for its editor.
 */
function documentKey(address) {
  try {
    const { sessionId, path } = parseSessionFileAddress(address);
    return `${sessionId}\0${posix.normalize(path)}`;
  } catch {
    return undefined;
  }
}

/**
 * Build comment storage for one set of host services.
 * @param {{ fs: any, sessions: any, sandboxPolicy: any, sessionPersistence?: any }} services - DSH host services.
 * @returns {{ read: Function, save: Function }} comment operations.
 */
export function createCommentOperations(services) {
  const { fs } = services;
  const { locate, access } = createFileLocator(services);
  /** Thread ids an agent resolved, until the open editor collects them. */
  const waiting = new Map();

  /**
   * Replace a located document's comment file.
   * @param {{ path: string, workspaceRoot: string }} file - located document.
   * @param {string} text - serialized comments.
   * @param {any} policy - write policy.
   * @param {AbortSignal} signal - request cancellation.
   * @returns {Promise<void>} settles after the write.
   */
  async function writeComments(file, text, policy, signal) {
    const path = commentsPath(file.path);
    const entry = await fs.lstat(path, { cwd: file.workspaceRoot }, signal).catch((error) => {
      if (error?.code === 'FS_NOT_FOUND') return undefined;
      throw error;
    });
    if (entry !== undefined && entry.type !== 'file') throw new FileRequestError('outside-workspace', 'The comment file must be a regular file.');
    const target = await fs.resolve(path, { cwd: file.workspaceRoot, signal });
    await fs.writeText(target, text, undefined, signal, policy);
  }

  return {
    /**
     * Mark threads resolved on disk and leave them for the open editor, whose own saves would otherwise restore them.
     * @param {{ address: string, ids: readonly string[] }} request - document and thread ids.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<{ resolved: string[], unknown: string[] }>} what happened to each id.
     */
    async resolve({ address, ids }, signal) {
      const file = await locate(address, signal);
      const { writable, policy } = await access(file, signal);
      if (!writable) throw new FileRequestError('sandbox-denied', 'This document is read-only.');
      const target = await fs.resolve(commentsPath(file.path), { cwd: file.workspaceRoot, signal });
      const exchange = JSON.parse(await fs.readText(target, signal));
      const threads = new Map(exchange.threads.map(thread => [thread.id, thread]));
      const resolved = ids.filter(id => threads.has(id));
      const now = new Date().toISOString();
      for (const id of resolved) {
        const thread = threads.get(id);
        if (!thread.resolved) Object.assign(thread, { resolved: true, resolvedBy: AGENT_RESOLVER, resolvedAt: now });
      }
      const key = documentKey(address);
      waiting.set(key, [...(waiting.get(key) ?? []), ...resolved]);
      await writeComments(file, JSON.stringify(exchange, null, 2), policy, signal);
      return { resolved, unknown: ids.filter(id => !threads.has(id)) };
    },

    /**
     * Hand over the threads resolved since the editor last asked.
     * @param {unknown} address - document address.
     * @returns {string[]} thread ids.
     */
    takeResolved(address) {
      const key = documentKey(address);
      const ids = waiting.get(key) ?? [];
      waiting.delete(key);
      return ids;
    },

    /**
     * Read a document's comments; missing or damaged data means no comments.
     * @param {unknown} address - document address.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<object | null>} the stored exchange document.
     */
    async read(address, signal) {
      try {
        const file = await locate(address, signal);
        const target = await fs.resolve(commentsPath(file.path), { cwd: file.workspaceRoot, signal });
        return JSON.parse(await fs.readText(target, signal));
      } catch {
        return null;
      }
    },

    /**
     * Replace a document's comment file.
     * @param {{ address: unknown, comments: unknown }} request - document and exchange document.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<object>} success, or a typed failure.
     */
    save: (request, signal) => answer(async () => {
      const text = JSON.stringify(request?.comments, null, 2);
      if (typeof text !== 'string') throw new FileRequestError('bad-request', 'A save needs comments.');
      if (Buffer.byteLength(text) > MAX_COMMENTS_BYTES) throw new FileRequestError('too-large', 'Too many comments to store.');
      const file = await locate(request.address, signal);
      const { writable, policy } = await access(file, signal);
      if (!writable) throw new FileRequestError('sandbox-denied', 'This document is read-only.');
      await writeComments(file, text, policy, signal);
      return { ok: true };
    }),
  };
}
