/** The tool an agent calls to close the comments it has acted on. */

export const RESOLVE_COMMENT_TOOL = 'resolve_document_comment';

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'comment_ids'],
  properties: {
    file: { type: 'string', description: 'The Markdown file path exactly as the request gave it.' },
    comment_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of the comments you have fully handled.' },
  },
};

const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['resolved', 'unknown'],
  properties: {
    resolved: { type: 'array', items: { type: 'string' } },
    unknown: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * @param {string} sessionId - owning Session.
 * @param {string} path - workspace path.
 * @returns {string} the document's resource address.
 */
function sessionFileAddress(sessionId, path) {
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Build the tool definition. It is written out because the host's `defineTool` helper cannot be resolved from an installed plugin.
 * @param {{ resolve: Function }} comments - comment storage.
 * @returns {object} DSH tool definition.
 */
export function createResolveCommentTool(comments) {
  return {
    name: RESOLVE_COMMENT_TOOL,
    description: 'Mark comments on a Markdown document as resolved in the QuireKit editor. Call it only with comment IDs given in the request, and only after the change each comment asks for is made. Leave a comment unresolved if you did not act on it.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      render: (_args, value) => [{ type: 'text', text: `Resolved: ${value.resolved.join(', ') || 'none'}. Unknown IDs: ${value.unknown.join(', ') || 'none'}.` }],
    },
    /**
     * @param {any} args - model arguments.
     * @param {any} exec - tool execution.
     * @returns {Promise<{ resolved: string[], unknown: string[] }>} what happened to each id.
     */
    async execute(args, exec) {
      const ids = args?.comment_ids;
      if (typeof args?.file !== 'string' || !Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
        throw new Error('file must be a string and comment_ids an array of strings.');
      }
      if (exec.agent === undefined) throw new Error('This tool needs a Session.');
      return comments.resolve({ address: sessionFileAddress(exec.agent.session.id, args.file), ids }, exec.signal);
    },
  };
}
