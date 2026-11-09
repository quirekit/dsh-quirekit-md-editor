/** Document-relative calls to the host half; Connection admits them like any other /api request. */

const ROUTE_PREFIX = 'api/dsh-quirekit-md-editor';

/** Browsers refuse keepalive bodies above 64 KiB, so larger saves rely on the normal request. */
const KEEPALIVE_LIMIT = 60 * 1024;

/**
 * Post one JSON request to a host endpoint.
 * @param {'open' | 'save' | 'comments'} endpoint - host operation.
 * @param {object} payload - JSON request body.
 * @param {AbortSignal} [signal] - request cancellation.
 * @returns {Promise<any>} the host's typed result.
 */
export async function callHost(endpoint, payload, signal) {
  const body = JSON.stringify(payload);
  const response = await fetch(`${ROUTE_PREFIX}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    // A save started while the page closes must outlive the page.
    keepalive: endpoint === 'save' && body.length < KEEPALIVE_LIMIT,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) return { ok: false, code: `http-${response.status}`, message: response.statusText };
  return response.json();
}

/**
 * Create the editor's image bridge for one document.
 * @param {string} address - document resource address.
 * @returns {{ imageSource: Function, images: { upload: Function } }} MD Editor image options.
 */
export function createImageBridge(address) {
  return {
    /**
     * Resolve a Markdown destination to a displayable URL.
     * @param {string} url - stored destination.
     * @param {AbortSignal} signal - result lifetime.
     * @returns {Promise<string | { url: string, release: () => void }>} displayable image.
     */
    async imageSource(url, signal) {
      if (/^(?:https?:|data:|blob:)/iu.test(url)) return url;
      const response = await fetch(`${ROUTE_PREFIX}/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, url }),
        signal,
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Image unavailable: ${url}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      return { url: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
    },
    images: {
      /**
       * Store a pasted or dropped image beside the document.
       * @param {Blob} file - image bytes.
       * @param {{ signal: AbortSignal }} context - upload lifetime.
       * @returns {Promise<string>} Markdown destination.
       */
      async upload(file, context) {
        const response = await fetch(`${ROUTE_PREFIX}/upload?address=${encodeURIComponent(address)}`, {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file,
          signal: context.signal,
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.message);
        return result.url;
      },
    },
  };
}
