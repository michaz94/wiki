import { Editor, Node, mergeAttributes } from 'https://esm.sh/@tiptap/core@2.11.5';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.11.5';

let db, editor = null, pickerListener = null;
let stack = [{ name: 'home' }];
const app = document.getElementById('app');
const COLORS = ['#f5c518','#ff6b6b','#4ecdc4','#a78bfa','#6bcb77','#ff9f43','#54a0ff','#f368e0'];

/* ---------- nœud wikilink ---------- */
const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      id: { default: null },
      label: { default: '' }
    };
  },
  parseHTML() {
    return [{
      tag: 'a[data-wikilink]',
      getAttrs: el => ({ id: el.getAttribute('data-wikilink'), label: el.textContent })
    }];
  },
  renderHTML({ node }) {
    return ['a', mergeAttributes({
      'data-wikilink': node.attrs.id,
      class: 'wikilink'
    }), node.attrs.label || 'Page'];
  }
});

/* ---------- base de données ---------- */
async function initDB() {
  const SQL = await initSqlJs({
    locateFile: f => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/' + f
  });
  const root = await navigator.storage.getDirectory();
  let bytes = null;
  try {
    const fh = await root.getFileHandle('wiki.db');
    const file = await fh.getFile();
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {}
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY, title TEXT, body TEXT,
    created_at INTEGER, updated_at INTEGER, is_inbox INTEGER DEFAULT 1, space_id TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY, name TEXT, emoji TEXT, color TEXT, created_at INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY, name TEXT, emoji TEXT, fields TEXT, created_at INTEGER)`);
  const cols = q('PRAGMA table_info(pages)').map(c => c.name);
  if (!cols.includes('space_id')) db.run('ALTER TABLE pages ADD COLUMN space_id TEXT');
  if (!cols.includes('template_id')) db.run('ALTER TABLE pages ADD COLUMN template_id TEXT');
  if (!cols.includes('infobox')) db.run('ALTER TABLE pages ADD COLUMN infobox TEXT');
  try { await navigator.storage.persist(); } catch (e) {}
  await saveDB();
}
async function saveDB() {
  const data = db.export();
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle('wiki.db', { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}
function q(sql, params = []) {
  const s = db.prepare(sql);
  s.bind(params);
  const out = [];
  while (s.step()) out.push(s.getAsObject());
  s.free();
  return out;
}
function run(sql, params = []) { db.run(sql, params); }
function getPage(id) { return q('SELECT * FROM pages WHERE id=?', [id])[0]; }
function getSpace(id) { return q('SELECT * FROM spaces WHERE id=?', [id])[0]; }
function getTemplate(id) { return q('SELECT * FROM templates WHERE id=?', [id])[0]; }

/* ---------- utilitaires ---------- */
const esc = s => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const uid = () => crypto.randomUUID();

/* ---------- navigation ---------- */
function go(name, param) { stack.push({ name, param }); render(); }
function back() { stack.pop(); if (!stack.length) stack = [{ name: 'home' }]; render(); }
function replaceCur(name, param) { stack.pop(); stack.push({ name, param }); render(); }

/* ---------- accueil portail ---------- */
function screenHome() {
  const count = q('SELECT COUNT(*) c FROM pages WHERE space_id IS NULL')[0].c;
  const spaces = q('SELECT * FROM spaces ORDER BY created_at');
  const recents = q('SELECT * FROM pages ORDER BY updated_at DESC LIMIT 8');
  app.innerHTML = `
    <header class="top brand">
      <button class="menu-btn" id="openMenu"><span></span><span></span><span></span></button>
      <span class="logo">Fandom</span>
      <div class="searchbar" id="search"><span>🔍</span><span>Rechercher…</span></div>
    </header>
    <main>
      <div class="sec"><span class="sec-ico">🕘</span>Re-plongez-vous</div>
      <div class="hscroll">
        ${recents.map(p => {
          const sp = p.space_id ? getSpace(p.space_id) : null;
          const col = sp ? sp.color : '#f5c518';
          const ini = (p.title?.trim() || 'S')[0].toUpperCase();
          return `<div class="rcard" data-id="${p.id}">
            <div class="rcard-img" style="background:linear-gradient(135deg, ${col}33, ${col}0d)">
              <span class="rcard-ini" style="color:${col}">${esc(ini)}</span>
            </div>
            <div class="rcard-t">${esc(p.title?.trim() || 'Sans titre')}</div>
            <div class="rcard-m">${sp ? esc(sp.emoji + ' ' + sp.name) : '📥 Inbox'}</div>
          </div>`;
        }).join('') || '<div class="empty">Rien pour le moment. Le + jaune capture une idée.</div>'}
      </div>
      <div class="sec"><span class="sec-ico">📚</span>Mes espaces</div>
      <div class="hscroll avatars">
        ${spaces.map(s => `<div class="avatar" data-sid="${s.id}">
          <div class="av-c" style="background:${s.color}">${esc(s.emoji || '📁')}</div>
          <div class="av-n">${esc(s.name)}</div>
        </div>`).join('')}
        <div class="avatar" id="newSpace">
          <div class="av-c av-add">+</div>
          <div class="av-n">Créer</div>
        </div>
      </div>
      <div class="card row" id="toInbox">
        <div class="emo" style="background:#ffffff14">📥</div>
        <div class="grow"><div class="t">Inbox</div><div class="p">Idées non classées</div></div>
        ${count ? `<span class="badge">${count}</span>` : ''}
      </div>
      <div class="card row" id="toTpl">
        <div class="emo" style="background:#ffffff14">🧩</div>
        <div class="grow"><div class="t">Templates</div><div class="p">Fiches perso, lieu, tâche…</div></div>
      </div>
    </main>
    <button class="fab" id="fab">+</button>`;
  document.getElementById('openMenu').onclick = openDrawer;
  document.getElementById('search').onclick = () => go('search');
  document.getElementById('toInbox').onclick = () => go('inbox');
  document.getElementById('toTpl').onclick = () => go('templates');
  document.getElementById('newSpace').onclick = () => go('newspace');
  document.getElementById('fab').onclick = () => quickNote(null);
  app.querySelectorAll('[data-sid]').forEach(c => c.onclick = () => go('space', c.dataset.sid));
  app.querySelectorAll('.rcard').forEach(c => c.onclick = () => go('read', c.dataset.id));
}

/* ---------- recherche ---------- */
function screenSearch() {
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <input class="search-input" id="sq" placeholder="Rechercher dans le wiki…">
    </header>
    <main id="sres"><div class="empty">Tape un mot : titres et textes sont fouillés.</div></main>`;
  document.getElementById('bk').onclick = back;
  const input = document.getElementById('sq');
  const res = document.getElementById('sres');
  input.oninput = () => {
    const f = input.value.trim();
    if (!f) { res.innerHTML = '<div class="empty">Tape un mot : titres et textes sont fouillés.</div>'; return; }
    const like = '%' + f + '%';
    const rows = q('SELECT * FROM pages WHERE title LIKE ? OR body LIKE ? ORDER BY updated_at DESC LIMIT 30', [like, like]);
    res.innerHTML = rows.length ? rows.map(p => cardHTML(p)).join('') : `<div class="empty">Aucun résultat pour « ${esc(f)} ».</div>`;
    wireCards();
  };
  setTimeout(() => input.focus(), 60);
}

/* ---------- templates ---------- */
function screenTemplates() {
  const rows = q('SELECT * FROM templates ORDER BY created_at');
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <h1>Templates</h1>
      <button class="icon-btn" id="plus">+</button>
    </header>
    <main>
      ${rows.map(t => {
        const n = q('SELECT COUNT(*) c FROM pages WHERE template_id=?', [t.id])[0].c;
        return `<div class="card row" data-tid="${t.id}">
          <div class="emo" style="background:#ffffff14">${esc(t.emoji || '🧩')}</div>
          <div class="grow"><div class="t">${esc(t.name)}</div><div class="meta">${n} page${n > 1 ? 's' : ''}</div></div>
        </div>`;
      }).join('') || `<div class="empty">Aucun template.<br>Crée des fiches : personnage, lieu, tâche…</div>`}
    </main>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('plus').onclick = () => go('newtemplate');
  app.querySelectorAll('[data-tid]').forEach(c => c.onclick = () => go('template', c.dataset.tid));
}

function screenNewTemplate() {
  let fields = [];
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <h1>Nouveau template</h1>
    </header>
    <main>
      <div class="lab">Emoji</div>
      <input class="field" id="emo" maxlength="4" value="🧩">
      <div class="lab">Nom</div>
      <input class="field" id="nm" placeholder="Personnage, Lieu, Tâche…">
      <div class="lab">CHAMPS</div>
      <div id="flist"></div>
      <button class="ghost-add" id="addf">+ Ajouter un champ</button>
      <button class="btn-accent quick" id="createTpl">Créer le template</button>
    </main>`;
  const flist = document.getElementById('flist');
  function drawFields() {
    flist.innerHTML = fields.map((f, i) => `
      <div class="field-row">
        <input class="field" data-i="${i}" data-k="label" placeholder="Nom du champ" value="${esc(f.label)}">
        <select class="mini-select" data-i="${i}" data-k="type">
          <option value="text"${f.type === 'long' ? '' : ' selected'}>Texte</option>
          <option value="long"${f.type === 'long' ? ' selected' : ''}>Long</option>
        </select>
        <button class="icon-btn" data-rm="${i}">✕</button>
      </div>`).join('') || `<div class="empty" style="margin-top:6px">Aucun champ pour le moment.</div>`;
    flist.querySelectorAll('input[data-k]').forEach(el => el.oninput = () => { fields[+el.dataset.i].label = el.value; });
    flist.querySelectorAll('select').forEach(el => el.onchange = () => { fields[+el.dataset.i].type = el.value; });
    flist.querySelectorAll('[data-rm]').forEach(el => el.onclick = () => { fields.splice(+el.dataset.rm, 1); drawFields(); });
  }
  drawFields();
  document.getElementById('bk').onclick = back;
  document.getElementById('addf').onclick = () => { fields.push({ label: '', type: 'text' }); drawFields(); };
  document.getElementById('createTpl').onclick = async () => {
    const name = document.getElementById('nm').value.trim();
    if (!name) return;
    const clean = fields.map((f, i) => ({ key: 'f' + i, label: f.label.trim() || ('Champ ' + (i + 1)), type: f.type }));
    const id = uid();
    run('INSERT INTO templates (id,name,emoji,fields,created_at) VALUES (?,?,?,?,?)',
      [id, name, document.getElementById('emo').value.trim() || '🧩', JSON.stringify(clean), Date.now()]);
    await saveDB();
    replaceCur('template', id);
  };
}

function screenTemplate(id) {
  const t = getTemplate(id);
  if (!t) { back(); return; }
  const fields = JSON.parse(t.fields || '[]');
  const pages = q('SELECT * FROM pages WHERE template_id=? ORDER BY updated_at DESC', [id]);
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <div class="title">${esc(t.emoji || '')} ${esc(t.name)}</div>
    </header>
    <main>
      <button class="btn-accent quick" id="np">+ Nouvelle page</button>
      <div class="sec"><span class="sec-ico">🧾</span>CHAMPS</div>
      ${fields.map(f => `<div class="card row"><div class="grow"><div class="t">${esc(f.label)}</div><div class="meta">${f.type === 'long' ? 'Texte long' : 'Texte'}</div></div></div>`).join('') || '<div class="empty">Aucun champ.</div>'}
      <div class="sec"><span class="sec-ico">📄</span>PAGES</div>
      ${pages.map(p => cardHTML(p)).join('') || '<div class="empty">Aucune page avec ce template.</div>'}
    </main>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('np').onclick = async () => {
    const pid = uid(), now = Date.now();
    run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id,template_id,infobox) VALUES (?,?,?,?,?,?,?,?,?)',
      [pid, '', '', now, now, 1, null, id, '{}']);
    await saveDB();
    go('edit', pid);
  };
  wireCards();
}

/* ---------- espace ---------- */
function screenSpace(id) {
  const s = getSpace(id);
  if (!s) { back(); return; }
  const rows = q('SELECT * FROM pages WHERE space_id=? ORDER BY updated_at DESC', [id]);
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <div class="title">${esc(s.emoji || '')} ${esc(s.name)}</div>
    </header>
    <main>
      ${rows.length ? rows.map(p => cardHTML(p)).join('') : `<div class="empty">Aucune page dans cet espace.<br>Le + jaune en crée une ici.</div>`}
    </main>
    <button class="fab" id="fab" style="background:${s.color}">+</button>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('fab').onclick = () => quickNote(id);
  wireCards();
}

/* ---------- nouvel espace (aperçu live) ---------- */
function screenNewSpace() {
  let color = COLORS[0];
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <h1>Nouveau monde</h1>
    </header>
    <main>
      <div class="ns-preview">
        <div class="av-c av-big" id="pv" style="background:${color}">📕</div>
        <div class="ns-pv-name" id="pvn">Ton espace</div>
      </div>
      <div class="lab">EMOJI</div>
      <input class="field" id="emo" maxlength="4" value="📕">
      <div class="lab">NOM</div>
      <input class="field" id="nm" placeholder="Roman, projet, univers…">
      <div class="lab">COULEUR</div>
      <div class="swatches" id="sw">${COLORS.map((c, i) => `<div class="sw${i === 0 ? ' sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div>
      <button class="btn-accent quick" id="go">Créer ce monde</button>
    </main>`;
  const pv = document.getElementById('pv');
  const pvn = document.getElementById('pvn');
  const emo = document.getElementById('emo');
  const nm = document.getElementById('nm');
  const upd = () => { pv.style.background = color; pv.textContent = emo.value.trim() || '📁'; pvn.textContent = nm.value.trim() || 'Ton espace'; };
  emo.oninput = upd; nm.oninput = upd;
  document.getElementById('bk').onclick = back;
  document.getElementById('sw').querySelectorAll('.sw').forEach(el => el.onclick = () => {
    color = el.dataset.c;
    document.querySelectorAll('#sw .sw').forEach(x => x.classList.toggle('sel', x === el));
    upd();
  });
  document.getElementById('go').onclick = async () => {
    const name = nm.value.trim();
    if (!name) return;
    const emoji = emo.value.trim() || '📁';
    const id = uid();
    run('INSERT INTO spaces (id,name,emoji,color,created_at) VALUES (?,?,?,?,?)', [id, name, emoji, color, Date.now()]);
    await saveDB();
    replaceCur('space', id);
  };
}

/* ---------- classer ---------- */
function screenClasser(id) {
  const p = getPage(id);
  if (!p) { back(); return; }
  const spaces = q('SELECT * FROM spaces ORDER BY name');
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <h1>Classer</h1>
    </header>
    <main>
      <div class="card row pick" data-pick="">
        <div class="emo" style="background:#ffffff14">📥</div>
        <div class="grow"><div class="t">Inbox — non classé</div></div>
        ${!p.space_id ? '<span class="badge">✓</span>' : ''}
      </div>
      ${spaces.map(s => `<div class="card row pick" data-pick="${s.id}" style="border-left:4px solid ${s.color}">
        <div class="emo" style="background:${s.color}26">${esc(s.emoji || '📁')}</div>
        <div class="grow"><div class="t">${esc(s.name)}</div></div>
        ${p.space_id === s.id ? '<span class="badge">✓</span>' : ''}
      </div>`).join('')}
    </main>`;
  document.getElementById('bk').onclick = back;
  app.querySelectorAll('.pick').forEach(el => el.onclick = async () => {
    const sid = el.dataset.pick || null;
    run('UPDATE pages SET space_id=?, is_inbox=?, updated_at=? WHERE id=?', [sid, sid ? 0 : 1, Date.now(), id]);
    await saveDB();
    replaceCur('read', id);
  });
}

/* ---------- inbox ---------- */
function screenInbox() {
  const rows = q('SELECT * FROM pages WHERE space_id IS NULL ORDER BY updated_at DESC');
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <h1>Inbox</h1>
    </header>
    <main>
      ${rows.length ? rows.map(p => cardHTML(p)).join('') : `<div class="empty">Rien dans l'Inbox.<br>Tout ce que tu captures arrive ici.</div>`}
    </main>
    <button class="fab" id="fab">+</button>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('fab').onclick = () => quickNote(null);
  wireCards();
}

/* ---------- cartes ---------- */
function cardHTML(p) {
  const title = p.title?.trim() || 'Sans titre';
  const prev = strip(p.body).slice(0, 120);
  return `<div class="card" data-id="${p.id}">
    <div class="t">${esc(title)}</div>
    ${prev ? `<div class="p">${esc(prev)}</div>` : ''}
    <div class="d">${fmt(p.updated_at)}</div>
  </div>`;
}
function wireCards() {
  app.querySelectorAll('.card[data-id]').forEach(c =>
    c.onclick = () => go('read', c.dataset.id));
}

/* ---------- lecture ---------- */
function screenRead(id) {
  const p = getPage(id);
  if (!p) { back(); return; }
  const s = p.space_id ? getSpace(p.space_id) : null;
  const chip = s
    ? `<span style="color:${s.color}">${esc(s.emoji || '')}</span> ${esc(s.name)}`
    : `📥 Inbox`;
  const tpl = p.template_id ? getTemplate(p.template_id) : null;
  let info = {}; try { info = JSON.parse(p.infobox || '{}'); } catch (e) {}
  const ibRows = tpl ? JSON.parse(tpl.fields || '[]').filter(f => (info[f.key] || '').trim()) : [];
  const bl = q('SELECT id,title,body,created_at,updated_at,is_inbox,space_id FROM pages WHERE id<>? AND body LIKE ?',
    [id, '%data-wikilink="' + id + '"%']);
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <div class="title">${esc(p.title?.trim() || 'Sans titre')}</div>
      <button class="icon-btn" id="dup">⧉</button>
      <button class="btn-ghost" id="ed">Modifier</button>
    </header>
    <article class="read">
      <button class="chip" id="chip">${chip}</button>
      <h1 class="page-title">${esc(p.title?.trim() || 'Sans titre')}</h1>
      ${ibRows.length ? `<div class="infobox"><div class="ib-head">${esc(tpl.emoji || '')} ${esc(tpl.name)}</div>${ibRows.map(f => `<div class="ib-row"><div class="ib-k">${esc(f.label)}</div><div class="ib-v">${esc(info[f.key])}</div></div>`).join('')}</div>` : ''}
      <div class="body">${p.body || '<p style="color:var(--muted)">Page vide.</p>'}</div>
      ${bl.length ? `<div class="sec"><span class="sec-ico">🔗</span>LIENS ENTRANTS</div>${bl.map(x => cardHTML(x)).join('')}` : ''}
    </article>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('ed').onclick = () => go('edit', id);
  document.getElementById('chip').onclick = () => go('classer', id);
  document.getElementById('dup').onclick = () => duplicatePage(id);
  app.querySelector('.body').querySelectorAll('a[data-wikilink]').forEach(a => {
    const pid = a.getAttribute('data-wikilink');
    const t = getPage(pid);
    a.textContent = t ? (t.title?.trim() || 'Sans titre') : 'Page supprimée';
    a.classList.toggle('dead', !t);
    a.onclick = e => { e.preventDefault(); if (t) go('read', pid); };
  });
  wireCards();
}

/* ---------- édition ---------- */
function screenEdit(id) {
  const p = getPage(id);
  if (!p) { back(); return; }
  const tpl = p.template_id ? getTemplate(p.template_id) : null;
  const fields = tpl ? JSON.parse(tpl.fields || '[]') : [];
  let info = {}; try { info = JSON.parse(p.infobox || '{}'); } catch (e) {}
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <div class="title">Édition</div>
      <button class="btn-accent" id="save">Enregistrer</button>
    </header>
    <input class="title-input" id="ttl" placeholder="Titre" value="${esc(p.title)}">
    ${fields.length ? `<div class="ib-form">${fields.map(f => `
      <div class="lab">${esc(f.label)}</div>
      ${f.type === 'long'
        ? `<textarea class="field" rows="3" data-ib="${f.key}">${esc(info[f.key] || '')}</textarea>`
        : `<input class="field" data-ib="${f.key}" value="${esc(info[f.key] || '')}">`}
    `).join('')}</div>` : ''}
    <div class="editor-wrap"><div id="ed"></div></div>
    <div class="toolbar" id="tb"></div>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('save').onclick = async () => {
    const title = document.getElementById('ttl').value;
    const body = editor.getHTML();
    if (fields.length) {
      fields.forEach(f => {
        const el = document.querySelector(`[data-ib="${f.key}"]`);
        if (el) info[f.key] = el.value;
      });
    }
    run('UPDATE pages SET title=?, body=?, updated_at=?, infobox=? WHERE id=?',
      [title, body, Date.now(), JSON.stringify(info), id]);
    await saveDB();
    editor.destroy(); editor = null;
    replaceCur('read', id);
  };
  editor = new Editor({
    element: document.getElementById('ed'),
    content: p.body || '',
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Wikilink
    ],
    onUpdate: () => updateTb()
  });
  pickerListener = () => openPicker(insertWikilink);
  window.addEventListener('open-wikilink-picker', pickerListener);
  buildToolbar();
  updateTb();
}

/* ---------- dupliquer ---------- */
async function duplicatePage(id) {
  const p = getPage(id);
  if (!p) return;
  const nid = uid(), now = Date.now();
  run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id,template_id,infobox) VALUES (?,?,?,?,?,?,?,?,?)',
    [nid, (p.title || 'Sans titre') + ' (copie)', p.body || '', now, now, p.is_inbox, p.space_id, p.template_id, p.infobox || '{}']);
  await saveDB();
  go('read', nid);
}

/* ---------- picker wikilink ---------- */
function openPicker(onPick) {
  const pages = q('SELECT id,title,space_id FROM pages ORDER BY updated_at DESC');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="ov-box">
      <input class="field" id="pkq" placeholder="Chercher une page…">
      <div class="ov-list" id="pkl"></div>
    </div>`;
  document.body.appendChild(ov);
  const input = ov.querySelector('#pkq');
  const list = ov.querySelector('#pkl');
  const close = () => ov.remove();
  function draw(filter = '') {
    const f = filter.toLowerCase();
    const rows = pages.filter(x => (x.title || '').toLowerCase().includes(f)).slice(0, 50);
    list.innerHTML = rows.map(x => {
      const sp = x.space_id ? getSpace(x.space_id) : null;
      return `<div class="card row pk" data-id="${x.id}">
        ${sp ? `<div class="emo" style="background:${sp.color}26">${esc(sp.emoji || '')}</div>` : ''}
        <div class="grow"><div class="t">${esc(x.title || 'Sans titre')}</div></div>
      </div>`;
    }).join('') + (filter
      ? `<div class="card row pk-new"><div class="grow"><div class="t" style="color:var(--accent)">+ Créer « ${esc(filter)} »</div></div></div>`
      : '');
    list.querySelectorAll('.pk').forEach(el =>
      el.onclick = () => { close(); onPick({ id: el.dataset.id }); });
    const nw = list.querySelector('.pk-new');
    if (nw) nw.onclick = () => { close(); onPick({ create: filter }); };
  }
  input.oninput = () => draw(input.value.trim());
  ov.onclick = e => { if (e.target === ov) close(); };
  draw();
  setTimeout(() => input.focus(), 60);
}
function insertWikilink(pick) {
  if (!editor) return;
  if (pick.create) {
    const id = uid(), now = Date.now();
    run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id) VALUES (?,?,?,?,?,?,?)',
      [id, pick.create, '', now, now, 1, null]);
    saveDB();
    editor.chain().focus().insertContent({ type: 'wikilink', attrs: { id, label: pick.create } }).run();
  } else {
    const t = getPage(pick.id);
    editor.chain().focus().insertContent({ type: 'wikilink', attrs: { id: pick.id, label: t?.title || 'Sans titre' } }).run();
  }
}

/* ---------- toolbar ---------- */
const CMDS = [
  ['undo', '↶', e => e.chain().focus().undo().run(), e => false],
  ['redo', '↷', e => e.chain().focus().redo().run(), e => false],
  ['sep'],
  ['p', '¶', e => e.chain().focus().setParagraph().run(), e => e.isActive('paragraph')],
  ['h2', 'H2', e => e.chain().focus().toggleHeading({ level: 2 }).run(), e => e.isActive('heading', { level: 2 })],
  ['h3', 'H3', e => e.chain().focus().toggleHeading({ level: 3 }).run(), e => e.isActive('heading', { level: 3 })],
  ['h4', 'H4', e => e.chain().focus().toggleHeading({ level: 4 }).run(), e => e.isActive('heading', { level: 4 })],
  ['sep'],
  ['b', 'B', e => e.chain().focus().toggleBold().run(), e => e.isActive('bold')],
  ['i', '<i>I</i>', e => e.chain().focus().toggleItalic().run(), e => e.isActive('italic')],
  ['s', '<s>S</s>', e => e.chain().focus().toggleStrike().run(), e => e.isActive('strike')],
  ['sep'],
  ['ul', '•', e => e.chain().focus().toggleBulletList().run(), e => e.isActive('bulletList')],
  ['ol', '1.', e => e.chain().focus().toggleOrderedList().run(), e => e.isActive('orderedList')],
  ['sep'],
  ['bq', '❝', e => e.chain().focus().toggleBlockquote().run(), e => e.isActive('blockquote')],
  ['hr', '—', e => e.chain().focus().setHorizontalRule().run(), e => false],
  ['sep'],
  ['wl', '🔗', () => window.dispatchEvent(new CustomEvent('open-wikilink-picker')), e => false]
];
function buildToolbar() {
  const tb = document.getElementById('tb');
  tb.innerHTML = CMDS.map(c => c[0] === 'sep'
    ? '<div class="tb-sep"></div>'
    : `<button class="tb" data-c="${c[0]}">${c[1]}</button>`).join('');
  tb.querySelectorAll('button').forEach(b =>
    b.onclick = ev => {
      ev.preventDefault();
      const c = CMDS.find(x => x[0] === b.dataset.c);
      c[2](editor);
      updateTb();
    });
}
function updateTb() {
  if (!editor) return;
  document.querySelectorAll('#tb .tb').forEach(b => {
    const c = CMDS.find(x => x[0] === b.dataset.c);
    if (c && c[3]) b.classList.toggle('on', c[3](editor));
  });
}

/* ---------- capture ---------- */
async function quickNote(spaceId) {
  const id = uid(), now = Date.now();
  run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id) VALUES (?,?,?,?,?,?,?)',
    [id, '', '', now, now, spaceId ? 0 : 1, spaceId]);
  await saveDB();
  go('edit', id);
}

/* ---------- thème ---------- */
function loadTheme() {
  const t = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = t;
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
}

/* ---------- drawer (menu latéral) ---------- */
function openDrawer() {
  const isLight = (document.documentElement.dataset.theme || 'dark') === 'light';
  const dr = document.createElement('div');
  dr.className = 'drawer-overlay';
  dr.innerHTML = `
    <aside class="drawer" onclick="event.stopPropagation()">
      <div class="drawer-head">
        <span class="logo">Fandom</span>
        <button class="icon-btn" id="drClose">✕</button>
      </div>
      <nav class="drawer-nav">
        <button class="dr-item" data-act="home"><span class="dr-ico">⌂</span>Accueil</button>
        <button class="dr-item" data-act="saved"><span class="dr-ico">✚</span>Enregistré</button>
        <button class="dr-item" data-act="progress"><span class="dr-ico">✓</span>Suivi de la progression</button>
        <button class="dr-item" data-act="history"><span class="dr-ico">⏱</span>Historique</button>
        <button class="dr-item" data-act="tools"><span class="dr-ico">▦</span>Utilitaires</button>
      </nav>
      <div class="drawer-sep"></div>
      <nav class="drawer-nav">
        <button class="dr-item small">Parcourir les wikis</button>
        <button class="dr-item small">Centre des communautés</button>
      </nav>
      <div class="drawer-sep"></div>
      <button class="dr-item" id="drTheme">
        <span class="dr-ico">${isLight ? '☾' : '☀'}</span>
        Passer au thème ${isLight ? 'sombre' : 'clair'}
      </button>
    </aside>`;
  document.body.appendChild(dr);
  requestAnimationFrame(() => dr.classList.add('open'));
  const close = () => { dr.classList.remove('open'); setTimeout(() => dr.remove(), 260); };
  dr.onclick = close;
  dr.querySelector('#drClose').onclick = close;
  dr.querySelector('#drTheme').onclick = e => { e.stopPropagation(); toggleTheme(); close(); };
  dr.querySelectorAll('.dr-item[data-act]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const a = b.dataset.act;
    close();
    if (a === 'home') { stack = [{ name: 'home' }]; render(); }
    else if (a === 'history') go('inbox');
  });
}

/* ---------- rendu ---------- */
function render() {
  if (pickerListener) { window.removeEventListener('open-wikilink-picker', pickerListener); pickerListener = null; }
  if (editor && stack[stack.length - 1].name !== 'edit') { editor.destroy(); editor = null; }
  const cur = stack[stack.length - 1];
  if (cur.name === 'home') screenHome();
  else if (cur.name === 'inbox') screenInbox();
  else if (cur.name === 'read') screenRead(cur.param);
  else if (cur.name === 'edit') screenEdit(cur.param);
  else if (cur.name === 'space') screenSpace(cur.param);
  else if (cur.name === 'newspace') screenNewSpace();
  else if (cur.name === 'classer') screenClasser(cur.param);
  else if (cur.name === 'templates') screenTemplates();
  else if (cur.name === 'newtemplate') screenNewTemplate();
  else if (cur.name === 'template') screenTemplate(cur.param);
  else if (cur.name === 'search') screenSearch();
  window.scrollTo(0, 0);
}

/* ---------- démarrage ---------- */
app.innerHTML = '<div class="empty">Chargement…</div>';
loadTheme();
try {
  await initDB();
  render();
} catch (e) {
  app.innerHTML = `<div class="empty">Erreur : ${esc(String(e))}</div>`;
}
