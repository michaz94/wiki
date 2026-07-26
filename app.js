import { Editor } from 'https://esm.sh/@tiptap/core@2.11.5';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.11.5';

let db, editor = null;
let stack = [{ name: 'home' }];
const app = document.getElementById('app');
const COLORS = ['#f5c518','#ff6b6b','#4ecdc4','#a78bfa','#6bcb77','#ff9f43','#54a0ff','#f368e0'];

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
  const cols = q('PRAGMA table_info(pages)').map(c => c.name);
  if (!cols.includes('space_id')) db.run('ALTER TABLE pages ADD COLUMN space_id TEXT');
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

/* ---------- utilitaires ---------- */
const esc = s => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const uid = () => crypto.randomUUID();

/* ---------- navigation ---------- */
function go(name, param) { stack.push({ name, param }); render(); }
function back() { stack.pop(); if (!stack.length) stack = [{ name: 'home' }]; render(); }
function replaceCur(name, param) { stack.pop(); stack.push({ name, param }); render(); }

/* ---------- accueil ---------- */
function screenHome() {
  const count = q('SELECT COUNT(*) c FROM pages WHERE space_id IS NULL')[0].c;
  const spaces = q('SELECT * FROM spaces ORDER BY created_at');
  const recents = q('SELECT * FROM pages ORDER BY updated_at DESC LIMIT 5');
  app.innerHTML = `
    <header class="top"><h1>Notes</h1></header>
    <main>
      <button class="btn-accent quick" id="quick">+ Note rapide</button>
      <div class="card row" id="toInbox">
        <div class="grow"><div class="t">📥 Inbox</div><div class="p">Idées non classées</div></div>
        ${count ? `<span class="badge">${count}</span>` : ''}
      </div>
      <div class="sec">ESPACES</div>
      ${spaces.map(s => {
        const n = q('SELECT COUNT(*) c FROM pages WHERE space_id=?', [s.id])[0].c;
        return `<div class="card space-card" data-sid="${s.id}" style="border-left:4px solid ${s.color}">
          <div class="emo" style="background:${s.color}26">${esc(s.emoji || '📁')}</div>
          <div class="grow"><div class="t">${esc(s.name)}</div><div class="meta">${n} page${n > 1 ? 's' : ''}</div></div>
        </div>`;
      }).join('')}
      <button class="ghost-add" id="newSpace">+ Créer un espace</button>
      ${recents.length ? `<div class="sec">RÉCENTES</div>` : ''}
      ${recents.map(p => cardHTML(p)).join('')}
    </main>`;
  document.getElementById('quick').onclick = () => quickNote(null);
  document.getElementById('toInbox').onclick = () => go('inbox');
  document.getElementById('newSpace').onclick = () => go('newspace');
  app.querySelectorAll('[data-sid]').forEach(c => c.onclick = () => go('space', c.dataset.sid));
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
      <button class="btn-accent quick" id="add" style="background:${s.color}">+ Note ici</button>
      ${rows.length ? rows.map(p => cardHTML(p)).join('') : `<div class="empty">Aucune page dans cet espace.</div>`}
    </main>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('add').onclick = () => quickNote(id);
  wireCards();
}

/* ---------- nouvel espace ---------- */
function screenNewSpace() {
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <h1>Nouvel espace</h1>
    </header>
    <main>
      <div class="lab">Emoji</div>
      <input class="field" id="emo" maxlength="4" placeholder="📕" value="📕">
      <div class="lab">Nom</div>
      <input class="field" id="nm" placeholder="Roman, projet…">
      <div class="lab">Couleur</div>
      <div class="swatches" id="sw">${COLORS.map((c, i) => `<div class="sw${i === 0 ? ' sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div>
      <button class="btn-accent quick" id="go">Créer</button>
    </main>`;
  let color = COLORS[0];
  document.getElementById('bk').onclick = back;
  document.getElementById('sw').querySelectorAll('.sw').forEach(el => el.onclick = () => {
    color = el.dataset.c;
    document.querySelectorAll('#sw .sw').forEach(x => x.classList.toggle('sel', x === el));
  });
  document.getElementById('go').onclick = async () => {
    const name = document.getElementById('nm').value.trim();
    if (!name) return;
    const emoji = document.getElementById('emo').value.trim() || '📁';
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
      <button class="icon-btn" id="plus">+</button>
    </header>
    <main>
      ${rows.length ? rows.map(p => cardHTML(p)).join('') : `<div class="empty">Rien dans l'Inbox.<br>Tout ce que tu captures arrive ici.</div>`}
    </main>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('plus').onclick = () => quickNote(null);
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
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <div class="title">${esc(p.title?.trim() || 'Sans titre')}</div>
      <button class="btn-ghost" id="ed">Modifier</button>
    </header>
    <article class="read">
      <button class="chip" id="chip">${chip}</button>
      <h1 class="page-title">${esc(p.title?.trim() || 'Sans titre')}</h1>
      <div class="body">${p.body || '<p style="color:var(--muted)">Page vide.</p>'}</div>
    </article>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('ed').onclick = () => go('edit', id);
  document.getElementById('chip').onclick = () => go('classer', id);
}

/* ---------- édition ---------- */
function screenEdit(id) {
  const p = getPage(id);
  if (!p) { back(); return; }
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <div class="title">Édition</div>
      <button class="btn-accent" id="save">Enregistrer</button>
    </header>
    <input class="title-input" id="ttl" placeholder="Titre" value="${esc(p.title)}">
    <div class="editor-wrap"><div id="ed"></div></div>
    <div class="toolbar" id="tb"></div>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('save').onclick = async () => {
    const title = document.getElementById('ttl').value;
    const body = editor.getHTML();
    run('UPDATE pages SET title=?, body=?, updated_at=? WHERE id=?',
      [title, body, Date.now(), id]);
    await saveDB();
    editor.destroy(); editor = null;
    replaceCur('read', id);
  };
  editor = new Editor({
    element: document.getElementById('ed'),
    content: p.body || '',
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] } })],
    onUpdate: () => updateTb()
  });
  buildToolbar();
  updateTb();
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
  ['hr', '—', e => e.chain().focus().setHorizontalRule().run(), e => false]
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

/* ---------- rendu ---------- */
function render() {
  if (editor && stack[stack.length - 1].name !== 'edit') { editor.destroy(); editor = null; }
  const cur = stack[stack.length - 1];
  if (cur.name === 'home') screenHome();
  else if (cur.name === 'inbox') screenInbox();
  else if (cur.name === 'read') screenRead(cur.param);
  else if (cur.name === 'edit') screenEdit(cur.param);
  else if (cur.name === 'space') screenSpace(cur.param);
  else if (cur.name === 'newspace') screenNewSpace();
  else if (cur.name === 'classer') screenClasser(cur.param);
  window.scrollTo(0, 0);
}

/* ---------- démarrage ---------- */
app.innerHTML = '<div class="empty">Chargement…</div>';
try {
  await initDB();
  render();
} catch (e) {
  app.innerHTML = `<div class="empty">Erreur : ${esc(String(e))}</div>`;
}
