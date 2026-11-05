// Tiny HTML tree builder for well-formed MediaWiki parser output (no dependencies).
// Supports: elements with attributes, text, void elements, comments; queries by tag/class/attribute.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', middot: '·', times: '×' };

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

class Node {
  constructor(tag, attrs, parent) {
    this.tag = tag;
    this.attrs = attrs;
    this.parent = parent;
    this.children = [];
  }
  get classList() {
    return (this.attrs.class || '').split(/\s+/).filter(Boolean);
  }
  hasClass(c) {
    return this.classList.includes(c);
  }
  attr(n) {
    return this.attrs[n];
  }
  get text() {
    let s = '';
    for (const c of this.children) s += typeof c === 'string' ? c : c.text;
    return s;
  }
  /** normalised visible text */
  get clean() {
    return this.text.replace(/\s+/g, ' ').trim();
  }
  *walk() {
    for (const c of this.children) {
      if (typeof c === 'string') continue;
      yield c;
      yield* c.walk();
    }
  }
  /** selector: "tag", ".class", "tag.class.class2", "[attr]", ".a[attr=v]" — single compound only */
  findAll(sel) {
    const m = compile(sel);
    const out = [];
    for (const n of this.walk()) if (m(n)) out.push(n);
    return out;
  }
  find(sel) {
    const m = compile(sel);
    for (const n of this.walk()) if (m(n)) return n;
    return null;
  }
  closest(sel) {
    const m = compile(sel);
    for (let n = this.parent; n; n = n.parent) if (m(n)) return n;
    return null;
  }
}

const cache = new Map();
function compile(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const tag = (sel.match(/^[a-z0-9]+/i) || [''])[0].toLowerCase();
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
  const attrs = [...sel.matchAll(/\[([\w-]+)(?:([*^$]?=)"?([^"\]]*)"?)?\]/g)].map((x) => [x[1], x[2], x[3]]);
  const f = (n) => {
    if (tag && n.tag !== tag) return false;
    if (classes.length) {
      const cl = n.classList;
      for (const c of classes) if (!cl.includes(c)) return false;
    }
    for (const [a, op, v] of attrs) {
      const val = n.attrs[a];
      if (val == null) return false;
      if (op === '=' && val !== v) return false;
      if (op === '*=' && !val.includes(v)) return false;
      if (op === '^=' && !val.startsWith(v)) return false;
      if (op === '$=' && !val.endsWith(v)) return false;
    }
    return true;
  };
  cache.set(sel, f);
  return f;
}

export function parseHTML(html) {
  const root = new Node('#root', {}, null);
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const s = m[0];
    if (s.startsWith('<!--')) continue;
    if (m[1]) {
      const t = m[1].toLowerCase();
      // close up to the matching open tag, if present
      let n = cur;
      while (n !== root && n.tag !== t) n = n.parent;
      if (n !== root) cur = n.parent;
      continue;
    }
    if (m[2]) {
      const t = m[2].toLowerCase();
      const attrs = {};
      for (const a of (m[3] || '').matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      }
      const node = new Node(t, attrs, cur);
      cur.children.push(node);
      if (!VOID.has(t) && !m[4]) {
        if (t === 'script' || t === 'style') {
          const end = html.indexOf(`</${t}`, re.lastIndex);
          re.lastIndex = end < 0 ? html.length : end;
        }
        cur = node;
      }
      continue;
    }
    cur.children.push(decode(s));
  }
  return root;
}
