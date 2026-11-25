/** Tab body of the Markdown claim: hand the file to the built-in preview tab and leave. */
import { useEffect, useRef } from 'react';

/**
 * Transient body for a claimed Markdown file.
 *
 * The tab exists only to win the address ranking away from another plugin's file viewer (see `claim.js`). It renders nothing and re-opens the
 * same address under the built-in preview's kind, which names the type instead of ranking it, so the preview tab opens with this plugin's
 * document body inside. `replaceTab` swaps this claim for the preview in the same pane, so the file still appears where the click landed.
 * @param {any} props - tab body props: the seat's tab reader and the injected hand-off.
 * @returns {null} nothing is drawn.
 */
export function MarkdownClaimBody({ useTabInfo, handOff }) {
  const { tab } = useTabInfo();
  const handedOff = useRef(false);
  useEffect(() => {
    if (handedOff.current) return;
    handedOff.current = true;
    try {
      handOff(tab);
    } catch (error) {
      console.error('[quirekit-md-editor]', error);
    }
    // A preview tab that is already open is revealed rather than replaced, so
    // this claim is still here: close it instead of leaving a blank tab behind.
    if (!tab.signal.aborted) tab.actions.close();
  }, [tab, handOff]);
  return null;
}
