/** DSH-native controls: the document toolbar view switch and the plugin settings panel. */
import { useEffect, useRef, useState } from 'react';
import { SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { TOOLBARS, VIEWS, setTabView, updateSettings, useSettings, useTabView } from './settings.js';

const VIEW_LABELS = { document: 'viewDocument', preview: 'viewPreview', source: 'viewSource' };
const COMPACT_VIEW_LABELS = { document: 'viewDocumentShort', preview: 'viewPreviewShort', source: 'viewSourceShort' };
const TOOLBAR_LABELS = { fixed: 'toolbarFixed', floating: 'toolbarFloating', hidden: 'toolbarHidden' };

/** Sidebar width below which the switch yields to the DSH toolbar buttons, in pixels. */
const HIDDEN_SIDEBAR_WIDTH = 440;

/**
 * Build segmented options from values and their locale keys.
 * @param {readonly string[]} values - option values.
 * @param {Record<string, string>} labels - locale key per value.
 * @param {(key: string) => string} t - locale reader.
 * @returns {{ value: string, label: string }[]} control options.
 */
function optionsOf(values, labels, t) {
  return values.map(value => ({ value, label: t(labels[value]) }));
}

/**
 * Switch the current document between the three editing views.
 * @param {any} props - DSH document action props.
 * @returns {JSX.Element | null} the switch, or nothing when turned off.
 */
export function ViewSwitcher({ useTabInfo, t }) {
  const { tab } = useTabInfo();
  const { viewSwitcher } = useSettings();
  const view = useTabView(tab.id);
  const anchor = useRef(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);

  useEffect(() => {
    const sidebar = anchor.current?.closest('[data-sidebar-right-panel]');
    if (!sidebar) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, [viewSwitcher]);

  if (!viewSwitcher) return null;
  return (
    <span ref={anchor} className="qk-dsh-view-switcher">
      {width >= HIDDEN_SIDEBAR_WIDTH && (
        <SegmentedControl
          id={`qk-dsh-view-${tab.id}`}
          label={t('viewLabel')}
          value={view}
          options={optionsOf(VIEWS, COMPACT_VIEW_LABELS, t)}
          onChange={next => setTabView(tab.id, next)}
        />
      )}
    </span>
  );
}

/**
 * Plugin settings on the DSH Plugins page.
 * @param {any} props - DSH bundle configuration props.
 * @returns {JSX.Element} the settings rows.
 */
export function EditorSettings({ t }) {
  const settings = useSettings();
  return (
    <div className="qk-dsh-settings">
      <div className="qk-dsh-setting">
        <div>
          <div className="qk-dsh-setting-title">{t('settingDefaultView')}</div>
          <div className="qk-dsh-setting-hint">{t('settingDefaultViewHint')}</div>
        </div>
        <SegmentedControl
          id="qk-dsh-default-view"
          label={t('settingDefaultView')}
          value={settings.defaultView}
          options={optionsOf(VIEWS, VIEW_LABELS, t)}
          onChange={defaultView => updateSettings({ defaultView })}
        />
      </div>
      <div className="qk-dsh-setting">
        <div>
          <div className="qk-dsh-setting-title">{t('settingViewSwitcher')}</div>
          <div className="qk-dsh-setting-hint">{t('settingViewSwitcherHint')}</div>
        </div>
        <Switch
          label={t('settingViewSwitcher')}
          checked={settings.viewSwitcher}
          onChange={viewSwitcher => updateSettings({ viewSwitcher })}
        />
      </div>
      <div className="qk-dsh-setting">
        <div>
          <div className="qk-dsh-setting-title">{t('settingToolbar')}</div>
          <div className="qk-dsh-setting-hint">{t('settingToolbarHint')}</div>
        </div>
        <SegmentedControl
          id="qk-dsh-toolbar"
          label={t('settingToolbar')}
          value={settings.toolbar}
          options={optionsOf(TOOLBARS, TOOLBAR_LABELS, t)}
          onChange={toolbar => updateSettings({ toolbar })}
        />
      </div>
    </div>
  );
}
