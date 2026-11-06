// Small helpers for Liquipedia wikitext: balanced templates, team squads.

/** split a template body into its top-level «|»-separated parts (nested {{…}} and [[…]] kept whole) */
export function tplParts(body) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  out.push(cur);
  return out;
}

const blockEnd = (text, start) => {
  let depth = 1, i = start + 2;
  while (i < text.length && depth > 0) {
    if (text.startsWith('{{', i)) { depth++; i += 2; } else if (text.startsWith('}}', i)) { depth--; i += 2; } else i++;
  }
  return i;
};

/** every {{Name|…}} in text (balanced), as { param (lower case): value } of its named parameters */
export function templates(text, name) {
  const res = [];
  const re = new RegExp('\\{\\{\\s*' + name.replace(/[ _]/g, '[ _]') + '\\s*\\|', 'gi');
  let m;
  while ((m = re.exec(text))) {
    const i = blockEnd(text, m.index);
    const body = text.slice(m.index + 2, i - 2).replace(/^[^|]*\|/, '');
    const f = {};
    for (const part of tplParts(body)) { const e = part.indexOf('='); if (e > 0) f[part.slice(0, e).trim().toLowerCase()] = part.slice(e + 1).trim(); }
    res.push(f);
    re.lastIndex = i;
  }
  return res;
}

export const noRefs = (t) => String(t || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');

/** wikitext value → plain text */
export const plain = (v) => String(v || '')
  .replace(/\{\{abbr\|([^|}]*)\|[^}]*\}\}/gi, '$1')
  .replace(/\{\{[^{}]*\}\}/g, '')
  .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
  .replace(/'{2,}/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/<[^>]+>/g, '')
  .trim();

/** Liquipedia page of a person: «link» or the id with the first letter in upper case (MediaWiki titles) */
export const personTitle = (f) => { const t = (f.link || f.id || '').replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };

/** the current CS2 roster of a team page: { squad: [{id, t, name, flag, role, igl, inactive}], standins: [...] } */
export function parseSquad(content) {
  let c = noRefs(content);
  const at = c.search(/==\s*Player Roster|==\s*Roster/i);
  if (at >= 0) c = c.slice(at);
  // pages with CS2 / CS:GO tabs: the CS2 tab only
  const tabs = /\|\s*content1\s*=([\s\S]*?)(\|\s*content2\s*=|$)/.exec(c);
  if (tabs) c = tabs[1];
  const out = { squad: [], standins: [] };
  const re = /\{\{\s*Squad\s*\|\s*status\s*=\s*(\w+)/gi;
  let m;
  while ((m = re.exec(c))) {
    const status = m[1].toLowerCase();
    const i = blockEnd(c, m.index);
    if (status === 'active' || status === 'inactive') {
      for (const f of templates(c.slice(m.index, i), 'Person')) {
        if (!f.id || f.leavedate) continue;
        out.squad.push({
          id: plain(f.id), t: personTitle(f), name: plain(f.name), flag: (f.flag || '').toLowerCase(), role: plain(f.role || f.position || ''),
          igl: f.igl === 'y' ? 1 : 0, inactive: status === 'inactive' || !!f.inactivedate ? 1 : 0,
        });
      }
    }
    re.lastIndex = i;
  }
  for (const f of templates(c, 'Stand-in').slice(0, 3)) {
    if (!f.id) continue;
    out.standins.push({ id: plain(f.id), t: personTitle(f), name: plain(f.name), flag: (f.flag || '').toLowerCase(), for: plain(f.for), role: plain(f.role), tour: plain(String(f.tournament || '').replace(/<br\s*\/?>/gi, ' · ')).replace(/\s+/g, ' ').replace(/^[\s·]+|[\s·]+$/g, '') });
  }
  return out;
}
