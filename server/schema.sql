CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL,
  default_low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (default_low_stock_threshold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sku TEXT NOT NULL, description TEXT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  cost_price NUMERIC(12,2), selling_price NUMERIC(12,2), low_stock_threshold INTEGER,
  last_updated_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, sku));
