/**
 * Claim Markdown file addresses from other right-Sidebar tab types and hand them to the built-in preview tab.
 *
 * This plugin contributes a document *body*, not a tab type. A body only renders inside the Sidebar's document preview tab, and that tab
 * registers at the `fallback` band. Any other plugin that claims file addresses — a Better Sidebar editor, a Mark Text editor — registers
 * at `extension` and outranks it, so clicking a `.md` opens the other plugin's viewer and the preview tab (with this editor in it) never
 * opens. That is the whole bug this module addresses.
 *
 * The tab registry ranks claimers by priority band, then by the length of the glob that matched, then by registration order. A claim whose
 * patterns match the whole address and are longer than a general `dsh-resource://file/**` therefore wins the file; its body then re-opens
 * the address under the built-in preview's kind. Naming the kind skips the ranking entirely, so the file lands in the preview tab and this
 * plugin's document body renders as usual.
 *
 * The claim only stays registered while another type would otherwise outrank the preview; without such a competitor the preview tab opens
 * directly and nothing here runs.
 */

/** The shipped document preview's tab-type id: the type whose tab hosts this plugin's body. */
export const PREVIEW_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview';

/** This claim's tab-type id, unique across every registered tab type. */
export const CLAIM_ID = 'dsh-quirekit-md-editor:markdown';

/** The kind this claim registers; a kind holds one `extension` registration and no other, so the name is this plugin's alone. */
export const CLAIM_KIND = 'quirekit-markdown';

/** The Markdown file suffixes this editor renders; the claim routes exactly these. */
export const MARKDOWN_EXTENSIONS = Object.freeze(['md', 'markdown']);

/**
 * Whole-address globs that recognize Markdown files.
 *
 * They are written against the complete address (a pattern containing `:` matches the URI, not its path) and end in a specific suffix, so
 * each one is longer than the general `dsh-resource://file/**` a catch-all file viewer declares. Length is what breaks a tie between two
 * `extension` claimers, and the registry supplies `nocase`, so `.MD` matches too.
 */
export const CLAIM_PATTERNS = Object.freeze(MARKDOWN_EXTENSIONS.map(extension => `dsh-resource://file/**/*.${extension}`));

/** Session id used for the probe when the client has not listed a Session yet; ranking never resolves it. */
const PROBE_SESSION = 'quirekit-markdown-claim';

/** The probe names a Markdown file; only the suffix matters, never the file itself. */
const PROBE_FILE = 'probe.md';

/**
 * A file address to probe the tab registry with.
 * @param {readonly string[]} [sessionIds] - listed Session ids, most representative first.
 * @returns {string} a session-scoped Markdown file address.
 */
export function probeAddress(sessionIds = []) {
  const id = sessionIds.find(sessionId => typeof sessionId === 'string' && sessionId !== '') ?? PROBE_SESSION;
  return `dsh-resource://file/session/${encodeURIComponent(id)}/${PROBE_FILE}`;
}

/**
 * Whether another tab type would open a Markdown file ahead of the built-in preview.
 *
 * This is the claim's on/off switch: with no competitor the preview tab opens by itself and the claim must not register, so the plugin
 * behaves exactly as it did before this module existed.
 * @param {readonly { readonly id: string }[]} candidates - registered types that would open the probe address, best first.
 * @returns {boolean} true while a type other than this claim outranks the preview.
 */
export function needsClaim(candidates) {
  const preview = candidates.findIndex(candidate => candidate.id === PREVIEW_ID);
  if (preview <= 0) return false;
  return candidates.slice(0, preview).some(candidate => candidate.id !== CLAIM_ID);
}

/**
 * The kind the built-in preview tab registers under, read from the live registry.
 * @param {readonly { readonly id: string, readonly kind: string }[]} entries - registered tab types in force.
 * @returns {string | undefined} the kind to claim with, or undefined when the preview is not available.
 */
export function previewKind(entries) {
  return entries.find(entry => entry.id === PREVIEW_ID)?.kind;
}

/**
 * The tab title for a claim: the file's own name, shown only for the moment before the preview tab replaces it.
 * @param {string} address - Markdown file address.
 * @returns {string} decoded file name.
 */
export function fileNameOf(address) {
  const name = address.split(/[?#]/u, 1)[0].split('/').pop() ?? address;
  try {
    return decodeURIComponent(name) || address;
  } catch {
    // A malformed percent escape is still a name; showing it raw beats dropping the chip.
    return name;
  }
}

/**
 * Whether an address is one the built-in preview accepts.
 *
 * The preview claims Session-scoped addresses only; an absolute address has no Session to resolve it against and its preview tab refuses
 * the address. The claim must not take those, or the hand-off would throw instead of opening the file.
 * @param {string} address - a file resource address.
 * @returns {boolean} true for a `dsh-resource://file/session/<sessionId>/<path>` address.
 */
export function isSessionFile(address) {
  return address.startsWith('dsh-resource://file/session/');
}

/**
 * The claim's tab-type definition.
 * @returns {object} the definition to register into `sidebarRightTabs`.
 */
export function claimDefinition() {
  return {
    id: CLAIM_ID,
    kind: CLAIM_KIND,
    patterns: [...CLAIM_PATTERNS],
    priority: 'extension',
    canOpen: isSessionFile,
    title: fileNameOf,
  };
}

/**
 * Keep the claim registered exactly while the registry would otherwise send Markdown files to another type.
 *
 * It subscribes before the first check, so a competitor that registers while this runs is still seen. A registration publishes
 * synchronously and re-enters the listener, so the pass that is registering is guarded against registering twice.
 * @param {object} options - the live registry and the address to ask it about.
 * @param {{ candidates: (address: string) => readonly { readonly id: string }[], register: (definition: object) => (() => void), subscribe: (listener: () => void) => (() => void) }} options.tabs - the right-Sidebar tab registry.
 * @param {() => string} options.probe - a Markdown file address to rank.
 * @param {() => object} [options.definition] - definition factory, so a re-registration gets a fresh object.
 * @returns {() => void} disposer that stops watching and releases the claim.
 */
export function watchClaim({ tabs, probe, definition = claimDefinition }) {
  let disposeClaim;
  let registering = false;
  const sync = () => {
    if (registering) return;
    const needed = needsClaim(tabs.candidates(probe()));
    if (needed === (disposeClaim !== undefined)) return;
    if (needed) {
      registering = true;
      try {
        disposeClaim = tabs.register(definition());
      } finally {
        registering = false;
      }
    } else {
      const dispose = disposeClaim;
      disposeClaim = undefined;
      dispose();
    }
  };
  const unsubscribe = tabs.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    disposeClaim?.();
    disposeClaim = undefined;
  };
}
