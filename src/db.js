import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tryon_type TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'unissex',
  price_cents INTEGER,
  sizes TEXT NOT NULL DEFAULT '[]',
  colors TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  ai_notes TEXT NOT NULL DEFAULT '',
  buy_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  color TEXT,
  is_tryon_ref INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);

-- product_id/image_id sem FK de propósito: o histórico de custo sobrevive à exclusão da peça.
CREATE TABLE IF NOT EXISTS tryons (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  product_id INTEGER,
  image_id INTEGER,
  color TEXT,
  size TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  error TEXT,
  client_id TEXT,
  ip_hash TEXT,
  cache_key TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  person_file TEXT,
  result_file TEXT,
  usage TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tryons_created ON tryons(created_at);
CREATE INDEX IF NOT EXISTS idx_tryons_client ON tryons(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tryons_ip ON tryons(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_tryons_cache ON tryons(cache_key);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  product_id INTEGER,
  tryon_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  applySchema(db);
  return db;
}

function applySchema(db) {
  db.exec(SCHEMA);
}

openDb.applySchema = applySchema;
