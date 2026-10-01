// Test-only debugger access to the production closed shadow root. No page or extension hook.
const sessions = new WeakMap();
async function session(page) {
  if (!sessions.has(page)) sessions.set(page, await page.context().newCDPSession(page));
  return sessions.get(page);
}
function findPanel(node, attribute) {
  if (node.attributes?.includes(attribute)) return node.shadowRoots?.find(x => x.shadowRootType === 'closed');
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const root = findPanel(child, attribute); if (root) return root;
  }
  return null;
}
export function panelFor(page, {attribute = 'data-lineleaf-root'} = {}) {
  function locator(selector, name = null) {
    async function evaluate(fn, arg) {
      const cdp = await session(page), {root: document} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
      const root = findPanel(document, attribute); if (!root) throw new Error('Panel is unavailable');
      const {object} = await cdp.send('DOM.resolveNode', {nodeId: root.nodeId});
      try {
        const result = await cdp.send('Runtime.callFunctionOn', {objectId: object.objectId,
          functionDeclaration: `function(selector, name, arg) {
            const elements = [...this.querySelectorAll(selector)].filter(e => name === null || e.textContent === name);
            return (${fn.toString()})(elements[0], arg, elements);
          }`, arguments: [{value: selector}, {value: name}, {value: arg}], returnByValue: true});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
      } finally { await cdp.send('Runtime.releaseObject', {objectId: object.objectId}); }
    }
    async function waitFor(predicate = element => element && !element.hidden, arg) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { if (await evaluate(predicate, arg)) return; } catch { /* document/panel may not exist yet */ }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Panel control did not become ready: ${selector} ${name ?? ''}`);
    }
    return {evaluate, waitFor,
      async click() {
        await waitFor();
        const box = await evaluate(el => { const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; });
        await page.mouse.click(box.x, box.y);
      },
      textContent: () => evaluate(el => el.textContent),
      count: () => evaluate((_, __, elements) => elements.length),
      isDisabled: () => evaluate(el => el.disabled),
      selectOption: value => evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }, value)
    };
  }
  return {locator, button: name => locator('button', name)};
}
