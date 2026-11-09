/** Host half: mounts the browser half and exposes authenticated routes under Connection's /api. */
import { createCommentOperations } from './comments.js';
import { createFileOperations } from './files.js';
import { FRAME_ROUTE, serveEditorFrame } from './frame.js';
import { createImageOperations } from './images.js';
import { markdownSkillProvider } from './skill.js';
import { createResolveCommentTool } from './tool.js';

export const name = 'dsh-quirekit-md-editor';
export const inject = ['connection', 'fs', 'sandboxPolicy', 'sessions', 'webServer'];

/** Route prefix shared with the browser half. */
export const ROUTE_PREFIX = '/api/dsh-quirekit-md-editor';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Serialize a typed operation result.
 * @param {object} result - operation result.
 * @returns {Response} JSON response.
 */
function json(result) {
  return Response.json(result, { headers: NO_STORE });
}

/**
 * Register the plugin's routes for its lifetime.
 * @param {any} ctx - Cordis host context.
 */
export function apply(ctx) {
  const services = {
    fs: ctx.fs,
    sessions: ctx.sessions,
    sandboxPolicy: ctx.sandboxPolicy,
    get sessionPersistence() { return ctx.get('sessionPersistence'); },
  };
  const documents = createFileOperations(services);
  const images = createImageOperations(services);
  const comments = createCommentOperations(services);

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: FRAME_ROUTE, handler: serveEditorFrame }), 'quirekit-md-editor: editor frame');
  ctx.inject(['skills'], scope => scope.skills.registerProvider(() => markdownSkillProvider));
  ctx.inject(['tools'], scope => scope.tools.register(createResolveCommentTool(comments)));

  const handlers = {
    open: async (request) => {
      const payload = await request.json().catch(() => undefined);
      const file = await documents.open(payload, request.signal);
      return json(file.ok ? { ...file, comments: await comments.read(payload.address, request.signal), resolvedComments: comments.takeResolved(payload.address) } : file);
    },
    comments: async request => json(await comments.save(await request.json().catch(() => undefined), request.signal)),
    save: async request => json(await documents.save(await request.json().catch(() => undefined), request.signal)),
    image: async (request) => {
      const result = await images.read(await request.json().catch(() => undefined), request.signal);
      if (!result.ok) return json(result);
      return new Response(result.bytes, { headers: { 'content-type': result.type, ...NO_STORE } });
    },
    upload: async (request) => {
      const address = new URL(request.url).searchParams.get('address');
      const bytes = new Uint8Array(await request.arrayBuffer());
      return json(await images.store({ address, bytes, type: request.headers.get('content-type') }, request.signal));
    },
  };

  for (const [endpoint, fetch] of Object.entries(handlers)) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: `${ROUTE_PREFIX}/${endpoint}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch,
    }), `quirekit-md-editor: ${endpoint} route`);
  }
}
