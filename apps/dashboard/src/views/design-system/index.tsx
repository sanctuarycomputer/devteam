'use client';
// apps-src@2: the design-system page, /#design-system on the dashboard's / (gate.tsx mounts it in place of
// the shell, by a dynamic import). A developer's index, linked from nowhere: the tokens the layout CSS
// defines, read at run time, and every component of src/shared/ui/ with its specimens, from the catalog
// scripts/ui-catalog.mjs writes. It reads no data: no /api/ call, no poll, no socket. A specimen's
// handlers only append to the page's own event list.
import '../../shared/layout/layout.css';
import './design-system.css';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { catalog } from './catalog.gen';
import type { On, Specimen } from './specimen';

type Token = { name: string; value: string; colour: boolean };
type Event = { n: number; where: string; event: string };
const EVENTS_KEPT = 50;

// Every custom property a :root rule of the page's own stylesheets defines (media rules included), with
// its value now. A stylesheet of another origin can't be read, and has none of the layout CSS.
function readTokens(): Token[] {
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        if (r.selectorText.split(',').some((s) => s.trim() === ':root')) for (const p of Array.from(r.style)) if (p.startsWith('--') && !p.startsWith('--lightningcss-')) names.add(p);
      } else if ('cssRules' in r) visit((r as CSSGroupingRule).cssRules);
    }
  };
  for (const s of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try { rules = s.cssRules; } catch { rules = null; }
    if (rules) visit(rules);
  }
  const cs = getComputedStyle(document.documentElement);
  return [...names].sort().map((name) => {
    const value = cs.getPropertyValue(name).trim();
    return { name, value, colour: /^(#|rgb|hsl|oklch|color\()/.test(value) && CSS.supports('color', value) };
  });
}

// A specimen that throws shows its error in place, and the rest of the page still renders.
// a specimen drawn as its own component, so a render that throws is caught by the Contain around it
function Draw({ specimen, on }: { specimen: Specimen; on: On }) {
  return <>{specimen.render(on)}</>;
}

class Contain extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() { return this.state.error === null ? this.props.children : <p className="ds-error" role="alert">This specimen threw: {this.state.error}</p>; }
}

export default function DesignSystem() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    // the page is the shell's no more: its title, and its tokens in the system's theme as it changes
    document.title = 'Design system · devteam';
    const read = () => setTokens(readTokens());
    read();
    const dark = matchMedia('(prefers-color-scheme: dark)');
    dark.addEventListener('change', read);
    return () => dark.removeEventListener('change', read);
  }, []);
  // loaded at a component's anchor (#design-system/<name>), the page scrolls to it once, when the tokens
  // above it are drawn: the browser looked for the anchor before the view existed
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || tokens.length === 0) return;
    jumped.current = true;
    let h = location.hash.slice(1);
    try { h = decodeURIComponent(h); } catch { /* a malformed hash is read as it is */ }
    if (h.startsWith('design-system/')) document.getElementById(h)?.scrollIntoView();
  }, [tokens]);
  // a specimen's only handler: one line on the event list, the newest first
  const onFor = useCallback((where: string): On => (event) => () => {
    setEvents((es) => [{ n: (es[0]?.n ?? 0) + 1, where, event }, ...es].slice(0, EVENTS_KEPT));
  }, []);
  const q = filter.trim().toLowerCase();
  const shown = (name: string) => !q || name.toLowerCase().includes(q);
  return (
    <main className="page ds" data-view="design-system">
      <header className="ds-head">
        <h1>Design system</h1>
        <p className="ds-text">The tokens and every shared component of the dashboard, each in its states. Nothing here reads or changes data: a control's handler only adds a line to the event list.</p>
      </header>
      <section className="ds-tokens" aria-labelledby="ds-tokens-h">
        <h2 id="ds-tokens-h">Tokens</h2>
        <dl className="ds-token-list">
          {tokens.map((t) => (
            <div className="ds-token" key={t.name} data-ds-token={t.name}>
              <dt><code>{t.name}</code></dt>
              <dd>{t.colour ? <span className="ds-swatch" style={{ background: t.value }} aria-hidden="true"></span> : null}<code className="ds-value">{t.value}</code></dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="ds-components" aria-labelledby="ds-components-h">
        <h2 id="ds-components-h">Components</h2>
        <label className="ds-filter">Filter by name <input type="search" id="ds-filter" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" spellCheck={false} /></label>
        {catalog.length === 0 ? <p className="ds-text ds-none">None</p> : (
          <nav className="ds-index" aria-label="Components">
            {catalog.map((c) => <a key={c.name} href={`#design-system/${c.name}`} hidden={!shown(c.name)}>{c.name}</a>)}
          </nav>
        )}
        {catalog.map((c) => (
          <article className="ds-entry" id={`design-system/${c.name}`} key={c.name} data-ds-component={c.name} hidden={!shown(c.name)}>
            <h3>{c.name}</h3>
            <p className="ds-meta"><code>{c.file}</code> · props: {c.props.length ? c.props.map((p) => <code key={p}>{p}</code>) : 'none'}</p>
            {c.specimens.map((s) => (
              <figure className="ds-specimen" key={s.title} data-ds-specimen={s.title}>
                <figcaption><b>{s.title}</b>{s.note ? <span className="ds-note"> {s.note}</span> : null}</figcaption>
                <div className="ds-stage"><Contain><Draw specimen={s} on={onFor(`${c.name} · ${s.title}`)} /></Contain></div>
              </figure>
            ))}
          </article>
        ))}
      </section>
      <section className="ds-events" aria-labelledby="ds-events-h">
        <h2 id="ds-events-h">Events</h2>
        {events.length === 0 ? <p className="ds-text ds-none">None</p> : (
          <ol id="ds-events" reversed>
            {events.map((e) => <li key={e.n}><code>{e.where}</code> {e.event}</li>)}
          </ol>
        )}
      </section>
    </main>
  );
}
