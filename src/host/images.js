/** Workspace image display and storage for images referenced by an open Markdown file. */
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { dirname, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileRequestError, answer, createFileLocator } from './files.js';

/** Largest image the editor displays or stores, in bytes. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const TYPE_BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
};
/** SVG is displayable but not accepted for new files: pasted markup can carry scripts. */
const EXTENSION_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };

/**
 * Normalize a Markdown image destination to a local path.
 * @param {unknown} url - destination from the Markdown source.
 * @returns {string} decoded path without query or fragment.
 */
function imagePath(url) {
  // Two or more letters: a single letter is a Windows drive, not a scheme.
  if (typeof url !== 'string' || url === '' || /^[a-z][a-z0-9+.-]+:/iu.test(url)) {
    throw new FileRequestError('unsupported-image', 'Only local image paths are served.');
  }
  try {
    return decodeURIComponent(url.split(/[?#]/u, 1)[0]);
  } catch {
    throw new FileRequestError('unsupported-image', 'The image path is not valid.');
  }
}

/**
 * Build image operations for one set of host services.
 * @param {{ fs: any, sessions: any, sandboxPolicy: any, sessionPersistence?: any }} services - DSH host services.
 * @param {{ mkdir: Function, realpath: Function, writeFile: Function }} [disk] - local file operations.
 * @returns {{ read: Function, store: Function }} image operations.
 */
export function createImageOperations(services, disk = nodeFs) {
  const { fs } = services;
  const { locate, access } = createFileLocator(services);

  /**
   * Find a slash-rooted path: inside the workspace when it exists there, otherwise on disk.
   * @param {any} file - located document.
   * @param {string} path - path starting with a slash.
   * @param {AbortSignal} signal - request cancellation.
   * @returns {Promise<string>} path to read.
   */
  async function rootedPath(file, path, signal) {
    const inWorkspace = posix.join('.', path);
    const target = await fs.resolve(inWorkspace, { cwd: file.workspaceRoot, signal });
    // The filesystem service reports a missing path as undefined.
    return fs.stat(target, signal).then(info => (info === undefined ? path : inWorkspace), () => path);
  }

  return {
    /**
     * Read one image the session can reach; only image files are served, so a document cannot pull in other files.
     * @param {{ address: unknown, url: unknown }} request - document and image destination.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<object>} bytes and media type, or a typed failure.
     */
    read: (request, signal) => answer(async () => {
      const file = await locate(request?.address, signal);
      const relativePath = imagePath(request?.url);
      const type = TYPE_BY_EXTENSION[posix.extname(relativePath).slice(1).toLowerCase()];
      if (type === undefined) throw new FileRequestError('unsupported-image', 'This file type is not an image.');
      const path = relativePath.startsWith('/') || /^[a-z]:[\\/]/iu.test(relativePath)
        ? await rootedPath(file, relativePath, signal)
        : posix.join(posix.dirname(file.path), relativePath);
      const target = await fs.resolve(path, { cwd: file.workspaceRoot, signal });
      return { ok: true, bytes: await fs.readBytes(target, signal, MAX_IMAGE_BYTES), type };
    }),

    /**
     * Store a pasted image beside the document under a content-derived name.
     * @param {{ address: unknown, bytes: Uint8Array, type: string }} request - document and image bytes.
     * @param {AbortSignal} signal - request cancellation.
     * @returns {Promise<object>} the Markdown destination, or a typed failure.
     */
    store: (request, signal) => answer(async () => {
      const extension = EXTENSION_BY_TYPE[request?.type];
      if (extension === undefined) throw new FileRequestError('unsupported-image', 'This image type cannot be stored.');
      if (request.bytes.length === 0 || request.bytes.length > MAX_IMAGE_BYTES) throw new FileRequestError('too-large', 'The image size is not accepted.');
      const file = await locate(request.address, signal);
      if (!(await access(file, signal)).writable) throw new FileRequestError('sandbox-denied', 'This document is read-only.');
      // The filesystem service only writes text, so binary storage is limited to local workspaces.
      const location = fs.fileUrl(file.target);
      if (!location.startsWith('file:')) throw new FileRequestError('unsupported-backend', 'Images can only be stored in local workspaces.');
      const directory = `${dirname(fileURLToPath(location))}${sep}assets`;
      await disk.mkdir(directory, { recursive: true });
      const [realDirectory, realRoot] = await Promise.all([disk.realpath(directory), disk.realpath(fileURLToPath(fs.fileUrl(file.root)))]);
      const fromRoot = relative(realRoot, realDirectory);
      if (fromRoot.startsWith('..') || fromRoot.startsWith(sep)) throw new FileRequestError('outside-workspace', 'The assets directory leaves the workspace.');
      const name = `${createHash('sha256').update(request.bytes).digest('hex').slice(0, 16)}.${extension}`;
      // Content-derived names make an existing file the same image.
      await disk.writeFile(`${realDirectory}${sep}${name}`, request.bytes, { flag: 'wx' }).catch((error) => {
        if (error?.code !== 'EEXIST') throw error;
      });
      return { ok: true, url: `assets/${name}` };
    }),
  };
}
