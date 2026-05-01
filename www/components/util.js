// XSS-safe DOM construction. Use this everywhere instead of string-interpolated HTML.
//
// el('div', { class: 'foo' }, [el('span', {}, ['hello'])])
// el('button', { onclick: fn }, ['Click me'])
// el('input', { type: 'text', placeholder: 'name' })

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') {
      node.className = v;
    } else if (k === 'style') {
      node.style.cssText = v;
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      node.appendChild(document.createTextNode(String(c)));
    } else if (c instanceof Node) {
      node.appendChild(c);
    } else {
      node.appendChild(document.createTextNode(String(c)));
    }
  }
  return node;
}

let toastTimer = null;
export function showToast(text, ms = 3000) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export function replaceContent(node, newChildren) {
  while (node.firstChild) node.removeChild(node.firstChild);
  const list = Array.isArray(newChildren) ? newChildren : [newChildren];
  for (const c of list) {
    if (c == null) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
