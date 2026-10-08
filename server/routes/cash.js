const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, DATA_DIR } = require('../db');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');
const erp = require('../erp');
const nativeQuotes = require('../nativeQuotes');

// Finanzas del negocio. Todo lo que entra y sale de plata:
//   - cash_entries: gastos y otros ingresos (con cuenta, categoría, foto del
//     recibo y, si aplica, el trabajo u operario al que corresponde).
//   - payments: abonos de clientes (se registran en la venta; aquí se suman).
//   - account_transfers: plata que pasa de una cuenta a otra.
// Sobre eso: saldo de cada cuenta, gastos fijos del mes, por cobrar,
// estado de resultados mensual y ganancia por trabajo (work_orders).
const router = express.Router();
router.use(requireRole('admin', 'coordinador'));

// "Aporte de socios" y "Retiro del dueño" mueven plata pero no son ventas ni
// gastos del negocio: cambian el saldo de las cuentas, no la ganancia.
const NON_OPERATING = ['Aporte de socios', 'Retiro del dueño'];
const CATEGORIES = {
  egreso: [...erp.EXPENSE_CATEGORIES, 'Retiro del dueño'],
  ingreso: ['Otros ingresos', 'Aporte de socios'],
};
const METHODS = ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'otro'];
const ACCOUNT_KINDS = ['efectivo', 'digital', 'banco'];
const LABOR_CATEGORY = 'Nómina y pagos a operarios';
const DELIVERED_PAYMENT_CATEGORY = 'Abono de cliente';

const UPLOAD_ROOT = path.join(DATA_DIR, 'uploads');
const MAX_RECEIPT_MB = 10;
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(UPLOAD_ROOT, 'recibos', erp.todayBogota().slice(0, 7));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
      cb(null, `recibo-${Number(req.params.id) || 0}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_RECEIPT_MB * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, /^image\/|^application\/pdf$/.test(file.mimetype || ''));
  },
});

function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}
function isoMonth(value) {
  return /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : erp.todayBogota().slice(0, 7);
}
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// Rango por defecto: el mes en curso (fechas locales de Colombia).
function range(query) {
  const today = erp.todayBogota();
  return { from: isoDate(query.from) || `${today.slice(0, 8)}01`, to: isoDate(query.to) || today };
}
function text(v) {
  const t = v == null ? '' : String(v).trim();
  return t || null;
}
const round = (n) => Math.round(Number(n) || 0);
function fail(res, err) {
  return res.status(err.status || 500).json({ error: err.message || 'Error' });
}

// ---- cuentas ---------------------------------------------------------------------------

async function accountsWithBalance() {
  const accounts = await db.prepare('SELECT * FROM accounts ORDER BY position, id').all();
  const sumBy = async (sql) => new Map((await db.prepare(sql).all()).map((r) => [r.account_id, Number(r.total) || 0]));
  const incomes = await sumBy("SELECT account_id, SUM(amount) AS total FROM cash_entries WHERE kind = 'ingreso' GROUP BY account_id");
  const expenses = await sumBy("SELECT account_id, SUM(amount) AS total FROM cash_entries WHERE kind = 'egreso' GROUP BY account_id");
  const payments = await sumBy('SELECT account_id, SUM(amount) AS total FROM payments GROUP BY account_id');
  const tin = await sumBy('SELECT to_account_id AS account_id, SUM(amount) AS total FROM account_transfers GROUP BY to_account_id');
  const tout = await sumBy('SELECT from_account_id AS account_id, SUM(amount) AS total FROM account_transfers GROUP BY from_account_id');
  return accounts.map((a) => {
    const g = (m) => m.get(a.id) || 0;
    return { ...a, balance: round(Number(a.opening_balance) + g(incomes) + g(payments) + g(tin) - g(expenses) - g(tout)) };
  });
}

router.get('/meta', async (req, res) => {
  const accounts = await accountsWithBalance();
  const workers = await db.prepare('SELECT id, name FROM workers WHERE active = 1 ORDER BY name').all();
  const jobs = await db
    .prepare("SELECT id, number, client_name, stage FROM work_orders WHERE stage != 'cancelada' ORDER BY id DESC LIMIT 200")
    .all();
  res.json({ categories: CATEGORIES, non_operating: NON_OPERATING, methods: METHODS, account_kinds: ACCOUNT_KINDS, accounts, workers, jobs });
});

router.get('/accounts', async (req, res) => {
  res.json(await accountsWithBalance());
});

router.post('/accounts', requireRole('admin'), async (req, res) => {
  const name = text(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Ponle un nombre a la cuenta' });
  const kind = ACCOUNT_KINDS.includes(req.body?.kind) ? req.body.kind : 'efectivo';
  const pos = await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM accounts').get();
  const info = await db
    .prepare('INSERT INTO accounts (name, kind, opening_balance, position) VALUES (?, ?, ?, ?)')
    .run(name, kind, round(req.body?.opening_balance), pos.p);
  broadcast('cash_changed', { reason: 'account' });
  res.status(201).json(await db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/accounts/:id', requireRole('admin'), async (req, res) => {
  const acc = await db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(req.params.id));
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada' });
  const b = req.body || {};
  const name = b.name !== undefined ? text(b.name) : acc.name;
  if (!name) return res.status(400).json({ error: 'Ponle un nombre a la cuenta' });
  await db
    .prepare('UPDATE accounts SET name = ?, kind = ?, opening_balance = ?, active = ? WHERE id = ?')
    .run(
      name,
      ACCOUNT_KINDS.includes(b.kind) ? b.kind : acc.kind,
      b.opening_balance !== undefined ? round(b.opening_balance) : acc.opening_balance,
      b.active !== undefined ? (b.active ? 1 : 0) : acc.active,
      acc.id
    );
  broadcast('cash_changed', { reason: 'account' });
  res.json(await db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id));
});

// ---- traslados entre cuentas -----------------------------------------------------------

router.post('/transfers', async (req, res) => {
  const b = req.body || {};
  const from = await db.prepare('SELECT id FROM accounts WHERE id = ?').get(Number(b.from_account_id));
  const to = await db.prepare('SELECT id FROM accounts WHERE id = ?').get(Number(b.to_account_id));
  if (!from || !to) return res.status(400).json({ error: 'Elige la cuenta de origen y la de destino' });
  if (from.id === to.id) return res.status(400).json({ error: 'Las cuentas deben ser distintas' });
  if (!(Number(b.amount) > 0)) return res.status(400).json({ error: 'El valor debe ser mayor que cero' });
  const info = await db
    .prepare('INSERT INTO account_transfers (from_account_id, to_account_id, amount, transfer_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(from.id, to.id, round(b.amount), isoDate(b.date) || erp.todayBogota(), text(b.note), req.user.id || null);
  broadcast('cash_changed', { reason: 'transfer' });
  res.status(201).json(await db.prepare('SELECT * FROM account_transfers WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/transfers/:id', requireRole('admin'), async (req, res) => {
  const t = await db.prepare('SELECT id FROM account_transfers WHERE id = ?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Traslado no encontrado' });
  await db.prepare('DELETE FROM account_transfers WHERE id = ?').run(t.id);
  broadcast('cash_changed', { reason: 'transfer_deleted' });
  res.json({ ok: true });
});

// ---- movimientos ------------------------------------------------------------------------

// Todos los movimientos de un rango (abonos, gastos/ingresos y traslados),
// del más reciente al más viejo. `paid_at` de los abonos está en UTC: se
// pasa a fecha de Colombia antes de comparar.
async function movements(from, to) {
  const accounts = new Map((await db.prepare('SELECT id, name FROM accounts').all()).map((a) => [a.id, a.name]));
  const payments = await db
    .prepare(
      `SELECT p.*, date(p.paid_at, '-5 hours') AS entry_date, l.client_name, wo.number AS work_order_number
         FROM payments p JOIN leads l ON l.id = p.lead_id
         LEFT JOIN work_orders wo ON wo.id = p.work_order_id
        WHERE date(p.paid_at, '-5 hours') BETWEEN ? AND ?`
    )
    .all(from, to);
  const entries = await db
    .prepare(
      `SELECT ce.*, po.number AS purchase_number, wo.number AS work_order_number, wo.client_name AS work_order_client,
              w.name AS worker_name, re.name AS recurring_name, inv.number AS invoice_number
         FROM cash_entries ce
         LEFT JOIN purchase_orders po ON po.id = ce.purchase_order_id
         LEFT JOIN work_orders wo ON wo.id = ce.work_order_id
         LEFT JOIN workers w ON w.id = ce.worker_id
         LEFT JOIN recurring_expenses re ON re.id = ce.recurring_id
         LEFT JOIN invoices inv ON inv.id = ce.invoice_id
        WHERE ce.entry_date BETWEEN ? AND ?`
    )
    .all(from, to);
  const transfers = await db.prepare('SELECT * FROM account_transfers WHERE transfer_date BETWEEN ? AND ?').all(from, to);

  const rows = [
    ...payments.map((p) => ({
      source: 'abono',
      id: p.id,
      kind: 'ingreso',
      category: DELIVERED_PAYMENT_CATEGORY,
      amount: round(p.amount),
      account_id: p.account_id,
      account_name: accounts.get(p.account_id) || null,
      description: p.client_name + (p.notes ? ` · ${p.notes}` : ''),
      entry_date: p.entry_date,
      created_at: p.created_at,
      lead_id: p.lead_id,
      work_order_id: p.work_order_id,
      work_order_number: p.work_order_number,
    })),
    ...entries.map((e) => ({
      source: 'caja',
      id: e.id,
      kind: e.kind,
      category: e.category,
      amount: round(e.amount),
      account_id: e.account_id,
      account_name: accounts.get(e.account_id) || null,
      description: e.description,
      entry_date: e.entry_date,
      created_at: e.created_at,
      work_order_id: e.work_order_id,
      work_order_number: e.work_order_number,
      work_order_client: e.work_order_client,
      worker_id: e.worker_id,
      worker_name: e.worker_name,
      recurring_id: e.recurring_id,
      recurring_name: e.recurring_name,
      purchase_order_id: e.purchase_order_id,
      purchase_number: e.purchase_number,
      invoice_id: e.invoice_id,
      invoice_number: e.invoice_number,
      has_receipt: !!e.receipt_path,
      non_operating: NON_OPERATING.includes(e.category),
    })),
    ...transfers.map((t) => ({
      source: 'traslado',
      id: t.id,
      kind: 'traslado',
      category: 'Traslado entre cuentas',
      amount: round(t.amount),
      account_id: t.from_account_id,
      account_name: accounts.get(t.from_account_id) || null,
      to_account_id: t.to_account_id,
      to_account_name: accounts.get(t.to_account_id) || null,
      description: t.note,
      entry_date: t.transfer_date,
      created_at: t.created_at,
    })),
  ];
  return rows.sort((a, b) =>
    a.entry_date === b.entry_date ? String(b.created_at).localeCompare(String(a.created_at)) : b.entry_date.localeCompare(a.entry_date)
  );
}

// Totales "del negocio": ingresos y gastos operativos (sin aportes/retiros
// del dueño ni traslados), más lo no operativo aparte.
function totalsOf(rows) {
  const t = { ingresos: 0, gastos: 0, aportes: 0, retiros: 0 };
  for (const r of rows) {
    if (r.kind === 'traslado') continue;
    if (r.category === 'Aporte de socios') t.aportes += r.amount;
    else if (r.category === 'Retiro del dueño') t.retiros += r.amount;
    else if (r.kind === 'ingreso') t.ingresos += r.amount;
    else t.gastos += r.amount;
  }
  return { ...t, ganancia: t.ingresos - t.gastos };
}

function groupBy(list, key) {
  return Object.entries(list.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] || 0) + r.amount), acc), {}))
    .map(([name, total]) => ({ name, total: round(total) }))
    .sort((a, b) => b.total - a.total);
}

// GET /api/cash/entries?from=&to=&account=&kind=&category=&q=
router.get('/entries', async (req, res) => {
  const { from, to } = range(req.query);
  let rows = await movements(from, to);
  const accountId = Number(req.query.account) || null;
  if (accountId) rows = rows.filter((r) => r.account_id === accountId || r.to_account_id === accountId);
  if (['ingreso', 'egreso', 'traslado'].includes(req.query.kind)) rows = rows.filter((r) => r.kind === req.query.kind);
  if (req.query.category) rows = rows.filter((r) => r.category === req.query.category);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.description, r.category, r.account_name, r.worker_name, r.work_order_number, r.work_order_client, r.purchase_number, String(r.amount)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }
  const operating = rows.filter((r) => r.kind !== 'traslado' && !NON_OPERATING.includes(r.category));
  res.json({
    from,
    to,
    rows,
    totals: totalsOf(rows),
    gastos_por_categoria: groupBy(operating.filter((r) => r.kind === 'egreso'), 'category'),
  });
});

function entryPayload(b) {
  return {
    kind: b.kind,
    category: b.category,
    amount: round(b.amount),
    description: text(b.description),
    entry_date: isoDate(b.entry_date) || erp.todayBogota(),
  };
}

async function validateEntry(b, existing) {
  const kind = b.kind || existing?.kind;
  if (!CATEGORIES[kind]) throw Object.assign(new Error('Indica si es ingreso o gasto'), { status: 400 });
  const category = b.category || existing?.category;
  if (!CATEGORIES[kind].includes(category)) throw Object.assign(new Error('Categoría inválida'), { status: 400 });
  const amount = b.amount !== undefined ? Number(b.amount) : existing?.amount;
  if (!(amount > 0)) throw Object.assign(new Error('El valor debe ser mayor que cero'), { status: 400 });
  const method = METHODS.includes(b.method) ? b.method : existing?.method || null;
  const acc = await erp.resolveAccount(b.account_id || (b.account_id === undefined ? existing?.account_id : null), method);
  const ref = async (table, id, label) => {
    if (!id) return null;
    const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(Number(id));
    if (!row) throw Object.assign(new Error(`${label} no encontrado`), { status: 400 });
    return row.id;
  };
  return {
    kind,
    category,
    amount: round(amount),
    account_id: acc.account_id,
    method: acc.method,
    work_order_id: await ref('work_orders', b.work_order_id !== undefined ? b.work_order_id : existing?.work_order_id, 'Trabajo'),
    worker_id: await ref('workers', b.worker_id !== undefined ? b.worker_id : existing?.worker_id, 'Operario'),
    purchase_order_id: await ref('purchase_orders', b.purchase_order_id !== undefined ? b.purchase_order_id : existing?.purchase_order_id, 'Orden de compra'),
  };
}

router.post('/entries', async (req, res) => {
  try {
    const b = req.body || {};
    const v = await validateEntry(b);
    const p = entryPayload({ ...b, ...v });
    const info = await db
      .prepare(
        `INSERT INTO cash_entries (kind, category, amount, method, description, entry_date, account_id, work_order_id, worker_id, purchase_order_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(v.kind, v.category, v.amount, v.method, p.description, p.entry_date, v.account_id, v.work_order_id, v.worker_id, v.purchase_order_id, req.user.id || null);
    broadcast('cash_changed', { reason: 'created' });
    if (v.purchase_order_id) broadcast('purchases_changed', { reason: 'paid', id: v.purchase_order_id });
    res.status(201).json(await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/entries/:id', async (req, res) => {
  const e = await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Movimiento no encontrado' });
  try {
    const b = req.body || {};
    const v = await validateEntry(b, e);
    await db
      .prepare(
        `UPDATE cash_entries SET kind = ?, category = ?, amount = ?, method = ?, description = ?, entry_date = ?,
                account_id = ?, work_order_id = ?, worker_id = ? WHERE id = ?`
      )
      .run(
        v.kind,
        v.category,
        v.amount,
        v.method,
        b.description !== undefined ? text(b.description) : e.description,
        isoDate(b.entry_date) || e.entry_date,
        v.account_id,
        v.work_order_id,
        v.worker_id,
        e.id
      );
    broadcast('cash_changed', { reason: 'updated' });
    res.json(await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(e.id));
  } catch (err) {
    fail(res, err);
  }
});

// Borrar un movimiento mal registrado (solo admin). Los abonos de clientes
// se corrigen donde se registraron (en la venta), no aquí.
router.delete('/entries/:id', requireRole('admin'), async (req, res) => {
  const e = await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Movimiento no encontrado' });
  await db.prepare('DELETE FROM cash_entries WHERE id = ?').run(e.id);
  removeReceiptFile(e.receipt_path);
  broadcast('cash_changed', { reason: 'deleted' });
  if (e.purchase_order_id) broadcast('purchases_changed', { reason: 'paid', id: e.purchase_order_id });
  res.json({ ok: true });
});

// ---- foto del recibo ---------------------------------------------------------------------

function removeReceiptFile(rel) {
  if (!rel) return;
  const abs = path.resolve(UPLOAD_ROOT, rel);
  if (abs.startsWith(path.resolve(UPLOAD_ROOT)) && fs.existsSync(abs)) fs.unlink(abs, () => {});
}

router.post(
  '/entries/:id/receipt',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `La foto supera ${MAX_RECEIPT_MB} MB` : err.message });
      next();
    }),
  async (req, res) => {
    const e = await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(Number(req.params.id));
    if (!e) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Movimiento no encontrado' });
    }
    if (!req.file) return res.status(400).json({ error: 'Adjunta una foto o PDF del recibo' });
    await db
      .prepare('UPDATE cash_entries SET receipt_path = ?, receipt_mime = ? WHERE id = ?')
      .run(path.relative(UPLOAD_ROOT, req.file.path), req.file.mimetype, e.id);
    removeReceiptFile(e.receipt_path);
    broadcast('cash_changed', { reason: 'receipt' });
    res.json({ ok: true });
  }
);

router.get('/entries/:id/receipt', async (req, res) => {
  const e = await db.prepare('SELECT receipt_path, receipt_mime FROM cash_entries WHERE id = ?').get(Number(req.params.id));
  if (!e || !e.receipt_path) return res.status(404).json({ error: 'Este movimiento no tiene recibo' });
  const abs = path.resolve(UPLOAD_ROOT, e.receipt_path);
  if (!abs.startsWith(path.resolve(UPLOAD_ROOT)) || !fs.existsSync(abs)) return res.status(404).json({ error: 'El recibo ya no está en el disco' });
  res.setHeader('Content-Type', e.receipt_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  fs.createReadStream(abs).pipe(res);
});

router.delete('/entries/:id/receipt', async (req, res) => {
  const e = await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Movimiento no encontrado' });
  await db.prepare('UPDATE cash_entries SET receipt_path = NULL, receipt_mime = NULL WHERE id = ?').run(e.id);
  removeReceiptFile(e.receipt_path);
  broadcast('cash_changed', { reason: 'receipt' });
  res.json({ ok: true });
});

// ---- gastos fijos ---------------------------------------------------------------------------

async function recurringForMonth(month) {
  const { from, to } = monthBounds(month);
  const list = await db.prepare('SELECT * FROM recurring_expenses WHERE active = 1 ORDER BY day_of_month, name').all();
  const paid = await db
    .prepare('SELECT id, recurring_id, amount, entry_date FROM cash_entries WHERE recurring_id IS NOT NULL AND entry_date BETWEEN ? AND ?')
    .all(from, to);
  const today = erp.todayBogota();
  return list.map((r) => {
    const p = paid.filter((x) => x.recurring_id === r.id);
    const day = Math.min(r.day_of_month, Number(to.slice(8)));
    const due = `${month}-${String(day).padStart(2, '0')}`;
    return {
      ...r,
      due_date: due,
      paid: p.length > 0,
      paid_amount: round(p.reduce((s, x) => s + x.amount, 0)),
      paid_date: p.length ? p[p.length - 1].entry_date : null,
      overdue: !p.length && due < today,
    };
  });
}

router.get('/recurring', async (req, res) => {
  const month = isoMonth(req.query.month);
  const rows = await recurringForMonth(month);
  res.json({
    month,
    rows,
    total: round(rows.reduce((s, r) => s + r.amount, 0)),
    pending: round(rows.filter((r) => !r.paid).reduce((s, r) => s + r.amount, 0)),
  });
});

function recurringPayload(b, existing = {}) {
  const name = b.name !== undefined ? text(b.name) : existing.name;
  if (!name) throw Object.assign(new Error('Ponle un nombre al gasto fijo'), { status: 400 });
  const category = b.category !== undefined ? b.category : existing.category;
  if (!erp.EXPENSE_CATEGORIES.includes(category)) throw Object.assign(new Error('Categoría inválida'), { status: 400 });
  const day = b.day_of_month !== undefined ? Math.min(31, Math.max(1, Number(b.day_of_month) || 1)) : existing.day_of_month;
  return {
    name,
    category,
    amount: b.amount !== undefined ? round(b.amount) : existing.amount,
    day_of_month: day,
    account_id: b.account_id !== undefined ? Number(b.account_id) || null : existing.account_id || null,
  };
}

router.post('/recurring', async (req, res) => {
  try {
    const p = recurringPayload(req.body || {});
    const info = await db
      .prepare('INSERT INTO recurring_expenses (name, category, amount, day_of_month, account_id) VALUES (?, ?, ?, ?, ?)')
      .run(p.name, p.category, p.amount, p.day_of_month, p.account_id);
    broadcast('cash_changed', { reason: 'recurring' });
    res.status(201).json(await db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/recurring/:id', async (req, res) => {
  const r = await db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Gasto fijo no encontrado' });
  try {
    const p = recurringPayload(req.body || {}, r);
    await db
      .prepare('UPDATE recurring_expenses SET name = ?, category = ?, amount = ?, day_of_month = ?, account_id = ? WHERE id = ?')
      .run(p.name, p.category, p.amount, p.day_of_month, p.account_id, r.id);
    broadcast('cash_changed', { reason: 'recurring' });
    res.json(await db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(r.id));
  } catch (err) {
    fail(res, err);
  }
});

// Quitar un gasto fijo: deja de aparecer en los meses siguientes; los pagos
// ya registrados se conservan.
router.delete('/recurring/:id', async (req, res) => {
  const r = await db.prepare('SELECT id FROM recurring_expenses WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Gasto fijo no encontrado' });
  await db.prepare('UPDATE recurring_expenses SET active = 0 WHERE id = ?').run(r.id);
  broadcast('cash_changed', { reason: 'recurring' });
  res.json({ ok: true });
});

// Pagar el gasto fijo de este mes: crea el egreso ligado.
router.post('/recurring/:id/pay', async (req, res) => {
  const r = await db.prepare('SELECT * FROM recurring_expenses WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Gasto fijo no encontrado' });
  try {
    const b = req.body || {};
    const amount = Number(b.amount !== undefined ? b.amount : r.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'El valor debe ser mayor que cero' });
    const acc = await erp.resolveAccount(b.account_id || r.account_id, null);
    const info = await db
      .prepare(
        `INSERT INTO cash_entries (kind, category, amount, method, description, entry_date, account_id, recurring_id, created_by)
         VALUES ('egreso', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(r.category, round(amount), acc.method, text(b.description) || r.name, isoDate(b.date) || erp.todayBogota(), acc.account_id, r.id, req.user.id || null);
    broadcast('cash_changed', { reason: 'recurring_paid' });
    res.status(201).json(await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    fail(res, err);
  }
});

// ---- por cobrar ------------------------------------------------------------------------------

// Ventas ganadas con saldo pendiente. Un trabajo ya entregado y sin pagar es
// lo más urgente de cobrar (primero en la lista).
async function receivables() {
  const rows = await db
    .prepare(
      `SELECT l.id AS lead_id, l.client_name, l.phone, l.amount, l.closed_at,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.lead_id = l.id), 0) AS paid,
              (SELECT wo.id FROM work_orders wo WHERE wo.lead_id = l.id AND wo.stage != 'cancelada' ORDER BY wo.id DESC LIMIT 1) AS work_order_id
         FROM leads l
        WHERE l.status = 'cerrado_ganado' AND COALESCE(l.amount, 0) > 0`
    )
    .all();
  const orders = new Map((await db.prepare("SELECT id, number, stage, delivered_at FROM work_orders WHERE stage != 'cancelada'").all()).map((o) => [o.id, o]));
  const list = rows
    .map((r) => {
      const wo = r.work_order_id ? orders.get(r.work_order_id) : null;
      return {
        ...r,
        balance: round(r.amount - r.paid),
        work_order_number: wo ? wo.number : null,
        work_order_stage: wo ? wo.stage : null,
        delivered: wo ? wo.stage === 'entregado' : false,
        delivered_at: wo ? wo.delivered_at : null,
      };
    })
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.delivered - a.delivered || String(a.closed_at).localeCompare(String(b.closed_at)));
  return { rows: list, total: list.reduce((s, r) => s + r.balance, 0) };
}

router.get('/receivables', async (req, res) => {
  res.json(await receivables());
});

// ---- resumen del mes / estado de resultados -----------------------------------------------

// GET /api/cash/summary?month=AAAA-MM
router.get('/summary', async (req, res) => {
  const month = isoMonth(req.query.month);
  const cur = monthBounds(month);
  const rows = await movements(cur.from, cur.to);
  const prevMonth = shiftMonth(month, -1);
  const prev = monthBounds(prevMonth);
  const prevRows = await movements(prev.from, prev.to);

  // Últimos 6 meses (incluido este) para la gráfica.
  const series = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    const b = monthBounds(m);
    const t = totalsOf(await movements(b.from, b.to));
    series.push({ month: m, ingresos: round(t.ingresos), gastos: round(t.gastos), ganancia: round(t.ganancia) });
  }

  const operating = rows.filter((r) => r.kind !== 'traslado' && !NON_OPERATING.includes(r.category));
  const fixed = await recurringForMonth(month);
  const rec = await receivables();
  res.json({
    month,
    totals: totalsOf(rows),
    prev_totals: totalsOf(prevRows),
    series,
    ingresos_por_categoria: groupBy(operating.filter((r) => r.kind === 'ingreso'), 'category'),
    gastos_por_categoria: groupBy(operating.filter((r) => r.kind === 'egreso'), 'category'),
    accounts: await accountsWithBalance(),
    fixed: {
      rows: fixed,
      total: round(fixed.reduce((s, r) => s + r.amount, 0)),
      pending: round(fixed.filter((r) => !r.paid).reduce((s, r) => s + r.amount, 0)),
      overdue: fixed.filter((r) => r.overdue).length,
    },
    receivables: { total: rec.total, count: rec.rows.length, delivered: rec.rows.filter((r) => r.delivered).length },
    without_receipt: rows.filter((r) => r.source === 'caja' && r.kind === 'egreso' && !r.has_receipt).length,
  });
});

// ---- ganancia por trabajo -----------------------------------------------------------------

// GET /api/cash/profitability?from=&to=&scope=entregados|todos
// Por cada trabajo: lo cobrado sin IVA menos el material que consumió, el
// pago a operarios ligado y los demás gastos ligados a ese trabajo.
router.get('/profitability', async (req, res) => {
  const { from, to } = range(req.query);
  const all = req.query.scope === 'todos';
  const orders = await db
    .prepare(
      `SELECT wo.*, wo.labor_cost AS agreed_labor, w.name AS worker_name,
              COALESCE((SELECT -SUM(sm.qty * sm.unit_cost) FROM stock_movements sm WHERE sm.work_order_id = wo.id AND sm.type IN ('consumo', 'devolucion')), 0) AS materials_cost,
              COALESCE((SELECT SUM(ce.amount) FROM cash_entries ce WHERE ce.work_order_id = wo.id AND ce.kind = 'egreso' AND ce.category = ?), 0) AS labor_cost,
              COALESCE((SELECT SUM(ce.amount) FROM cash_entries ce WHERE ce.work_order_id = wo.id AND ce.kind = 'egreso' AND ce.category != ?), 0) AS other_cost
         FROM work_orders wo
         LEFT JOIN workers w ON w.id = wo.worker_id
        WHERE ${all ? "wo.stage != 'cancelada'" : "wo.stage = 'entregado' AND date(wo.delivered_at, '-5 hours') BETWEEN ? AND ?"}
        ORDER BY COALESCE(wo.delivered_at, wo.created_at) DESC`
    )
    .all(...(all ? [LABOR_CATEGORY, LABOR_CATEGORY] : [LABOR_CATEGORY, LABOR_CATEGORY, from, to]));
  const iva = await nativeQuotes.ivaRate();
  const rows = orders.map((o) => {
    const revenue = round((Number(o.amount_total) || 0) / (1 + iva));
    const materials = round(o.materials_cost);
    // El pago acordado al operario cuenta aunque todavía no se le haya pagado.
    const labor = Math.max(round(o.labor_cost), round(o.agreed_labor));
    const other = round(o.other_cost);
    const cost = materials + labor + other;
    return {
      id: o.id,
      number: o.number,
      client_name: o.client_name,
      service_slug: o.service_slug,
      stage: o.stage,
      worker_name: o.worker_name,
      delivered_at: o.delivered_at,
      revenue,
      materials_cost: materials,
      labor_cost: labor,
      other_cost: other,
      margin: revenue - cost,
      margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null,
    };
  });
  const bySvc = {};
  for (const r of rows) {
    const k = r.service_slug || 'otro';
    bySvc[k] = bySvc[k] || { service_slug: k, jobs: 0, revenue: 0, cost: 0, margin: 0 };
    bySvc[k].jobs++;
    bySvc[k].revenue += r.revenue;
    bySvc[k].cost += r.materials_cost + r.labor_cost + r.other_cost;
    bySvc[k].margin += r.margin;
  }
  const totals = rows.reduce(
    (t, r) => ({
      revenue: t.revenue + r.revenue,
      materials_cost: t.materials_cost + r.materials_cost,
      labor_cost: t.labor_cost + r.labor_cost,
      other_cost: t.other_cost + r.other_cost,
      margin: t.margin + r.margin,
    }),
    { revenue: 0, materials_cost: 0, labor_cost: 0, other_cost: 0, margin: 0 }
  );
  res.json({ from, to, scope: all ? 'todos' : 'entregados', rows, by_service: Object.values(bySvc).sort((a, b) => b.margin - a.margin), totals });
});

// ---- pagos a operarios ------------------------------------------------------------------

// GET /api/cash/workers?from=&to= -- cuánto se le pagó a cada operario en el
// periodo y en cuántos trabajos participó (los entregados con ese operario).
router.get('/workers', async (req, res) => {
  const { from, to } = range(req.query);
  const workers = await db.prepare('SELECT id, name, active FROM workers ORDER BY active DESC, name').all();
  const paid = await db
    .prepare("SELECT worker_id, SUM(amount) AS total, COUNT(*) AS n FROM cash_entries WHERE kind = 'egreso' AND worker_id IS NOT NULL AND entry_date BETWEEN ? AND ? GROUP BY worker_id")
    .all(from, to);
  const jobs = await db
    .prepare("SELECT worker_id, COUNT(*) AS n FROM work_orders WHERE worker_id IS NOT NULL AND stage = 'entregado' AND date(delivered_at, '-5 hours') BETWEEN ? AND ? GROUP BY worker_id")
    .all(from, to);
  const pm = new Map(paid.map((p) => [p.worker_id, p]));
  const jm = new Map(jobs.map((j) => [j.worker_id, j.n]));
  res.json({
    from,
    to,
    rows: workers
      .map((w) => ({ ...w, paid: round(pm.get(w.id)?.total), payments: pm.get(w.id)?.n || 0, jobs_delivered: jm.get(w.id) || 0 }))
      .filter((w) => w.active || w.paid > 0),
  });
});

module.exports = router;
