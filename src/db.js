'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const config = require('./config');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'author',
  bio TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '',
  description TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  story TEXT DEFAULT '',
  cover TEXT DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  video TEXT DEFAULT NULL,
  ingredients TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  tips TEXT DEFAULT '',
  prep_minutes INTEGER DEFAULT 0,
  cook_minutes INTEGER DEFAULT 0,
  rest_minutes INTEGER DEFAULT 0,
  servings REAL DEFAULT 4,
  servings_unit TEXT DEFAULT 'porções',
  difficulty INTEGER DEFAULT 2,
  cuisine TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  nutrition TEXT DEFAULT NULL,
  diets TEXT NOT NULL DEFAULT '[]',
  source_url TEXT DEFAULT '',
  source_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  featured INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  cooked INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipes_status ON recipes(status, published_at);
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category_id);

CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (recipe_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON recipe_tags(tag);

CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
  code, title, description, ingredients, steps, tags,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  asin TEXT DEFAULT '',
  url TEXT DEFAULT '',
  image TEXT DEFAULT '',
  price TEXT DEFAULT '',
  description TEXT DEFAULT '',
  badge TEXT DEFAULT '',
  keywords TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_products (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (recipe_id, product_id)
);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slot TEXT NOT NULL,
  html TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT 'all',
  active INTEGER NOT NULL DEFAULT 1,
  weight INTEGER NOT NULL DEFAULT 1,
  impressions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  rating INTEGER DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ip_hash TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_recipe ON comments(recipe_id, status);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_used_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_slugs (
  slug TEXT PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  original_name TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  ip_hash TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Links de "esqueci minha senha" e convites (token guardado só como hash, uso único)
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'reset',
  expires_at TEXT NOT NULL,
  used_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Envios da newsletter (retomados automaticamente se o servidor reiniciar)
CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  intro TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sending',
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  cursor INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT DEFAULT NULL
);
`;

// Colunas adicionadas depois da primeira versão (migração automática e idempotente)
const COLUMNS = [
  ['users', 'session_version', 'INTEGER NOT NULL DEFAULT 0'],
  // Newsletter com confirmação dupla: pending → confirmed → unsubscribed
  ['subscribers', 'status', "TEXT NOT NULL DEFAULT 'confirmed'"],
  ['subscribers', 'token_hash', "TEXT DEFAULT ''"],
  ['subscribers', 'token_expires', 'TEXT DEFAULT NULL'],
  ['subscribers', 'confirmed_at', 'TEXT DEFAULT NULL'],
  ['subscribers', 'unsubscribed_at', 'TEXT DEFAULT NULL'],
  ['recipes', 'seo_title', "TEXT DEFAULT ''"],
  ['recipes', 'seo_description', "TEXT DEFAULT ''"],
];

function migrate(d) {
  for (const [table, col, def] of COLUMNS) {
    const exists = d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!exists) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  // Categorias sem ícone (ex.: criadas por importação) ganham um emoji a partir do nome
  const { categoryEmoji } = require('./cover');
  for (const c of d.prepare("SELECT id, name FROM categories WHERE icon IS NULL OR trim(icon) = ''").all()) {
    d.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(categoryEmoji(c.name), c.id);
  }
}

function open(file = config.dbFile) {
  db = new DatabaseSync(file);
  // Banco acessível apenas pelo usuário do processo
  if (file !== ':memory:') for (const f of [file, `${file}-wal`, `${file}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* ainda não existe */ } }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function get() {
  if (!db) open();
  return db;
}

function close() {
  if (db) db.close();
  db = undefined;
}

let depth = 0;
/** Transação; chamadas aninhadas viram SAVEPOINT (uma ação em massa inteira vira "tudo ou nada"). */
function tx(fn) {
  const d = get();
  const sp = `sp${depth}`;
  d.exec(depth ? `SAVEPOINT ${sp}` : 'BEGIN');
  depth++;
  try {
    const r = fn(d);
    depth--;
    d.exec(depth ? `RELEASE ${sp}` : 'COMMIT');
    return r;
  } catch (e) {
    depth--;
    d.exec(depth ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    throw e;
  }
}

module.exports = { open, get, close, tx };
