require('dotenv').config();
const fs = require('fs'), path = require('path');
const express = require('express'), session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const pool = require('./db');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret', resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 },
}));
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const auth = (req, res, next) => req.session.userId ? next() : res.status(401).json({ error: 'Please log in' });
const regen = req => new Promise((ok, no) => req.session.regenerate(e => e ? no(e) : ok()));

// ---- Auth ----
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { email = '', password = '', orgName = '' } = req.body;
  const errors = {};
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Enter a valid email';
  if (password.length < 8) errors.password = 'Use at least 8 characters';
  if (!orgName.trim()) errors.orgName = 'Organization name is required';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Check the highlighted fields', errors });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const org = (await c.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [orgName.trim()])).rows[0];
    const user = (await c.query('INSERT INTO users(org_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',
      [org.id, email.trim(), await bcrypt.hash(password, 10)])).rows[0];
    await c.query('COMMIT');
    await regen(req);
    Object.assign(req.session, { userId: user.id, orgId: org.id });
    res.status(201).json({ email: email.trim(), orgName: orgName.trim() });
  } catch (e) {
    await c.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Check the highlighted fields', errors: { email: 'Email already registered' } });
    throw e;
  } finally { c.release(); }
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email = '', password = '' } = req.body;
  const u = (await pool.query(
    'SELECT u.id,u.org_id,u.email,u.password_hash,o.name AS org_name FROM users u JOIN organizations o ON o.id=u.org_id WHERE lower(u.email)=lower($1)', [email.trim()])).rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect' });
  await regen(req);
  Object.assign(req.session, { userId: u.id, orgId: u.org_id });
  res.json({ email: u.email, orgName: u.org_name });
}));
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const u = (await pool.query('SELECT u.email,o.name AS "orgName" FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.id=$1', [req.session.userId])).rows[0];
  u ? res.json(u) : res.status(401).json({ error: 'Please log in' });
}));

// ---- Products ----
const LOW = 'p.quantity <= COALESCE(p.low_stock_threshold, o.default_low_stock_threshold)';
function parseProduct(b) {
  const e = {}, blank = v => v === '' || v == null;
  const name = String(b.name || '').trim(), sku = String(b.sku || '').trim();
  if (!name) e.name = 'Name is required';
  if (!sku) e.sku = 'SKU is required';
  const whole = (k, def) => { const v = blank(b[k]) ? def : Number(b[k]); if (v !== null && (!Number.isInteger(v) || v < 0)) e[k] = 'Enter a whole number, 0 or more'; return v; };
  const money = k => { const v = blank(b[k]) ? null : Number(b[k]); if (v !== null && (!Number.isFinite(v) || v < 0)) e[k] = 'Enter an amount, 0 or more'; return v; };
  const v = { name, sku, description: b.description || null, quantity: whole('quantity', 0),
    cost: money('cost_price'), sell: money('selling_price'), thr: whole('low_stock_threshold', null) };
  return { e, v };
}
const dupSku = res => res.status(409).json({ error: 'Check the highlighted fields', errors: { sku: 'SKU already used in your organization' } });
app.param('id', (req, res, next, id) => /^\d+$/.test(id) ? next() : res.status(404).json({ error: 'Not found' }));

app.get('/api/products', auth, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const r = await pool.query(`SELECT p.*, ${LOW} AS low_stock FROM products p JOIN organizations o ON o.id=p.org_id
    WHERE p.org_id=$1 AND ($2='' OR p.name ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%') ORDER BY p.created_at DESC`, [req.session.orgId, q]);
  res.json(r.rows);
}));
app.get('/api/products/:id', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM products WHERE id=$1 AND org_id=$2', [req.params.id, req.session.orgId]);
  r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ error: 'Product not found' });
}));
app.post('/api/products', auth, wrap(async (req, res) => {
  const { e, v } = parseProduct(req.body);
  if (Object.keys(e).length) return res.status(400).json({ error: 'Check the highlighted fields', errors: e });
  try {
    const me = (await pool.query('SELECT email FROM users WHERE id=$1', [req.session.userId])).rows[0].email;
    const r = await pool.query(`INSERT INTO products(org_id,name,sku,description,quantity,cost_price,selling_price,low_stock_threshold,last_updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.session.orgId, v.name, v.sku, v.description, v.quantity, v.cost, v.sell, v.thr, me]);
    res.status(201).json(r.rows[0]);
  } catch (err) { if (err.code === '23505') return dupSku(res); throw err; }
}));
app.put('/api/products/:id', auth, wrap(async (req, res) => {
  const { e, v } = parseProduct(req.body);
  if (Object.keys(e).length) return res.status(400).json({ error: 'Check the highlighted fields', errors: e });
  try {
    const r = await pool.query(`UPDATE products SET name=$3,sku=$4,description=$5,quantity=$6,cost_price=$7,selling_price=$8,low_stock_threshold=$9,
      last_updated_by=(SELECT email FROM users WHERE id=$10), updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *`,
      [req.params.id, req.session.orgId, v.name, v.sku, v.description, v.quantity, v.cost, v.sell, v.thr, req.session.userId]);
    r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ error: 'Product not found' });
  } catch (err) { if (err.code === '23505') return dupSku(res); throw err; }
}));
app.post('/api/products/:id/adjust', auth, wrap(async (req, res) => {
  const d = Number(req.body.delta);
  if (!Number.isInteger(d) || d === 0) return res.status(400).json({ error: 'Enter a whole number like +5 or -2' });
  const r = await pool.query(`UPDATE products SET quantity=quantity+$3, updated_at=now(), last_updated_by=(SELECT email FROM users WHERE id=$4)
    WHERE id=$1 AND org_id=$2 AND quantity+$3>=0 RETURNING *`, [req.params.id, req.session.orgId, d, req.session.userId]);
  r.rows[0] ? res.json(r.rows[0]) : res.status(400).json({ error: 'Not enough stock for that adjustment' });
}));
app.delete('/api/products/:id', auth, wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM products WHERE id=$1 AND org_id=$2', [req.params.id, req.session.orgId]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Product not found' });
}));

// ---- Dashboard & settings ----
app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const o = req.session.orgId;
  const t = (await pool.query('SELECT COUNT(*)::int AS total_products, COALESCE(SUM(quantity),0)::int AS total_units FROM products WHERE org_id=$1', [o])).rows[0];
  const low = (await pool.query(`SELECT p.id,p.name,p.sku,p.quantity, COALESCE(p.low_stock_threshold,o.default_low_stock_threshold) AS threshold
    FROM products p JOIN organizations o ON o.id=p.org_id WHERE p.org_id=$1 AND ${LOW} ORDER BY p.quantity ASC`, [o])).rows;
  res.json({ ...t, low_stock: low });
}));
app.get('/api/settings', auth, wrap(async (req, res) => {
  res.json((await pool.query('SELECT default_low_stock_threshold FROM organizations WHERE id=$1', [req.session.orgId])).rows[0]);
}));
app.put('/api/settings', auth, wrap(async (req, res) => {
  const v = Number(req.body.default_low_stock_threshold);
  if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: 'Enter a whole number, 0 or more', errors: { default_low_stock_threshold: 'Enter a whole number, 0 or more' } });
  res.json((await pool.query('UPDATE organizations SET default_low_stock_threshold=$2 WHERE id=$1 RETURNING default_low_stock_threshold', [req.session.orgId, v])).rows[0]);
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on our side. Try again.' }); });

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  app.listen(process.env.PORT || 4000, () => console.log('StockFlow API on :' + (process.env.PORT || 4000)));
})().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
