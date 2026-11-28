// The tab bar, as the shell's tabBar writes it (layout.css: .tabbar): a role=tablist of role=tab buttons,
// the selected one (or the first enabled) aria-selected with tabindex 0, each with its data-tab, its count
// in span.n (blue while waiting), and, for a good panel and tab id, its id and aria-controls. The keyboard
// stays the binder's (bindTabBar), which reads the same attributes.
const TAB_PANEL = /^[a-z][a-z0-9-]*$/;
const TAB_ID = /^[A-Za-z0-9_-]+$/;

export type Tab = { id: string; label: string; count?: string | number | null; waiting?: boolean; disabled?: boolean };

export type TabBarProps = {
  tabs: Tab[];
  selected?: string | null;
  panel?: string | null;
  size?: 'sub' | null;
  onSelect?: (id: string) => void;
};

export default function TabBar({ tabs, selected = null, panel = null, size = null, onSelect }: TabBarProps) {
  const sel = tabs.some((t) => t.id === selected && !t.disabled) ? selected : tabs.find((t) => !t.disabled)?.id;
  const goodPanel = typeof panel === 'string' && TAB_PANEL.test(panel);
  return (
    <div className={size === 'sub' ? 'tabbar sub' : 'tabbar'} role="tablist">
      {tabs.map((t) => {
        const on = t.id === sel;
        const ctl = goodPanel && TAB_ID.test(String(t.id ?? ''));
        const n = t.count === undefined || t.count === null || t.count === '' ? null : String(t.count);
        return (
          <button key={t.id} type="button" role="tab" data-tab={t.id} id={ctl ? `tab-${panel}-${t.id}` : undefined} aria-controls={ctl ? panel ?? undefined : undefined} aria-selected={on} tabIndex={on ? 0 : -1} aria-disabled={t.disabled ? true : undefined} onClick={onSelect ? () => onSelect(t.id) : undefined}>
            {n === null ? t.label : `${t.label} `}
            {n === null ? null : <span className={t.waiting ? 'n blue' : 'n'}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
