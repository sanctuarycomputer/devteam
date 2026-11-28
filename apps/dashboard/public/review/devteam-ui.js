/* devteam-ui.js: the bridge between a review page and the dashboard, and a few components that
   look like the dashboard. The dashboard serves it to review pages only, at
   /review/<qid>/devteam-ui.js (load it as src="devteam-ui.js"). No dependencies.

   A review page runs in a sandboxed frame with no network and no storage: everything it needs
   arrives in init, and everything it says goes to the dashboard as one of a few messages, which the
   dashboard checks. The page never answers: it proposes a result, the dashboard shows the owner
   exactly that result in its own panel, and the owner answers there.

     devteam.ready(({ question, data, draft, result, readonly, theme }) => { … })
     devteam.progress(done, total)     the "12 of 38 decided" pill
     devteam.draft(state)              partial progress, saved by the dashboard (debounced)
     devteam.propose(result)           the result the owner will see in the answer panel
     devteam.markdown(text)            → Promise<html>, rendered and sanitised by the dashboard
     devteam.open(href | { path, ref } | { url })   a link, opened by the dashboard (https asks the owner first)
     ui.table, ui.multiselect, ui.select, ui.radios, ui.tabs, ui.filterBar, ui.tally
     ui.grid(spec)                     a whole review grid in the standard result shape (a convenience)
*/
(function () {
  'use strict';
  const host = window.parent;
  let init = null;
  const readyFns = [];
  const themeFns = [];
  const pendingMd = new Map();
  let mdSeq = 0;

  const send = (msg) => { if (host && host !== window) host.postMessage(msg, '*'); };
  // Only JSON crosses: a function or a DOM node in a state would fail to clone.
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // An error in the page is shown in the page, so whoever drew it sees it in the preview.
  function showError(e) {
    const box = document.createElement('div');
    box.className = 'page-error';
    box.textContent = `This page hit an error: ${e && e.message ? e.message : e}`;
    (document.body || document.documentElement).prepend(box);
  }
  window.addEventListener('error', (ev) => showError(ev.error || ev.message));
  const call = (fn) => { try { fn(init); } catch (e) { showError(e); console.error(e); } };
  const applyTheme = (t) => {
    if (!t || typeof t.dark !== 'boolean') return;
    document.documentElement.dataset.theme = t.dark ? 'dark' : 'light';
    themeFns.forEach((fn) => { try { fn(t); } catch (e) { showError(e); } });
  };

  window.addEventListener('message', (ev) => {
    if (ev.source !== host) return;
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'init' && !init) {
      init = m;
      applyTheme(m.theme);
      readyFns.splice(0).forEach(call);
    } else if (m.type === 'markdown-result') {
      const resolve = pendingMd.get(m.id);
      if (resolve) { pendingMd.delete(m.id); resolve(String(m.html ?? '')); }
    } else if (m.type === 'theme') applyTheme(m);
  });

  const sendDraft = debounce((state) => send({ type: 'draft', state }), 400);
  const devteam = {
    ready(fn) { if (init) call(fn); else readyFns.push(fn); },
    get init() { return init; },
    progress(done, total) { send({ type: 'progress', done: Math.max(0, Number(done) || 0), total: Math.max(0, Number(total) || 0) }); },
    draft(state) { sendDraft(plain(state)); },
    // The result names its question and the hashes of the page and data it was made on; the
    // dashboard and the owner's process both check them.
    propose(result) {
      const q = (init && init.question) || {};
      const head = { v: 1, question: q.id || undefined, review_sha256: q.review_sha256 || undefined, data_sha256: q.data_sha256 || undefined };
      send({ type: 'propose', result: plain({ ...head, ...plain(result) }) });
    },
    markdown(text) {
      return new Promise((resolve) => {
        const id = ++mdSeq;
        pendingMd.set(id, resolve);
        send({ type: 'markdown', id, text: String(text ?? '').slice(0, 65536) });
        setTimeout(() => { if (pendingMd.has(id)) { pendingMd.delete(id); resolve(`<p>${esc(text)}</p>`); } }, 5000);
      });
    },
    open(target) {
      if (typeof target === 'string') return send({ type: 'open', href: target });
      if (target && typeof target.url === 'string') return send({ type: 'open', href: target.url });
      if (target && typeof target.path === 'string') return send({ type: 'open', path: target.path, ref: typeof target.ref === 'string' ? target.ref : undefined });
    },
    onTheme(fn) { themeFns.push(fn); },
  };

  // The frame has no navigation worth having: a link click goes to the dashboard, which opens it.
  document.addEventListener('click', (ev) => {
    const a = ev.target instanceof Element ? ev.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return;
    ev.preventDefault();
    if (a.dataset.path) devteam.open({ path: a.dataset.path, ref: a.dataset.ref });
    else devteam.open(href);
  });

  // The frame's height follows its content.
  let lastHeight = 0;
  const measure = () => {
    const h = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(h - lastHeight) > 2) { lastHeight = h; send({ type: 'resize', height: h }); }
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(document.documentElement);
  window.addEventListener('load', measure);

  // Ready once the page's own scripts have run, so every devteam.ready callback is registered.
  const hello = () => send({ type: 'ready' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello, { once: true });
  else setTimeout(hello, 0);

  // ---- components ----
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  const isEmpty = (x) => x === null || x === undefined || x === '' || (Array.isArray(x) ? !x.length : typeof x === 'object' && !Object.keys(x).length);
  // The same canonical form the owner's process compares with: sorted keys, no whitespace.
  const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
  const same = (a, b) => String(a) === String(b);

  // columns: [{ key, label, align: 'right', render(row) → Node|string }]
  function table({ columns, rows = [], empty = 'Nothing to show.', rowClass } = {}) {
    const tbody = h('tbody');
    const el = h('div', { class: 'dt-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.align === 'right' ? 'r' : null }, c.label ?? c.key)))), tbody));
    const cell = (c, r) => { const v = c.render ? c.render(r) : (r[c.key] ?? (r.cells || {})[c.key]); return v instanceof Node ? v : v === null || v === undefined ? '' : String(v); };
    function update(list) {
      tbody.replaceChildren(...(list.length
        ? list.map((r) => h('tr', { class: rowClass ? rowClass(r) : null }, columns.map((c) => h('td', { class: c.align === 'right' ? 'r' : null }, cell(c, r)))))
        : [h('tr', {}, h('td', { colspan: columns.length, class: 'dt-empty' }, empty))]));
    }
    update(rows);
    return { el, update };
  }

  // A searchable combobox with chips; any number of options. options: [{ id, label, detail, group }]
  function multiselect({ options = [], value = [], onChange, placeholder = 'Search to add…', hint, disabled = false, label: aria } = {}) {
    let sel = [...value];
    const byId = new Map(options.map((o) => [String(o.id), o]));
    const nameOf = (id) => (byId.get(String(id)) || {}).label ?? String(id);
    const chips = h('span', { class: 'ms-chips' });
    const input = h('input', { type: 'text', class: 'ms-input', placeholder, 'aria-label': aria || placeholder, role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', autocomplete: 'off' });
    const list = h('div', { class: 'ms-list', role: 'listbox', hidden: true });
    const el = h('div', { class: `ms${disabled ? ' disabled' : ''}` }, chips, input, list);
    let shown = [];
    let active = 0;
    const renderChips = () => chips.replaceChildren(...sel.map((id) => h('span', { class: 'chip', title: (byId.get(String(id)) || {}).detail || null }, nameOf(id), disabled ? null : h('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove ${nameOf(id)}`, onclick: () => remove(id) }, '×'))));
    function renderList() {
      const q = input.value.trim().toLowerCase();
      shown = options.filter((o) => !sel.some((s) => same(s, o.id)) && (!q || [o.label, o.id, o.detail, o.group].some((x) => x !== undefined && x !== null && String(x).toLowerCase().includes(q)))).slice(0, 60);
      active = Math.max(0, Math.min(active, shown.length - 1));
      list.replaceChildren(...(shown.length ? shown.map((o, i) => {
        const tip = hint ? hint(o.id) : '';
        return h('div', { class: `ms-opt${i === active ? ' on' : ''}`, role: 'option', 'aria-selected': String(i === active), onmousedown: (e) => { e.preventDefault(); add(o.id); } },
          h('span', {}, o.label ?? String(o.id)), o.group || o.detail ? h('span', { class: 'dim' }, [o.group, o.detail].filter(Boolean).join(' · ')) : null, tip ? h('span', { class: 'ms-hint' }, tip) : null);
      }) : [h('div', { class: 'ms-none dim' }, q ? 'No match' : 'Nothing left to add')]));
    }
    const open = (v) => { list.hidden = !v; input.setAttribute('aria-expanded', String(v)); if (v) renderList(); };
    const changed = () => { renderChips(); if (onChange) onChange([...sel]); };
    function add(id) { if (!sel.some((s) => same(s, id))) { sel.push(id); changed(); } input.value = ''; renderList(); }
    function remove(id) { sel = sel.filter((s) => !same(s, id)); changed(); if (!list.hidden) renderList(); }
    input.addEventListener('focus', () => open(true));
    input.addEventListener('blur', () => open(false));
    input.addEventListener('input', () => { active = 0; open(true); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); renderList(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderList(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (shown[active]) add(shown[active].id); e.preventDefault(); }
      else if (e.key === 'Backspace' && !input.value && sel.length) remove(sel[sel.length - 1]);
      else if (e.key === 'Escape') { input.value = ''; open(false); }
    });
    if (disabled) input.hidden = true;
    renderChips();
    return { el, value: () => [...sel], set(v) { sel = [...v]; renderChips(); } };
  }

  // options: [[value, label]] or [{ id, label }]
  const pairs = (options) => options.map((o) => (Array.isArray(o) ? o : [o.id, o.label ?? o.id]));
  function select({ options = [], value, onChange, disabled = false, label } = {}) {
    const el = h('select', { disabled, 'aria-label': label || null, onchange: () => onChange && onChange(el.value) }, pairs(options).map(([v, l]) => h('option', { value: v, selected: same(v, value) }, l)));
    return { el, value: () => el.value };
  }
  function radios({ options = [], value, onChange, disabled = false, name = `r${Math.random().toString(36).slice(2)}` } = {}) {
    const el = h('span', { class: 'radios' }, pairs(options).map(([v, l]) => h('label', {}, h('input', { type: 'radio', name, value: v, checked: same(v, value), disabled, onchange: () => onChange && onChange(v) }), l)));
    return { el, value: () => (el.querySelector('input:checked') || {}).value };
  }

  // tabs(bar, [[label, element], …], view): the chosen element is shown in view.
  function tabs(bar, items, view) {
    bar.classList.add('tabs');
    bar.setAttribute('role', 'tablist');
    const pick = (i) => {
      [...bar.children].forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
      view.replaceChildren(items[i][1]);
    };
    bar.replaceChildren(...items.map(([label], i) => h('button', { type: 'button', role: 'tab', onclick: () => pick(i) }, label)));
    if (items.length) pick(0);
    return { pick };
  }

  // filterBar({ search: 'placeholder', selects: [{ key, label, options: [[v, l]] }], onChange(state) })
  function filterBar({ search = 'Search', selects = [], onChange } = {}) {
    const state = { q: '' };
    const fire = () => onChange && onChange({ ...state });
    const kids = [];
    if (search) kids.push(h('input', { type: 'search', placeholder: search, 'aria-label': search, oninput: (e) => { state.q = e.target.value.trim().toLowerCase(); fire(); } }));
    for (const s of selects) {
      state[s.key] = s.value ?? pairs(s.options)[0]?.[0] ?? '';
      kids.push(h('label', {}, s.label, select({ options: s.options, value: state[s.key], label: s.label, onChange: (v) => { state[s.key] = v; fire(); } }).el));
    }
    return { el: h('div', { class: 'filters' }, kids), state: () => ({ ...state }) };
  }

  // tally([[label, n, class]]) → { el, update(items) }
  function tally(items = []) {
    const el = h('div', { class: 'tally', 'aria-live': 'polite' });
    const update = (list) => el.replaceChildren(...list.map(([label, n, cls]) => h('span', { class: cls || null }, h('b', {}, String(n)), ` ${label}`)));
    update(items);
    return { el, update };
  }

  // ---- ui.grid: a review of rows in the standard result shape ----
  // spec: { data, draft, result, readonly, fields: [{ key, label, type: 'multiselect'|'select'|'text', options: '<data.options key>', help }],
  //         columns: [{ key, label }] (from row.cells), order: 'confidence-low-first', unit: { one, many },
  //         bulk: [{ label, where: { confidence: ['high'] }, do: 'keep' }], extra(state) → object, mount (element, or false) }
  // A field keyed "note" is the row's note to the agent; every other field is one of the row's values.
  // A row is decided once the owner keeps it, edits it, or sets it to none.
  const CONF = { low: 0, medium: 1, high: 2 };
  function grid(spec) {
    const data = spec.data || {};
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const options = data.options || {};
    const fields = spec.fields || [];
    const valueFields = fields.filter((f) => f.key !== 'note');
    const noteField = fields.find((f) => f.key === 'note');
    const unit = spec.unit || { one: 'row', many: 'rows' };
    const readonly = !!spec.readonly;
    const proposalOf = (r) => (r.proposal && typeof r.proposal === 'object' && !Array.isArray(r.proposal) ? r.proposal : null);
    const blank = (f) => (f.type === 'multiselect' ? [] : '');
    const fresh = (r) => { const p = proposalOf(r) || {}; const v = {}; for (const f of valueFields) v[f.key] = plain(p[f.key] ?? blank(f)); return { decided: false, values: v, note: '' }; };
    const state = new Map(rows.map((r) => [r.id, fresh(r)]));
    const restore = (r, saved) => { if (!saved) return; const st = state.get(r.id); st.decided = !!saved.decided; st.values = { ...st.values, ...(saved.values || {}) }; st.note = typeof saved.note === 'string' ? saved.note : ''; };
    if (spec.result && Array.isArray(spec.result.rows)) { const by = new Map(spec.result.rows.map((x) => [x.id, x])); rows.forEach((r) => restore(r, by.get(r.id))); }
    else if (spec.draft && spec.draft.rows) rows.forEach((r) => restore(r, spec.draft.rows[r.id]));
    // what the owner's process compares with the proposal: the proposal's keys, plus any field set
    const valuesOut = (r) => {
      const st = state.get(r.id);
      const p = proposalOf(r) || {};
      const out = {};
      for (const f of valueFields) if (f.key in p || !isEmpty(st.values[f.key])) out[f.key] = st.values[f.key];
      for (const k of Object.keys(p)) if (!(k in out)) out[k] = p[k];
      return out;
    };
    const statusOf = (r) => {
      const st = state.get(r.id);
      if (!st.decided) return 'undecided';
      const vals = valuesOut(r);
      if (proposalOf(r) && canonical(vals) === canonical(proposalOf(r))) return 'kept';
      return Object.values(vals).every(isEmpty) ? 'none' : 'changed';
    };
    const labelOf = (key, id) => { const o = (options[key] || []).find((x) => same(x && typeof x === 'object' ? x.id : x, id)); return o && typeof o === 'object' ? (o.label ?? String(o.id)) : String(id); };
    const fmt = (key, v) => (Array.isArray(v) ? (v.length ? v.map((x) => labelOf(key, x)).join(', ') : 'none') : isEmpty(v) ? 'none' : String(v));
    const optionList = (f) => (options[f.options || f.key] || []).map((o) => (o && typeof o === 'object' ? o : { id: o, label: String(o) }));

    const el = h('div', { class: 'review-grid' });
    const counts = tally();
    const filterSelects = [{ key: 'status', label: 'Show', options: [['all', 'All'], ['undecided', 'Undecided'], ['changed', 'Changed'], ['none', 'Set to none'], ['kept', 'Kept']] }];
    if (rows.some((r) => r.confidence)) filterSelects.push({ key: 'confidence', label: 'Confidence', options: [['all', 'Any'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] });
    let filt = { q: '', status: 'all', confidence: 'all' };
    const bar = filterBar({ search: `Search ${unit.many}`, selects: filterSelects, onChange: (s) => { filt = { ...filt, ...s }; limit = PAGE; draw(); } });
    const bulkBar = h('div', { class: 'bulk' });
    const list = h('div', { class: 'grid-rows' });
    const moreBtn = h('button', { type: 'button', class: 'ghost more', onclick: () => { limit += PAGE; draw(); } });
    el.append(counts.el, bar.el, bulkBar, list, moreBtn);
    const PAGE = 100;
    let limit = PAGE;
    const ordered = [...rows];
    if (spec.order === 'confidence-low-first') ordered.sort((a, b) => (CONF[a.confidence] ?? 3) - (CONF[b.confidence] ?? 3));
    const matches = (r) => {
      if (filt.status !== 'all' && statusOf(r) !== filt.status) return false;
      if (filt.confidence && filt.confidence !== 'all' && r.confidence !== filt.confidence) return false;
      if (!filt.q) return true;
      const st = state.get(r.id);
      const hay = [r.id, r.title, r.reason, ...Object.values(r.cells || {}), ...valueFields.flatMap((f) => [].concat(st.values[f.key] ?? []).map((x) => labelOf(f.options || f.key, x)))];
      return hay.some((x) => x !== undefined && x !== null && String(x).toLowerCase().includes(filt.q));
    };
    // Many to many: an option may sit on any number of rows; the list says where else it is.
    const elsewhere = (f, optId, rowId) => {
      const on = rows.filter((r) => r.id !== rowId && [].concat(state.get(r.id).values[f.key] ?? []).some((x) => same(x, optId)));
      return on.length ? `also on ${on.slice(0, 2).map((r) => r.title || r.id).join(', ')}${on.length > 2 ? ` and ${on.length - 2} more` : ''}` : '';
    };

    function result() {
      const out = { rows: rows.map((r) => {
        const st = state.get(r.id);
        if (!st.decided) return { id: r.id, decided: false };
        return { id: r.id, decided: true, values: valuesOut(r), ...(st.note.trim() ? { note: st.note.trim() } : {}) };
      }) };
      if (spec.extra) out.extra = spec.extra(api);
      return out;
    }
    const listeners = [];
    // quiet: on open, nothing changed, so there is no draft to save
    function emit(quiet) {
      const all = rows.map(statusOf);
      const n = (s) => all.filter((x) => x === s).length;
      counts.update([['kept', n('kept'), 'kept'], ['changed', n('changed'), 'changed'], ['none', n('none'), 'none'], ['undecided', n('undecided'), 'undecided']]);
      if (readonly) return;
      devteam.progress(rows.length - n('undecided'), rows.length);
      if (!quiet) devteam.draft({ rows: Object.fromEntries([...state].map(([id, st]) => [id, st])) });
      devteam.propose(result());
      listeners.forEach((fn) => fn(api));
    }

    function rowEl(r) {
      const st = state.get(r.id);
      const p = proposalOf(r);
      // an edit inside the row keeps the row (and the focus in it); only its status and buttons change
      let node = null;
      const touch = () => { st.decided = true; paint(); emit(); };
      const paint = () => {
        const status = statusOf(r);
        node.className = `grow ${status}`;
        const lab = node.querySelector('.state');
        lab.className = `state ${status}`;
        lab.textContent = status;
        const acts = actionsEl(status);
        const old = node.querySelector('.grow-actions');
        if (old && acts) old.replaceWith(acts);
      };
      const cells = (spec.columns || []).map((c) => { const v = (r.cells || {})[c.key]; return v === undefined || v === null || v === '' ? null : `${c.label ?? c.key}: ${v}`; }).filter(Boolean);
      const fieldEls = valueFields.map((f) => {
        let input;
        if (f.type === 'multiselect') input = multiselect({ options: optionList(f), value: st.values[f.key] || [], disabled: readonly, label: f.label, hint: (id) => elsewhere(f, id, r.id), onChange: (v) => { st.values[f.key] = v; touch(); } }).el;
        else if (f.type === 'select') input = select({ options: [['', '—'], ...pairs(optionList(f))], value: st.values[f.key], disabled: readonly, label: f.label, onChange: (v) => { st.values[f.key] = v; touch(); } }).el;
        else input = h('input', { type: 'text', value: st.values[f.key] ?? '', disabled: readonly, 'aria-label': f.label, maxlength: f.max || null, onchange: (e) => { st.values[f.key] = e.target.value; touch(); } });
        return h('div', { class: 'grow-field' }, h('span', {}, f.label ?? f.key), input, f.help ? h('span', { class: 'help' }, f.help) : null);
      });
      const noteEl = noteField ? h('div', { class: 'grow-field' }, h('span', {}, noteField.label ?? 'Note'), h('input', { type: 'text', value: st.note, disabled: readonly, maxlength: noteField.max || 2000, 'aria-label': noteField.label ?? 'Note', placeholder: noteField.placeholder || 'Optional', onchange: (e) => { st.note = e.target.value; if (st.decided) emit(); else touch(); } })) : null;
      // Keep (or Decided, with no proposal) decides the row as it stands; None empties it; Undo goes
      // back to the proposal, undecided. Both rebuild the row, since its fields change.
      const actionsEl = (status) => (readonly ? null : h('div', { class: 'grow-actions' },
        status === 'undecided' ? h('button', { type: 'button', class: 'small', onclick: touch }, p ? 'Keep' : 'Decided') : null,
        h('button', { type: 'button', class: 'ghost small', onclick: () => { for (const f of valueFields) st.values[f.key] = blank(f); st.decided = true; refresh(r); emit(); } }, 'None'),
        status !== 'undecided' ? h('button', { type: 'button', class: 'ghost small', onclick: () => { st.decided = false; st.values = fresh(r).values; refresh(r); emit(); } }, 'Undo') : null));
      const status = statusOf(r);
      const actions = actionsEl(status);
      node = h('div', { class: `grow ${status}`, 'data-row': r.id },
        h('div', { class: 'grow-head' }, h('b', {}, r.title ?? r.id), h('span', { class: `state ${status}` }, status), r.confidence ? h('span', { class: `badge ${{ low: 'high', medium: 'medium', high: 'good' }[r.confidence] || ''}` }, `${r.confidence} confidence`) : null, cells.length ? h('span', { class: 'grow-cells' }, cells.join(' · ')) : null,
          // a row's links ({ title, url } or { title, path, ref }) open through the dashboard
          (Array.isArray(r.links) ? r.links : []).filter((l) => l && (l.url || l.path)).map((l) => h('a', { class: 'small', href: l.url || l.path, 'data-path': l.url ? null : l.path, 'data-ref': l.url ? null : l.ref || null }, l.title || l.url || l.path))),
        r.reason ? h('div', { class: 'grow-reason' }, r.reason) : null,
        fieldEls, noteEl,
        p ? h('div', { class: 'grow-proposal' }, `Proposed: ${Object.entries(p).map(([k, v]) => `${(fields.find((f) => f.key === k) || {}).label ?? k}: ${fmt((fields.find((f) => f.key === k) || {}).options || k, v)}`).join('; ')}`) : h('div', { class: 'grow-proposal' }, 'No proposal'),
        actions);
      return node;
    }
    function refresh(r) { const old = list.querySelector(`[data-row="${CSS.escape(String(r.id))}"]`); if (old) old.replaceWith(rowEl(r)); }
    function draw() {
      const shown = ordered.filter(matches);
      list.replaceChildren(...(shown.length ? shown.slice(0, limit).map(rowEl) : [h('p', { class: 'empty' }, `No ${unit.many} match.`)]));
      moreBtn.hidden = shown.length <= limit;
      moreBtn.textContent = `Show ${Math.min(PAGE, shown.length - limit)} more of ${shown.length - limit}`;
    }
    // bulk: two clicks, the first says how many rows it would decide (the frame has no dialogs)
    for (const b of readonly ? [] : spec.bulk || []) {
      const targets = () => rows.filter((r) => state.get(r.id).decided === false && proposalOf(r) && Object.entries(b.where || {}).every(([k, vs]) => [].concat(vs).some((v) => same(v, r[k] ?? (r.cells || {})[k]))));
      let armed = false;
      const btn = h('button', { type: 'button', class: 'ghost small', onclick: () => {
        const t = targets();
        if (!t.length) { btn.textContent = `${b.label} (none left)`; return; }
        if (!armed) { armed = true; btn.classList.add('armed'); btn.textContent = `${b.label}: decide ${t.length} ${t.length === 1 ? unit.one : unit.many}? Click again`; return; }
        armed = false; btn.classList.remove('armed'); btn.textContent = b.label;
        for (const r of t) { const st = state.get(r.id); st.decided = true; if (b.do === 'none') for (const f of valueFields) st.values[f.key] = blank(f); else st.values = fresh(r).values; }
        draw(); emit();
      } }, b.label);
      btn.addEventListener('blur', () => { if (armed) { armed = false; btn.classList.remove('armed'); btn.textContent = b.label; } });
      bulkBar.append(btn);
    }
    if (!bulkBar.children.length) bulkBar.hidden = true;
    const api = { el, result, state: () => new Map([...state].map(([k, v]) => [k, plain(v)])), statusOf: (id) => statusOf(rows.find((r) => r.id === id)), valuesOf: (id) => valuesOut(rows.find((r) => r.id === id)), onChange(fn) { listeners.push(fn); }, rows, redraw: draw };
    draw();
    emit(true);
    const mount = spec.mount === false ? null : spec.mount || document.getElementById('view') || document.body;
    if (mount) mount.append(el);
    return api;
  }

  window.devteam = devteam;
  window.ui = { h, table, multiselect, select, radios, tabs, filterBar, tally, grid, canonical };
})();
