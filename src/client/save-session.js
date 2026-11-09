/** Autosave and external-change reconciliation for one open file; free of React and Vue. */

/** Quiet time after typing before a save starts, in milliseconds. */
const AUTOSAVE_DELAY = 700;

/** In-flight saves by address, so a remounted body never reads ahead of its own write. */
const pendingSaves = new Map();

/**
 * Wait for any save already running against an address.
 * @param {string} address - file resource address.
 * @returns {Promise<void>} settles once the save has finished.
 */
export function settledSave(address) {
  return pendingSaves.get(address) ?? Promise.resolve();
}

/**
 * Create the save state machine for one editor.
 * @param {{ address: string, text: string, version: string, call: Function, read: () => string | undefined, replace: (text: string) => void, onStatus: (status: string) => void, onSaved?: () => void }} options - file identity and editor callbacks.
 * @returns {object} session controls.
 */
export function createSaveSession(options) {
  const { address, call, read, replace, onStatus, onSaved } = options;
  let version = options.version;
  let saved = options.text;
  let timer;
  let running;
  let conflicted = false;
  let applying = false;

  /** @returns {boolean} whether the editor differs from the last text known to be on disk. */
  const dirty = () => { const text = read(); return text !== undefined && text !== saved; };

  /**
   * Write the current text once, then repeat if typing continued during the write.
   * @returns {Promise<void>} settles when the file matches the editor or the save failed.
   */
  async function write() {
    const text = read();
    if (text === undefined || text === saved) { onStatus('saved'); return; }
    onStatus('saving');
    const result = await call('save', { address, text, baseVersion: version });
    if (result.ok) {
      version = result.version;
      saved = text;
      onSaved?.();
      if (dirty()) await write();
      else onStatus('saved');
    } else if (result.code === 'conflict') {
      conflicted = true;
      onStatus('conflict');
    } else {
      onStatus(`failed:${result.code}`);
    }
  }

  /**
   * Start a write unless one is running or a conflict awaits the user's decision.
   * @returns {Promise<void>} the active write.
   */
  function flush() {
    clearTimeout(timer);
    if (running !== undefined) return running;
    if (conflicted) return Promise.resolve();
    running = write().finally(() => { running = undefined; pendingSaves.delete(address); });
    pendingSaves.set(address, running);
    return running;
  }

  /**
   * Stop autosaving because the disk can no longer be reconciled with the editor.
   * @param {string} code - failure code shown to the user.
   */
  function suspend(code) {
    conflicted = true;
    clearTimeout(timer);
    onStatus(`failed:${code}`);
  }

  /**
   * Replace the editor without treating the replacement as typing.
   * @param {string} text - disk text.
   * @param {string} nextVersion - its version.
   */
  function adopt(text, nextVersion) {
    applying = true;
    let accepted;
    try { accepted = replace(text); } finally { applying = false; }
    if (accepted === false) {
      // The editor still shows older text; autosaving it would overwrite the disk.
      suspend('replace-rejected');
      return;
    }
    saved = text;
    version = nextVersion;
    conflicted = false;
    onStatus('saved');
  }

  return {
    flush,
    suspend,
    /** Record an editor change and schedule the autosave. */
    changed() {
      if (applying || conflicted) return;
      onStatus('dirty');
      clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DELAY);
    },
    /**
     * Apply a fresh disk read: this plugin's own writes are ignored, unsaved typing is never replaced.
     * @param {string} text - disk text.
     * @param {string} nextVersion - its version.
     */
    reconcile(text, nextVersion) {
      if (nextVersion === version || running !== undefined) return;
      if (dirty()) { conflicted = true; clearTimeout(timer); onStatus('conflict'); return; }
      adopt(text, nextVersion);
    },
    /**
     * Resolve a conflict by discarding local edits.
     * @returns {Promise<void>} settles after the disk version is shown.
     */
    async loadDisk() {
      const result = await call('open', { address });
      if (result.ok) adopt(result.text, result.version);
      else onStatus(`failed:${result.code}`);
    },
    /**
     * Resolve a conflict by writing local edits over the current disk version.
     * @returns {Promise<void>} settles after the write.
     */
    async overwrite() {
      const result = await call('open', { address });
      if (!result.ok) { onStatus(`failed:${result.code}`); return; }
      version = result.version;
      saved = result.text;
      conflicted = false;
      await flush();
    },
    /** Cancel the timer and persist remaining edits; used when the body unmounts. */
    dispose() {
      clearTimeout(timer);
      if (dirty()) void flush();
    },
  };
}
