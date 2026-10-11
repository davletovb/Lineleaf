// A menu button for the card and the panel: a trigger, and a short list of choices that opens beside it. The list is drawn in `layer`
// (outside the card or panel, which scroll and would clip it) and placed from the trigger's rectangle. It follows the menu-button pattern:
// Enter, Space or the arrow keys open it and move into it, the arrows, Home and End move between choices, Escape closes it and returns to the
// trigger (and goes no further, so it does not also close the card), and leaving it with Tab or a click elsewhere closes it.
// Only real user input counts: a page script cannot open it or pick from it.
import {iconLabel} from './icons.mjs';
let current = null; // one menu at a time
const make = (tag, attrs = {}, text = '') => { const element = document.createElement(tag); element.textContent = text; for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); return element; };

// items: {id, label, glyph?} for a choice, {group: 'Tone'} to start a labelled group of the choices after it.
export function menuButton({layer, trigger, items, label, onPick}) {
  const menu = make('div', {class: 'menu', role: 'menu', 'aria-label': label}), choices = []; menu.hidden = true;
  let parent = menu;
  for (const entry of items) {
    if (entry.group) {
      parent = make('div', {class: 'group', role: 'group', 'aria-label': entry.group}); parent.append(make('p', {'aria-hidden': 'true'}, entry.group)); menu.append(parent); continue;
    }
    const choice = make('button', {type: 'button', role: 'menuitem', tabindex: '-1', 'data-item': entry.id});
    choice.append(...(entry.glyph ? iconLabel(entry.glyph, entry.label) : [document.createTextNode(entry.label)]));
    choice.addEventListener('click', event => { if (!event.isTrusted) return; close(); onPick(entry.id); });
    choices.push(choice); parent.append(choice);
  }
  layer.append(menu); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  function place() {
    if (menu.hidden) return;
    const t = trigger.getBoundingClientRect(), origin = layer.getBoundingClientRect(), width = menu.offsetWidth, height = menu.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - width - 8, t.left)), below = t.bottom + 6 + height <= innerHeight - 8;
    menu.style.left = `${left - origin.left}px`; menu.style.top = `${(below ? t.bottom + 6 : Math.max(8, t.top - 6 - height)) - origin.top}px`;
  }
  function open(first = 0) {
    if (trigger.disabled) return;
    current?.close(); current = api; menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); place();
    choices.at(first)?.focus({preventScroll: true});
  }
  function close(refocus = false) {
    if (menu.hidden) return;
    menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (current === api) current = null; if (refocus) trigger.focus({preventScroll: true});
  }
  const move = step => { const at = choices.indexOf(menu.getRootNode().activeElement); choices.at((at + step + choices.length) % choices.length)?.focus({preventScroll: true}); };
  trigger.addEventListener('click', event => { if (!event.isTrusted) return; if (menu.hidden) open(); else close(); });
  trigger.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); open(0); } else if (event.key === 'ArrowUp') { event.preventDefault(); open(-1); }
  });
  menu.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); } else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Home') { event.preventDefault(); choices.at(0)?.focus({preventScroll: true}); } else if (event.key === 'End') { event.preventDefault(); choices.at(-1)?.focus({preventScroll: true}); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close();
  });
  menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget) && event.relatedTarget !== trigger) close(); });
  const api = {open, close, place, dispose() { close(); menu.remove(); }, get isOpen() { return !menu.hidden; }};
  return api;
}

// The rewrite choices shared by the card, the word popover and the writing panel. `lead` adds the main one when it has no button of its own.
export function rewriteItems(labels, {lead = false} = {}) {
  const item = id => ({id, label: labels[id]});
  return [...(lead ? [item('improve')] : []), item('paraphrase'), item('clearer'), item('shorter'), {group: 'Tone'}, item('formal'), item('friendly')];
}
