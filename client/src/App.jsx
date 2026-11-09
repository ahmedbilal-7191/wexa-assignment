import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Link, useNavigate, useParams } from 'react-router-dom';
import { api } from './api';

const Ctx = createContext();
const money = v => (v == null || v === '' ? '—' : Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));

function Field({ label, error, ...props }) {
  return (<label className="field"><span>{label}</span>
    {props.rows ? <textarea {...props} /> : <input {...props} />}
    {error && <em className="err">{error}</em>}</label>);
}

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => { api('/auth/me').then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <p className="center">Loading…</p>;
  return (<Ctx.Provider value={{ user, setUser }}><BrowserRouter>
    {user ? <Shell /> : <Routes>
      <Route path="/signup" element={<AuthForm mode="signup" />} />
      <Route path="*" element={<AuthForm mode="login" />} />
    </Routes>}
  </BrowserRouter></Ctx.Provider>);
}

function AuthForm({ mode }) {
  const { setUser } = useContext(Ctx);
  const signup = mode === 'signup';
  const [f, setF] = useState({ email: '', password: '', confirm: '', orgName: '' });
  const [errs, setErrs] = useState({}), [msg, setMsg] = useState('');
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setMsg(''); setErrs({});
    if (signup && f.password !== f.confirm) return setErrs({ confirm: 'Passwords do not match' });
    try { setUser(await api(signup ? '/auth/signup' : '/auth/login', 'POST', f)); }
    catch (x) { setErrs(x.errors); setMsg(x.message); }
  }
  return (<main className="auth"><form onSubmit={submit} className="card">
    <h1>StockFlow</h1><p className="muted">{signup ? 'Create your organization and start tracking stock.' : 'Log in to your inventory.'}</p>
    {signup && <Field label="Organization name" value={f.orgName} onChange={set('orgName')} error={errs.orgName} placeholder="My Test Store" />}
    <Field label="Email" type="email" value={f.email} onChange={set('email')} error={errs.email} />
    <Field label="Password" type="password" value={f.password} onChange={set('password')} error={errs.password} />
    {signup && <Field label="Confirm password" type="password" value={f.confirm} onChange={set('confirm')} error={errs.confirm} />}
    {msg && !Object.keys(errs).length && <p className="err">{msg}</p>}
    <button className="primary">{signup ? 'Create account' : 'Log in'}</button>
    <p className="muted">{signup ? <>Have an account? <Link to="/login">Log in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}</p>
  </form></main>);
}

function Shell() {
  const { user, setUser } = useContext(Ctx);
  const logout = async () => { await api('/auth/logout', 'POST'); setUser(null); };
  return (<>
    <header><strong>StockFlow</strong>
      <nav><NavLink to="/" end>Dashboard</NavLink><NavLink to="/products">Products</NavLink><NavLink to="/settings">Settings</NavLink></nav>
      <span className="muted">{user.orgName} · {user.email}</span><button onClick={logout}>Log out</button></header>
    <main className="page"><Routes>
      <Route path="/" element={<Dashboard />} /><Route path="/products" element={<Products />} />
      <Route path="/products/:id" element={<ProductForm />} /><Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes></main></>);
}

function Dashboard() {
  const [d, setD] = useState(null), [err, setErr] = useState('');
  useEffect(() => { api('/dashboard').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <p className="err">{err}</p>;
  if (!d) return <p>Loading…</p>;
  return (<><h2>Dashboard</h2>
    <div className="stats"><div className="card"><b>{d.total_products}</b><span>Products</span></div>
      <div className="card"><b>{d.total_units}</b><span>Units on hand</span></div>
      <div className={'card' + (d.low_stock.length ? ' warn' : '')}><b>{d.low_stock.length}</b><span>Low stock</span></div></div>
    <h3>Low stock items</h3>
    {d.low_stock.length === 0 ? <p className="muted">Nothing is running low. <Link to="/products/new">Add a product</Link> to start tracking.</p> :
      <table><thead><tr><th>Name</th><th>SKU</th><th>On hand</th><th>Threshold</th></tr></thead><tbody>
        {d.low_stock.map(p => <tr key={p.id}><td><Link to={'/products/' + p.id}>{p.name}</Link></td><td>{p.sku}</td><td>{p.quantity}</td><td>{p.threshold}</td></tr>)}
      </tbody></table>}</>);
}

function Products() {
  const [rows, setRows] = useState(null), [q, setQ] = useState(''), [err, setErr] = useState(''), [adj, setAdj] = useState({});
  const load = () => api('/products?q=' + encodeURIComponent(q)).then(setRows).catch(e => setErr(e.message));
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q]);
  async function adjust(p) {
    try { await api(`/products/${p.id}/adjust`, 'POST', { delta: adj[p.id] }); setAdj({ ...adj, [p.id]: '' }); setErr(''); load(); }
    catch (e) { setErr(e.message); }
  }
  async function del(p) {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try { await api('/products/' + p.id, 'DELETE'); load(); } catch (e) { setErr(e.message); }
  }
  return (<><div className="bar"><h2>Products</h2><input placeholder="Search name or SKU" value={q} onChange={e => setQ(e.target.value)} />
    <Link className="btn primary" to="/products/new">Add product</Link></div>
    {err && <p className="err">{err}</p>}
    {!rows ? <p>Loading…</p> : rows.length === 0 ? <p className="muted">{q ? 'No products match your search.' : 'No products yet. Add your first one.'}</p> :
      <table><thead><tr><th>Name</th><th>SKU</th><th>Qty</th><th>Stock</th><th>Price</th><th>Adjust (+/-)</th><th></th></tr></thead><tbody>
        {rows.map(p => <tr key={p.id}><td><Link to={'/products/' + p.id}>{p.name}</Link></td><td>{p.sku}</td><td>{p.quantity}</td>
          <td>{p.low_stock ? <span className="badge">Low</span> : <span className="muted">OK</span>}</td><td>{money(p.selling_price)}</td>
          <td className="adj"><input type="number" placeholder="±N" value={adj[p.id] || ''} onChange={e => setAdj({ ...adj, [p.id]: e.target.value })} />
            <button disabled={!adj[p.id]} onClick={() => adjust(p)}>Apply</button></td>
          <td><button className="link danger" onClick={() => del(p)}>Delete</button></td></tr>)}
      </tbody></table>}</>);
}

function ProductForm() {
  const { id } = useParams(), nav = useNavigate(), isNew = id === 'new';
  const [f, setF] = useState({ name: '', sku: '', description: '', quantity: '0', cost_price: '', selling_price: '', low_stock_threshold: '' });
  const [errs, setErrs] = useState({}), [msg, setMsg] = useState(''), [ready, setReady] = useState(isNew);
  useEffect(() => {
    if (!isNew) api('/products/' + id).then(p => {
      setF(Object.fromEntries(Object.keys(f).map(k => [k, p[k] ?? '']))); setReady(true);
    }).catch(e => setMsg(e.message));
  }, [id]);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setMsg(''); setErrs({});
    try { await api(isNew ? '/products' : '/products/' + id, isNew ? 'POST' : 'PUT', f); nav('/products'); }
    catch (x) { setErrs(x.errors); setMsg(x.message); }
  }
  if (!ready) return <p className={msg ? 'err' : ''}>{msg || 'Loading…'}</p>;
  return (<form onSubmit={submit} className="card form"><h2>{isNew ? 'Add product' : 'Edit product'}</h2>
    <Field label="Name" value={f.name} onChange={set('name')} error={errs.name} />
    <Field label="SKU" value={f.sku} onChange={set('sku')} error={errs.sku} />
    <Field label="Description" rows="3" value={f.description} onChange={set('description')} />
    <div className="grid">
      <Field label="Quantity on hand" type="number" min="0" value={f.quantity} onChange={set('quantity')} error={errs.quantity} />
      <Field label="Low stock threshold" type="number" min="0" placeholder="Use default" value={f.low_stock_threshold} onChange={set('low_stock_threshold')} error={errs.low_stock_threshold} />
      <Field label="Cost price" type="number" step="0.01" min="0" value={f.cost_price} onChange={set('cost_price')} error={errs.cost_price} />
      <Field label="Selling price" type="number" step="0.01" min="0" value={f.selling_price} onChange={set('selling_price')} error={errs.selling_price} /></div>
    {msg && <p className="err">{msg}</p>}
    <div className="row"><button className="primary">{isNew ? 'Create product' : 'Save changes'}</button><Link className="btn" to="/products">Cancel</Link></div></form>);
}

function Settings() {
  const [v, setV] = useState(''), [msg, setMsg] = useState(''), [ok, setOk] = useState(false);
  useEffect(() => { api('/settings').then(s => setV(String(s.default_low_stock_threshold))).catch(e => setMsg(e.message)); }, []);
  async function save(e) {
    e.preventDefault(); setMsg(''); setOk(false);
    try { await api('/settings', 'PUT', { default_low_stock_threshold: v }); setOk(true); } catch (x) { setMsg(x.message); }
  }
  return (<form onSubmit={save} className="card form"><h2>Settings</h2>
    <Field label="Default low stock threshold" type="number" min="0" value={v} onChange={e => setV(e.target.value)} />
    <p className="muted">Used for products that don't set their own threshold.</p>
    {msg && <p className="err">{msg}</p>}{ok && <p className="okmsg">Settings saved</p>}
    <button className="primary">Save settings</button></form>);
}
