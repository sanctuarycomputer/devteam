// Layers, selection and the Properties panel (canvas.html 1059-1304, kit-1014). Each declaration is the
// page's own, with types added; the page's load-time statements run, in its order, from initLayers().
// No DOM at import.
import { $, TEXT, live, own, pageById, pages, state, type Json } from '../core/page';
import { MODE, pick } from '../core/checkers';
import { CONTAINERS, MAX_ELEMENTS, getPath, kidsOf, nodeOf } from '../core/nodes';
import { deleteNode, deleteSelection, editable, queueSelect } from '../sync';
import { drawHandles, editFields, setTool } from '../editing';
import * as editing from '../editing';
import { held } from './held';
import { ready } from './zoom';

// A row's type mark: the page's own table (a frame's by its layout mode).
export const MARK: Record<string, string> = { component: '◆', instance: '◇', text: 'T', rect: '▭', ellipse: '○', vector: '✎', image: '▣' };
export const FRAME_MARK: Record<string, string> = { row: '→', column: '↓', grid: '▦', none: '#' };
export const typeOf = (n: Json): string => (typeof n.type === 'string' ? n.type : '');
export function markOf(n: Json): string {
  if (n.type === 'frame') return FRAME_MARK[pick(MODE, getPath(n, 'layout.mode'), 'none')];
  return own(MARK, typeOf(n)) ? MARK[n.type] : '?';
}
// A node's name, or its type when the name is empty.
export const labelOf = (n: Json): string => (typeof n.name === 'string' && n.name ? n.name : typeOf(n) || 'node');

// The Layers tree: the shown page's nodes nested by children order, each listed once; an instance's
// inner nodes are the component's and aren't listed. Indent by depth, a number the page works out.
export function renderLayers(pageId: Json): void {
  const pg = pageById(pageId) || pages()[0];
  const seen = new Set<string>();
  const out: HTMLElement[] = [];
  live.layerRows = new Map();
  const stack: [string, number][] = kidsOf(pg).reverse().map((id): [string, number] => [id, 0]);
  while (stack.length) {
    const [id, depth] = stack.pop()!;
    const n = nodeOf(id);
    if (!n || seen.has(id)) continue;
    seen.add(id);
    const row = document.createElement('div');
    row.className = 'layer';
    row.dataset.node = id;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-selected', 'false');
    row.tabIndex = -1;
    row.style.paddingLeft = `${12 + Math.min(depth, 40) * 14}px`;
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = markOf(n);
    ic.title = typeOf(n);
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = labelOf(n);
    row.append(ic, nm);
    out.push(row);
    live.layerRows.set(id, row);
    if (CONTAINERS.has(n.type)) stack.push(...kidsOf(n).reverse().map((c): [string, number] => [c, depth + 1]));
  }
  $('layers').replaceChildren(...out);
}

// One label and value row of the Properties panel; the value is text.
export function propRow(label: string, field: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'v';
  v.dataset.field = field;
  v.textContent = value;
  row.append(k, v);
  return row;
}

// The Properties panel: kit-661's read-only rows (the selected node's name and type, and for an
// instance its component's name and variant), then, on a canvas open for editing, the fields that
// change it (kit-662); with nothing selected, a note. The panel isn't rebuilt while a field in it has
// focus or a press that started in it is under way: someone else's edit never takes a field from under
// a person typing, and a click that follows a field's edit (whose change fires on that very press)
// lands on the button it was aimed at. It is rebuilt once focus leaves the field, and after a press or
// a click in it ends with no field focused; a button that merely has focus holds nothing, and the
// focused control, when the new panel has it again, keeps focus.
export let propsStale = false;
export let pressing = false;
// The colour fields set to Hex while their value isn't one (`<id> <path>`): kept until a hex is sent
// or the selection changes, so the panel rebuilt meanwhile still shows the hex input.
export const hexChosen = new Set<string>();
export const inProps = (x: unknown): boolean => x instanceof Node && $('props').contains(x);
// A field a person types or chooses in (a checkbox, like a button, holds nothing).
export const fieldFocused = (): boolean => {
  const a = document.activeElement;
  return inProps(a) && a!.matches('input:not([type="checkbox"]), select, textarea');
};
export const holdProps = (): boolean => pressing || fieldFocused();
export function renderProps(): void {
  if (holdProps()) { propsStale = true; return; }
  buildProps();
}
// The same control in a rebuilt panel: by its data-prop or data-action, and its data-value or data-variant.
export const controlKey = (e: unknown): string | null => (e instanceof HTMLElement ? ['prop', 'action', 'value', 'variant'].map((k) => e.dataset[k] ?? '').join('\u0000') : null);
export function buildProps(): void {
  propsStale = false;
  const was = inProps(document.activeElement) ? controlKey(document.activeElement) : null;
  const box = $('props');
  if (state.sels.length > 1) {
    // several (kit-669 §2): how many, and Delete layers
    const p = document.createElement('p');
    p.className = 'note';
    p.dataset.field = 'count';
    p.textContent = `${state.sels.length} layers selected.`;
    const out: HTMLElement[] = [p];
    if (state.session !== null) {
      const foot = document.createElement('div');
      foot.className = 'foot';
      const del = document.createElement('button');
      del.type = 'button';
      del.dataset.action = 'delete';
      del.textContent = 'Delete layers';
      del.disabled = !editable();
      del.addEventListener('click', () => deleteSelection());
      foot.append(del);
      out.push(foot);
    }
    box.replaceChildren(...out);
    if (was !== null && was !== '\u0000\u0000\u0000') {
      const again = [...box.querySelectorAll('button')].find((e) => controlKey(e) === was);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
    return;
  }
  const n = state.sel === null ? null : nodeOf(state.sel);
  if (!n) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = TEXT.noSelection;
    box.replaceChildren(p);
    return;
  }
  const out: HTMLElement[] = [propRow('Name', 'name', typeof n.name === 'string' ? n.name : ''), propRow('Type', 'type', typeOf(n))];
  if (n.type === 'instance') {
    const comp = nodeOf(n.component);
    const compName = comp && comp.type === 'component' ? (typeof comp.name === 'string' ? comp.name : '') : 'none';
    out.push(propRow('Component', 'component', compName));
    out.push(propRow('Variant', 'variant', typeof n.variant === 'string' && n.variant ? n.variant : 'none'));
  }
  if (state.session !== null) out.push(editFields(state.sel, n));
  box.replaceChildren(...out);
  if (was !== null && was !== '\u0000\u0000\u0000') {
    const again = [...box.querySelectorAll<HTMLButtonElement>('input, select, textarea, button')].find((e) => controlKey(e) === was);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }
}
// After a press or a click in the panel ends: rebuilt when due, unless a field has focus.
export const settleProps = (): void => { if (propsStale && !pressing && !fieldFocused()) buildProps(); };
export const pressEnd = (): void => {
  if (!pressing) return;
  // the click this press makes comes before this timer, so it reaches the control pressed
  setTimeout(() => { pressing = false; settleProps(); }, 0);
};

// The shown page's ids in the Layers tree's order (its tree in pre-order, as renderLayers lists it).
export const layerOrder = (): string[] => [...live.layerRows.keys()];
// Select nodes of the shown page (kit-669 §2): the ids listed in Layers kept, in layer order, each one's
// row and drawn node marked; [] selects nothing. state.sel is the one id when exactly one is selected.
// The tree keeps one row in the tab order (the ARIA tree pattern): the first selected row, else the
// first. The server is told (queueSelect).
export function selectIds(ids: Json): void {
  const want = new Set(Array.isArray(ids) ? ids.filter((id) => live.layerRows.has(id)) : []);
  const next = layerOrder().filter((id) => want.has(id));
  const stop = next.length ? next[0] : (live.layerRows.keys().next().value ?? null);
  for (const [rid, row] of live.layerRows) {
    row.setAttribute('aria-selected', want.has(rid) ? 'true' : 'false');
    row.tabIndex = rid === stop ? 0 : -1;
  }
  for (const el of $('surface').querySelectorAll('.sel')) el.classList.remove('sel');
  for (const id of next) if (live.drawn.has(id)) live.drawn.get(id)!.classList.add('sel');
  if (next.length !== state.sels.length || next.some((id, i) => id !== state.sels[i])) hexChosen.clear();
  state.sels = next;
  state.sel = next.length === 1 ? next[0] : null;
  renderProps();
  queueSelect();
  drawHandles();
}
// One node selected alone, or nothing (null).
export const select = (id: Json): void => selectIds(id === null ? [] : [id]);
// Shift+click: a node added to the selection, or taken out of it when it is in it.
export const toggleSel = (id: Json): void => selectIds(state.sels.includes(id) ? state.sels.filter((x) => x !== id) : [...state.sels, id]);
// The selection's roots: the selected ids not inside another selected one, in layer order.
export function selRoots(): Json[] {
  const sel = new Set(state.sels);
  return state.sels.filter((id) => {
    let cur = nodeOf(id)?.parent;
    for (let steps = 0; steps <= MAX_ELEMENTS && nodeOf(cur); steps++) {
      if (sel.has(cur)) return false;
      cur = nodeOf(cur).parent;
    }
    return true;
  });
}

// The page's load-time statements of these lines (1203, 1209-1215, 1219, 1258-1303), in its order: run once
// by the section's init(), from mount().
export function initLayers(): void {
  $('props').addEventListener('pointerdown', () => { pressing = true; }, true);
  window.addEventListener('pointerup', pressEnd, true);
  window.addEventListener('pointercancel', pressEnd, true);
  $('props').addEventListener('click', () => { setTimeout(settleProps, 0); });
  $('props').addEventListener('focusout', () => {
    // after focus has landed: a move to another field of the panel keeps it as it is
    setTimeout(() => { if (propsStale && !holdProps()) buildProps(); }, 0);
  });
  $('layers').setAttribute('aria-multiselectable', 'true');
  $('layers').addEventListener('click', (e) => {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.layer[data-node]') : null;
    if (!row) return;
    if (e.shiftKey) toggleSel(row.dataset.node); else select(row.dataset.node);
  });
  // The tree by keyboard: ArrowDown and ArrowUp select the next and previous row, Home and End the first
  // and last, focus following (they are the tree's: they never nudge); Delete or Backspace deletes the
  // focused row's node as the Delete key does elsewhere (same guard, same words), at 760 px and over:
  // the whole selection when that row is selected, else that row's node alone.
  $('layers').addEventListener('keydown', (e) => {
    if (!ready() || e.ctrlKey || e.metaKey || e.altKey) return;
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.layer[data-node]') : null;
    if (!row || !live.layerRows.has(row.dataset.node!)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation(); // the page's own Delete would delete the selection, which may be another row
      if (editable()) { if (state.sels.includes(row.dataset.node)) deleteSelection(); else deleteNode(row.dataset.node); }
      return;
    }
    const ids = [...live.layerRows.keys()];
    const i = ids.indexOf(row.dataset.node!);
    // (typed by one key: the table is indexed by the key pressed, undefined for any other)
    const to = { ArrowDown: ids[Math.min(i + 1, ids.length - 1)], ArrowUp: ids[Math.max(i - 1, 0)], Home: ids[0], End: ids[ids.length - 1] }[e.key as 'Home'];
    if (to === undefined) return;
    e.preventDefault();
    select(to);
    live.layerRows.get(to)!.focus();
  });
  // A click on the stage: the nearest drawn node with a data-id (inside an instance, the instance), or
  // on empty stage nothing. The stage's own controls are not the stage.
  $('stage').addEventListener('click', (e) => {
    if (held.panned) { held.panned = false; return; } // the click that ends a Space drag is a pan, not a click
    if (editing.shared.toolPress) { editing.shared.toolPress = false; return; } // the click that ends a tool's press made something
    if (!state.doc || e.button !== 0 || !(e.target instanceof Element)) return;
    if (e.target.closest('.zoom, .stage-top, #tools')) return;
    const hit = e.target.closest<HTMLElement>('#surface [data-id]');
    // Shift+click on a node adds it or takes it out (kit-669 §2); on empty stage it changes nothing
    if (e.shiftKey) { if (hit) toggleSel(hit.dataset.id); return; }
    select(hit ? hit.dataset.id : null);
  });
  // Escape ends a tool (a drag, a path, the drag rectangle) and returns to Move; with Move on, it clears
  // the selection.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (editing.shared.tool !== 'move' || editing.shared.gesture !== null || editing.shared.pen !== null) { setTool('move'); return; }
    if (state.sels.length) select(null);
  });
}
