import { Editor } from 'https://esm.sh/@tiptap/core@2.11.5';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.11.5';

let db, editor = null;
let stack = [{ name: 'home' }];
const app = document.getElementById('app');

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
    created_at INTEGER, updated_at INTEGER, is_inbox INTEGER DEFAULT 1)`);
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

/* ---------- petits utilitaires ---------- */
const esc = s => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const uid = () => crypto.randomUUID();

/* ---------- navigation ---------- */
function go(name, param) { stack.push({ name, param }); render(); }
function back() { stack.pop(); if (!stack.length) stack = [{ name: 'home' }]; render(); }
function replaceCur(name, param) { stack.pop(); stack.push({ name, param }); render(); }

/* ---------- écrans ---------- */
function screenHome() {
  const count = q('SELECT COUNT(*) c FROM pages WHERE is_inbox=1')[0].c;
  const recents = q('SELECT * FROM pages ORDER BY updated_at DESC LIMIT 5');
  app.innerHTML = `
    <header class="top"><h1>Notes</h1></header>
    <main>
      <button class="btn-accent quick" id="quick">+ Note rapide</button>
      <div class="card row" id="toInbox">
        <div class="grow"><div class="t">Inbox</div><div class="p">Idées non classées</div></div>
        ${count ? `<span class="badge">${count}</span>` : ''}
      </div>
      ${recents.length ? `<h2 style="font-size:14px;color:var(--muted);margin:18px 0 8px">RÉCENTES</h2>` : ''}
      ${recents.map(p => cardHTML(p)).join('')}
    </main>`;
  document.getElementById('quick').onclick = quickNote;
  document.getElementById('toInbox').onclick = () => go('inbox');
  wireCards();
}

function screenInbox() {
  const rows = q('SELECT * FROM pages WHERE is_inbox=1 ORDER BY updated_at DESC');
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
  document.getElementById('plus').onclick = quickNote;
  wireCards();
}

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

function screenRead(id) {
  const p = getPage(id);
  if (!p) { back(); return; }
  app.innerHTML = `
    <header class="top">
      <button class="icon-btn" id="bk">←</button>
      <div class="title">${esc(p.title?.trim() || 'Sans titre')}</div>
      <button class="btn-ghost" id="ed">Modifier</button>
    </header>
    <article class="read">
      <h1 class="page-title">${esc(p.title?.trim() || 'Sans titre')}</h1>
      <div class="body">${p.body || '<p style="color:var(--muted)">Page vide.</p>'}</div>
    </article>`;
  document.getElementById('bk').onclick = back;
  document.getElementById('ed').onclick = () => go('edit', id);
}

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
async function quickNote() {
  const id = uid(), now = Date.now();
  run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox) VALUES (?,?,?,?,?,1)',
    [id, '', '', now, now]);
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
