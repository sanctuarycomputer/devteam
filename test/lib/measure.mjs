// The measure check (dashboard-shell@1, test/contracts/shell.md): one function run in a page
// in headless Chrome, returning what breaks the layout rules, each failure named by its check. The
// owner's mock carries the same check (artifacts/dashboard-cleanup, measureCheck); this is it with the
// selectors as options and three checks added (head-h, header-pad, tab-motion).
//
// Checks: prose (running text wider than --measure), overflow (a box sticking out of its parent),
// uneven (cards side by side of different heights), head-end (a card head's last item short of its
// right edge), page-top (the first content not --page-top below the bar), head-h (a card head not
// --head-h tall), header-pad (the bar's title or Inbox button not --header-pad from its ends),
// tab-motion (a tab or its underline with a transition).

export const CHECKS = ['prose', 'overflow', 'uneven', 'head-end', 'page-top', 'head-h', 'header-pad', 'tab-motion'];
export const SIZES = [[1440, 900], [720, 800], [390, 844]];
export const DEFAULTS = {
  view: '.page',
  bar: '.pagebar',
  title: '.pagebar h1',
  inbox: '.pagebar .tt',
  prose: 'p, .ctx, .goal-next, .doc li',
  // overlays and on-purpose exceptions (pins, popovers, toasts), and regions not yet on the shell (.no-shell)
  ignore: 'script, style, svg, pre, code, textarea, [hidden], .toast, .pin, .menu-pop, .no-shell',
};

// The in-page function. It is serialised, so it uses nothing from this module.
export function measureInPage(o) {
  const out = [];
  const fail = (check, what) => out.push(`${check}: ${what}`);
  const px = (v) => parseFloat(v) || 0;
  const root = getComputedStyle(document.documentElement);
  const token = (name) => {
    // a token's value in px, resolved by the browser (calc() included)
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;width:var(${name})`;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  const measure = token('--measure'), pageTop = px(root.getPropertyValue('--page-top')), headH = token('--head-h'), headerPad = token('--header-pad');
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`;
  const shown = (el) => { const cs = getComputedStyle(el); return !!(el.offsetParent || cs.position === 'fixed') && cs.visibility !== 'hidden' && el.getBoundingClientRect().width > 0; };
  const skip = (el) => !!el.closest(o.ignore);
  const all = [...document.querySelectorAll('body *')].filter((el) => !skip(el) && shown(el));

  for (const el of all) {
    if (!el.matches(o.prose)) continue;
    const cs = getComputedStyle(el);
    const w = el.getBoundingClientRect().width - px(cs.paddingLeft) - px(cs.paddingRight);
    if (w > measure + 1) fail('prose', `${name(el)} is ${Math.round(w)}px, wider than --measure ${Math.round(measure)}px: "${el.textContent.trim().slice(0, 40)}"`);
  }
  const clips = (n) => { for (let x = n; x && x !== document.body; x = x.parentElement) if (/auto|scroll|hidden|clip/.test(getComputedStyle(x).overflowX)) return true; return false; };
  for (const el of all) {
    const p = el.parentElement;
    if (!p || p === document.body || p === document.documentElement) continue;
    // an overlay (absolute or fixed) is placed on purpose, and a container that scrolls or clips holds what it holds
    if (/absolute|fixed/.test(getComputedStyle(el).position) || clips(p)) continue;
    const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
    if (r.right > pr.right + 1 || r.left < pr.left - 1) fail('overflow', `${name(el)} sticks out of ${name(p)} by ${Math.round(Math.max(r.right - pr.right, pr.left - r.left))}px`);
  }
  const cards = all.filter((c) => c.matches('.card') && !c.closest('.drawer, .threads, .fcard'));
  for (const c of cards) for (const d of cards) {
    if (c === d || c.parentElement !== d.parentElement) continue;
    const a = c.getBoundingClientRect(), b = d.getBoundingClientRect();
    if (Math.abs(a.top - b.top) < 2 && a.left < b.left && Math.abs(a.height - b.height) > 1) fail('uneven', `${name(c)} is ${Math.round(a.height)}px beside ${name(d)} at ${Math.round(b.height)}px`);
  }
  for (const hd of all.filter((h) => h.matches('.card-head'))) {
    const r = hd.getBoundingClientRect();
    if (Math.abs(r.height - headH) > 0.5) fail('head-h', `${name(hd)} "${hd.textContent.trim().slice(0, 30)}" is ${Math.round(r.height * 10) / 10}px tall, not --head-h ${headH}px`);
    const last = [...hd.children].filter(shown).pop();
    if (!last) continue;
    const gap = r.right - px(getComputedStyle(hd).paddingRight) - px(getComputedStyle(hd).borderRightWidth) - last.getBoundingClientRect().right;
    if (gap > 2) fail('head-end', `${name(hd)} "${hd.textContent.trim().slice(0, 30)}": its last item ends ${Math.round(gap)}px short of the right edge`);
  }
  const bar = document.querySelector(o.bar);
  const view = document.querySelector(o.view);
  if (bar) {
    const br = bar.getBoundingClientRect();
    const t = document.querySelector(o.title), b = document.querySelector(o.inbox);
    if (t && shown(t)) { const d = t.getBoundingClientRect().left - br.left; if (Math.abs(d - headerPad) > 0.5) fail('header-pad', `the title starts ${Math.round(d * 10) / 10}px from the bar's left, not --header-pad ${headerPad}px`); }
    if (b && shown(b)) { const d = br.right - b.getBoundingClientRect().right; if (Math.abs(d - headerPad) > 0.5) fail('header-pad', `the Inbox button ends ${Math.round(d * 10) / 10}px from the bar's right, not --header-pad ${headerPad}px`); }
  }
  if (bar && view && window.scrollY === 0) {
    const first = [...view.children].find((c) => shown(c) && c.getBoundingClientRect().height);
    // the visual top: a tab's text, the first top border, or the first line of text
    const textTop = (n) => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().top; };
    const visualTop = (el) => {
      const tab = el.matches('.tabbar') ? el.querySelector('[role=tab]') : null;
      if (tab) return textTop(tab);
      const w = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = el; n; n = w.nextNode()) {
        if (n.nodeType === 3) { if (n.textContent.trim()) return textTop(n); continue; }
        if (n !== el && !shown(n)) continue;
        const cs = getComputedStyle(n);
        if (px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') return n.getBoundingClientRect().top;
      }
      return el.getBoundingClientRect().top;
    };
    if (first) { const gap = visualTop(first) - bar.getBoundingClientRect().bottom; if (Math.abs(gap - pageTop) > 1) fail('page-top', `${name(first)} starts ${Math.round(gap)}px below the bar, not --page-top ${pageTop}px`); }
  }
  for (const tab of all.filter((t) => t.matches('[role="tab"]'))) {
    for (const [cs, part] of [[getComputedStyle(tab), 'the tab'], [getComputedStyle(tab, '::after'), 'its underline']]) {
      const durs = cs.transitionDuration.split(',').map(px), delays = cs.transitionDelay.split(',').map(px);
      if (cs.transitionProperty !== 'none' && durs.some((d, i) => d + (delays[i] || 0) > 0)) fail('tab-motion', `${part} of tab "${tab.textContent.trim().slice(0, 20)}" has a transition (${cs.transitionProperty} ${cs.transitionDuration})`);
    }
  }
  return out;
}

// a page's prose and ignore add to the defaults; its view, bar, title and inbox replace them
const opts = (o = {}) => ({ ...DEFAULTS, ...o, prose: [DEFAULTS.prose, o.prose].filter(Boolean).join(', '), ignore: [DEFAULTS.ignore, o.ignore].filter(Boolean).join(', ') });

// What breaks in the page as it is now. p is a page from test/lib/chrome.mjs's newPage().
export async function measure(p, o = {}) {
  return p.ev(`(${measureInPage.toString()})(${JSON.stringify(opts(o))})`);
}

// Load url at each size (1440x900, 720x800, 390x844 by default) and measure: { '1440x900': [...], … }.
// ready, when given, is an expression the page must make true before it is measured.
export async function measureAt(p, url, { sizes = SIZES, ready = 'true', ...o } = {}) {
  const res = {};
  for (const [width, height] of sizes) {
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.navigate', { url });
    const end = Date.now() + 15000;
    for (;;) {
      const ok = await p.ev(`document.readyState === 'complete' && !!(${ready})`).catch(() => false);
      if (ok) break;
      if (Date.now() > end) throw new Error(`${url} at ${width}x${height}: not ready (${ready})`);
      await new Promise((r) => setTimeout(r, 50));
    }
    await p.ev('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    res[`${width}x${height}`] = await measure(p, o);
  }
  return res;
}
