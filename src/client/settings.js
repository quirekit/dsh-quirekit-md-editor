/** Editor display preferences, kept per browser the same way DSH keeps its sidebar layout. */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'dsh-quirekit-md-editor.settings';

export const VIEWS = ['document', 'preview', 'source'];
export const TOOLBARS = ['fixed', 'floating', 'hidden'];
export const DEFAULT_SETTINGS = Object.freeze({ defaultView: 'document', viewSwitcher: true, toolbar: 'fixed' });

/**
 * Keep only known preference values so stored data from another version cannot break the editor.
 * @param {any} value - parsed stored value.
 * @returns {{ defaultView: string, viewSwitcher: boolean, toolbar: string }} complete settings.
 */
export function normalizeSettings(value) {
  return {
    defaultView: VIEWS.includes(value?.defaultView) ? value.defaultView : DEFAULT_SETTINGS.defaultView,
    viewSwitcher: typeof value?.viewSwitcher === 'boolean' ? value.viewSwitcher : DEFAULT_SETTINGS.viewSwitcher,
    toolbar: TOOLBARS.includes(value?.toolbar) ? value.toolbar : DEFAULT_SETTINGS.toolbar,
  };
}

/**
 * Read stored settings; unavailable or damaged storage falls back to the defaults.
 * @returns {{ defaultView: string, viewSwitcher: boolean, toolbar: string }} current settings.
 */
function readStored() {
  try {
    return normalizeSettings(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return normalizeSettings(undefined);
  }
}

let settings = readStored();
const tabViews = new Map();
const listeners = new Set();

/** Notify every subscribed component of a change. */
function notify() {
  for (const listener of listeners) listener();
}

/**
 * Observe settings and tab view changes, including edits from other windows.
 * @param {() => void} listener - change callback.
 * @returns {() => void} unsubscribe callback.
 */
function subscribe(listener) {
  listeners.add(listener);
  const fromOtherWindow = (event) => {
    if (event.key !== STORAGE_KEY) return;
    settings = readStored();
    notify();
  };
  globalThis.addEventListener?.('storage', fromOtherWindow);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.('storage', fromOtherWindow);
  };
}

/**
 * Change some settings and persist them; the change still applies if storage is unavailable.
 * @param {object} patch - changed fields.
 */
export function updateSettings(patch) {
  settings = normalizeSettings({ ...settings, ...patch });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows can refuse storage; the setting lasts for this page.
  }
  notify();
}

/** @returns {{ defaultView: string, viewSwitcher: boolean, toolbar: string }} current settings. */
export function getSettings() {
  return settings;
}

/**
 * Remember the view chosen in one document tab.
 * @param {string} tabId - document tab.
 * @param {string} view - chosen view.
 */
export function setTabView(tabId, view) {
  if (!VIEWS.includes(view)) return;
  tabViews.set(tabId, view);
  notify();
}

/**
 * Forget a closed tab's view.
 * @param {string} tabId - document tab.
 */
export function clearTabView(tabId) {
  tabViews.delete(tabId);
}

/**
 * Resolve a tab's view: without the switcher a tab cannot hold its own choice.
 * @param {string} tabId - document tab.
 * @returns {string} view to show.
 */
export function resolveTabView(tabId) {
  return (settings.viewSwitcher ? tabViews.get(tabId) : undefined) ?? settings.defaultView;
}

/** @returns {{ defaultView: string, viewSwitcher: boolean, toolbar: string }} settings, kept current in React. */
export function useSettings() {
  return useSyncExternalStore(subscribe, getSettings);
}

/**
 * @param {string} tabId - document tab.
 * @returns {string} the tab's view, kept current in React.
 */
export function useTabView(tabId) {
  return useSyncExternalStore(subscribe, () => resolveTabView(tabId));
}

/**
 * Next view in the switcher order, for the editor's view shortcut.
 * @param {string} view - current view.
 * @returns {string} following view.
 */
export function nextView(view) {
  return VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
}
