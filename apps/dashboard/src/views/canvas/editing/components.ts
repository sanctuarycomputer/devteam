// Components, variants and instances (canvas.html 2630-2797, kit-1016): Make component, a component's
// variants, Change in, Place instance, and the Properties panel's editable fields with Delete layer.
// Each declaration is the page's own, with types added; the page's load-time statement runs from
// initComponents(). No DOM at import.
import { own, state, type Json } from '../core/page';
import { VARIANT_RE } from '../core/checkers';
import { MAX_ELEMENTS, kidsOf, nodeOf } from '../core/nodes';
import { buildProps, fieldNote, fieldRow, fieldsFor, ready, select, selectOf, textInput, typing } from '../panels';
import { componentOf, deleteSelection, edit, editable, freeText, narrow, newId, say, setProp, setRaw, variantFor, variantNames } from '../sync';
import { addNode, setTool } from './tools';
import { componentsAbove, subtreeOf } from './move';

export const MAX_VARIANTS = 32; // canvas@1 §7 variants
export const SAY3 = {
  variantName: "A variant's name is a letter, then letters, digits or _.",
  variantExists: 'This component already has that variant.',
  variantsFull: 'A component has at most 32 variants.',
  ownComponent: "An instance can't go inside its own component.",
};
export function actionButton(action: string, label: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.action = action;
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
}
// Make component is offered on a frame where a component may be: not inside a component, and not
// holding one (a component never sits inside another, at any depth).
export const mayMakeComponent = (id: Json, n: Json): boolean => n.type === 'frame' && componentOf(id) === null && !subtreeOf(id).some((x) => x.type === 'component');
// Make component: one edit that adds a component with the frame's properties after the frame under
// its parent, moves the frame's children into it in order, and deletes the frame; then selected.
export const COMPONENT_PROPS = ['name', 'visible', 'opacity', 'x', 'y', 'size', 'fill', 'stroke', 'strokeWidth', 'radius', 'clip', 'layout'];
export function makeComponent(frameId: Json): void {
  const f = nodeOf(frameId);
  if (!editable() || !f || !mayMakeComponent(frameId, f)) return;
  const cid = newId();
  const node: Json = { id: cid, type: 'component', parent: f.parent };
  for (const k of COMPONENT_PROPS) if (own(f, k)) node[k] = structuredClone(f[k]);
  const ops: Json[] = [{ op: 'add', node, after: frameId }];
  let after: Json = null;
  for (const c of kidsOf(f)) {
    ops.push({ op: 'move', id: c, parent: cid, after });
    after = c;
  }
  ops.push({ op: 'del', id: frameId });
  if (edit(ops)) select(cid);
}
// The variants of a selected component: each listed with Remove (a set of null), then a name field
// and Add variant (a set of {}), Enter in the name field adding it too.
export function variantsBlock(id: Json, n: Json): HTMLDivElement[] {
  const out: HTMLDivElement[] = [];
  for (const name of variantNames(n) as string[]) {
    const nm = document.createElement('span');
    nm.className = 'vname';
    nm.textContent = name;
    const rm = actionButton('remove-variant', 'Remove', () => {
      // @ts-ignore -- doctrine-exception(tsc-strict): variantNames is canvas-sync's stub (typed never) until kit-1015 ports it; the line is the page's
      if (variantNames(nodeOf(id)).includes(name)) setRaw(id, `variants.${name}`, null);
    });
    rm.dataset.variant = name;
    rm.setAttribute('aria-label', `Remove variant ${name}`);
    out.push(fieldRow('Variant', nm, rm));
  }
  const field = textInput('@new-variant', 'New variant name', '');
  field.maxLength = 40;
  field.placeholder = 'name';
  let row: Json = null;
  const add = () => {
    const name = field.value.trim();
    const names: Json = variantNames(nodeOf(id));
    const why = !VARIANT_RE.test(name) ? SAY3.variantName : names.includes(name) ? SAY3.variantExists : names.length >= MAX_VARIANTS ? SAY3.variantsFull : null;
    fieldNote(row, why);
    if (why !== null) return;
    if (setRaw(id, `variants.${name}`, {})) field.value = '';
  };
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  row = fieldRow('New variant', field, actionButton('add-variant', 'Add variant', add));
  out.push(row);
  return out;
}
// Change in, on a node inside a component that has variants: Base or one of its variants.
export function changeInRow(id: Json): HTMLDivElement | null {
  const comp = componentOf(id);
  const names: Json = variantNames(nodeOf(comp));
  if (comp === null || names.length === 0) return null;
  const vm: Json = variantFor(id);
  const s = selectOf('@variant', 'Change in', [['@base', 'Base'], ...names.map((x: Json) => [x, x])], vm === null ? '@base' : vm.name);
  s.addEventListener('change', () => {
    state.variantMode = s.value === '@base' ? null : { comp, name: s.value };
    buildProps();
  });
  return fieldRow('Change in', s);
}
// Place instance: the next click on the stage adds an instance of the component (setTool('instance')).
export function startPlacing(compId: Json): void {
  const c = nodeOf(compId);
  if (!editable() || narrow() || !c || c.type !== 'component') return;
  setTool('instance');
  state.placing = compId;
}
// Does component `a` use component `b`: is it `b`, or does it hold an instance of `b` or of a component
// that uses `b` (walked, bounded)? An instance of `a` never goes inside `b` then (contract §2).
export function usesComponent(a: Json, b: Json): boolean {
  const seen = new Set<Json>();
  const stack = [a];
  while (stack.length && seen.size <= MAX_ELEMENTS) {
    const c = stack.pop();
    if (c === b) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const x of subtreeOf(c)) if (x.type === 'instance' && typeof x.component === 'string' && !seen.has(x.component)) stack.push(x.component);
  }
  return false;
}
// Would an instance of component `compId` placed under `pid` be inside its own component?
export const ownComponentAbove = (compId: Json, pid: Json): boolean => [...componentsAbove(pid)].some((c) => usesComponent(compId, c));
// The instance placed at a click: by the placing rule (§2), never inside its own component.
export function placeInstance(compId: Json, at: Json): void {
  const c = nodeOf(compId);
  if (!c || c.type !== 'component') return;
  if (ownComponentAbove(compId, at.parent)) { say(SAY3.ownComponent); return; }
  addNode('instance', at, { name: typeof c.name === 'string' ? c.name : 'Instance', component: compId, size: { w: 'hug', h: 'hug' } });
}

// The fields under the read-only rows, for the selected node: Change in (a node inside a component
// with variants), Name (hidden in Change in: names aren't overridden), its type's fields, a
// component's variants and Place instance, a frame's Make component, then Delete layer at the foot.
// Disabled once editing has stopped.
export function editFields(id: Json, n: Json): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'fields';
  const change = changeInRow(id);
  if (change !== null) box.append(change);
  if (variantFor(id) === null) {
    const name = textInput('name', 'Name', typeof n.name === 'string' ? n.name : '');
    name.maxLength = 200;
    name.addEventListener('change', () => {
      const v = name.value;
      if (v.length <= 200 && freeText(v)) setProp(id, 'name', v);
    });
    box.append(fieldRow('Name', name));
  }
  box.append(...fieldsFor(id, n));
  if (n.type === 'component') {
    box.append(...variantsBlock(id, n));
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.append(actionButton('place-instance', 'Place instance', () => startPlacing(id)));
    box.append(acts);
  }
  if (mayMakeComponent(id, n)) {
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.append(actionButton('make-component', 'Make component', () => makeComponent(id)));
    box.append(acts);
  }
  const foot = document.createElement('div');
  foot.className = 'foot';
  const del = document.createElement('button');
  del.type = 'button';
  del.dataset.action = 'delete';
  del.textContent = 'Delete layer';
  del.addEventListener('click', () => deleteSelection());
  foot.append(del);
  box.append(foot);
  if (!editable()) for (const c of box.querySelectorAll<HTMLInputElement>('input, select, textarea, button')) c.disabled = true;
  return box;
}

// The page's load-time statement of these lines.
export function initComponents(): void {
  // Delete or Backspace deletes the selected node, while no field has focus, at 760 px and over.
  document.addEventListener('keydown', (e) => {
    if (!ready() || !editable() || narrow() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sels.length) {
      e.preventDefault();
      deleteSelection();
    }
  });
}
