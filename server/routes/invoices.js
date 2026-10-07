const express = require('express');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { db, getSetting, setSetting } = require('../db');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');
const erp = require('../erp');
const einvoice = require('../einvoice');
const brand = require('../pdfBrand');
const { quoteSettings } = require('./quotations');

// Facturación electrónica (ERP): lo que Velara factura a sus clientes
// (emitidas = ventas) y lo que le facturan sus proveedores (recibidas =
// compras y gastos). Ver server/einvoice.js para el proveedor tecnológico
// (hoy simulado).
const router = express.Router();
router.use(requireRole('admin', 'coordinador'));

function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function range(query) {
  const today = erp.todayBogota();
  return { from: isoDate(query.from) || `${today.slice(0, 8)}01`, to: isoDate(query.to) || today };
}

function addDays(isoDay, days) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

async function readInvoice(id) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(id));
  if (!inv) return null;
  inv.lines = await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position, id').all(inv.id);
  if (inv.related_invoice_id) {
    const rel = await db.prepare('SELECT id, number FROM invoices WHERE id = ?').get(inv.related_invoice_id);
    inv.related_number = rel ? rel.number : null;
  }
  const credit = await db.prepare("SELECT id, number FROM invoices WHERE related_invoice_id = ? AND doc_type = 'nota_credito'").get(inv.id);
  inv.credit_note = credit || null;
  return inv;
}

async function insertInvoice(inv, lines) {
  const r = await db
    .prepare(
      `INSERT INTO invoices (direction, doc_type, number, cufe, issue_date, due_date, party_name, party_nit, party_email, party_address,
                             lead_id, supplier_id, related_invoice_id, subtotal, iva, total, status, payment_status, category, category_source, notes, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      inv.direction, inv.doc_type || 'factura', inv.number, inv.cufe || null, inv.issue_date, inv.due_date || null,
      inv.party_name, inv.party_nit || null, inv.party_email || null, inv.party_address || null,
      inv.lead_id || null, inv.supplier_id || null, inv.related_invoice_id || null,
      inv.subtotal, inv.iva, inv.total, inv.status || 'aceptada', inv.payment_status || 'pendiente',
      inv.category || null, inv.category_source || null, inv.notes || null, inv.source || 'simulado', inv.created_by || null
    );
  const id = Number(r.lastInsertRowid);
  const ins = db.prepare('INSERT INTO invoice_lines (invoice_id, description, qty, unit_price, iva_rate, subtotal, iva, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const l of lines) await ins.run(id, l.description, l.qty, l.unit_price, l.iva_rate, l.subtotal, l.iva, l.position);
  return id;
}

router.get('/meta', async (req, res) => {
  const p = await einvoice.provider();
  res.json({ categories: erp.EXPENSE_CATEGORIES, iva_rates: einvoice.IVA_RATES, provider: { key: p.key, label: p.label }, issuer: await einvoice.issuer() });
});

// GET /api/invoices?direction=emitida|recibida&from=&to=&category=&q=&pending=1
router.get('/', async (req, res) => {
  const { from, to } = range(req.query);
  const conditions = ['issue_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (['emitida', 'recibida'].includes(req.query.direction)) {
    conditions.push('direction = ?');
    params.push(req.query.direction);
  }
  if (req.query.category === '__sin__') conditions.push("category IS NULL AND direction = 'recibida'");
  else if (req.query.category) {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  if (req.query.q && req.query.q.trim()) {
    conditions.push('(LOWER(party_name) LIKE ? OR party_nit LIKE ? OR LOWER(number) LIKE ?)');
    const t = `%${req.query.q.trim().toLowerCase()}%`;
    params.push(t, t, t);
  }
  const rows = await db.prepare(`SELECT * FROM invoices WHERE ${conditions.join(' AND ')} ORDER BY issue_date DESC, id DESC`).all(...params);
  res.json(rows);
});

// Resumen del periodo: ventas facturadas vs compras/gastos, IVA generado vs
// descontable (lo que se estima pagar a la DIAN), gasto por rubro y por
// mes, y lo que falta por cobrar o por pagar.
router.get('/summary', async (req, res) => {
  const { from, to } = range(req.query);
  const rows = await db.prepare("SELECT * FROM invoices WHERE issue_date BETWEEN ? AND ? AND status != 'rechazada'").all(from, to);
  // Una nota crédito resta de su lado (ventas o compras).
  const sign = (i) => (i.doc_type === 'nota_credito' ? -1 : 1);
  const sum = (list, field) => einvoice.round2(list.reduce((s, i) => s + sign(i) * (Number(i[field]) || 0), 0));
  const emitidas = rows.filter((i) => i.direction === 'emitida');
  const recibidas = rows.filter((i) => i.direction === 'recibida');

  const byCategory = new Map();
  for (const i of recibidas) {
    const k = i.category || 'Sin clasificar';
    byCategory.set(k, (byCategory.get(k) || 0) + sign(i) * i.subtotal);
  }
  const byMonth = new Map();
  for (const i of rows) {
    const ym = i.issue_date.slice(0, 7);
    const m = byMonth.get(ym) || { month: ym, ventas: 0, gastos: 0 };
    if (i.direction === 'emitida') m.ventas += sign(i) * i.subtotal;
    else m.gastos += sign(i) * i.subtotal;
    byMonth.set(ym, m);
  }

  // Pendientes de cobro/pago: sin importar el periodo (es lo que se debe hoy).
  const open = await db
    .prepare("SELECT direction, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM invoices WHERE doc_type = 'factura' AND status = 'aceptada' AND payment_status = 'pendiente' GROUP BY direction")
    .all();
  const openOf = (d) => open.find((o) => o.direction === d) || { n: 0, total: 0 };

  const ivaGenerado = sum(emitidas, 'iva');
  const ivaDescontable = sum(recibidas, 'iva');
  res.json({
    from,
    to,
    ventas: { count: emitidas.filter((i) => i.doc_type === 'factura' && i.status !== 'anulada').length, subtotal: sum(emitidas, 'subtotal'), iva: ivaGenerado, total: sum(emitidas, 'total') },
    compras: { count: recibidas.length, subtotal: sum(recibidas, 'subtotal'), iva: ivaDescontable, total: sum(recibidas, 'total') },
    iva: { generado: ivaGenerado, descontable: ivaDescontable, a_pagar: einvoice.round2(ivaGenerado - ivaDescontable) },
    resultado: einvoice.round2(sum(emitidas, 'subtotal') - sum(recibidas, 'subtotal')),
    gastos_por_categoria: [...byCategory.entries()].map(([name, total]) => ({ name, total: einvoice.round2(total) })).sort((a, b) => b.total - a.total),
    por_mes: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, ventas: einvoice.round2(m.ventas), gastos: einvoice.round2(m.gastos) })),
    sin_clasificar: recibidas.filter((i) => !i.category).length,
    por_cobrar: openOf('emitida'),
    por_pagar: openOf('recibida'),
  });
});

// Datos para arrancar una factura de venta a partir de un lead: cliente y
// las líneas de su última cotización no cancelada.
router.get('/prefill', async (req, res) => {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(req.query.lead_id));
  if (!lead) return res.status(404).json({ error: 'Cliente no encontrado' });
  const client = lead.client_id ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(lead.client_id) : null;
  const quotation = await db.prepare("SELECT * FROM quotations WHERE lead_id = ? AND state != 'cancel' ORDER BY created_at DESC, id DESC").get(lead.id);
  const lines = quotation
    ? (await db.prepare('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY position, id').all(quotation.id)).map((l) => ({
        description: l.product_name,
        qty: l.qty,
        unit_price: l.price_unit,
        iva_rate: 19,
      }))
    : [];
  res.json({
    lead_id: lead.id,
    party_name: lead.client_name,
    party_nit: lead.document || client?.document || '',
    party_email: lead.email || client?.email || '',
    party_address: lead.address || client?.address || '',
    quotation_number: quotation ? quotation.number : null,
    lines,
  });
});

// ---- Reporte "Para la declaración" -------------------------------------------
// Totales por periodo tributario listos para el contador. Qué periodo
// aplica depende del régimen de Velara (lo define el contador y se guarda en
// settings): IVA bimestral o cuatrimestral en régimen ordinario, anual en
// Régimen Simple; los anticipos del Simple son bimestrales. Esto es una
// ayuda para preparar la información, no la declaración misma.
const TAX_REGIMES = {
  no_responsable: 'Persona natural no responsable de IVA',
  simple: 'Régimen Simple de Tributación (RST)',
  ordinario: 'Régimen ordinario, responsable de IVA',
};
const PERIOD_TYPES = { bimestral: 2, cuatrimestral: 4, anual: 12 };
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

async function taxSettings() {
  const regime = await getSetting('tax_regime', null);
  const period = await getSetting('tax_iva_period', null);
  return {
    regime: TAX_REGIMES[regime] ? regime : null,
    iva_period: PERIOD_TYPES[period] ? period : null,
  };
}

// Periodos de un año según el tipo: bimestral -> 6, cuatrimestral -> 3.
function periodsOf(year, type) {
  const size = PERIOD_TYPES[type];
  const out = [];
  for (let start = 1, n = 1; start <= 12; start += size, n++) {
    const end = start + size - 1;
    const last = new Date(Date.UTC(year, end, 0)).getUTCDate();
    out.push({
      n,
      from: `${year}-${String(start).padStart(2, '0')}-01`,
      to: `${year}-${String(end).padStart(2, '0')}-${last}`,
      label: type === 'anual' ? `Año ${year}` : `${MONTH_NAMES[start - 1]} – ${MONTH_NAMES[end - 1]} ${year}`,
    });
  }
  return out;
}

async function taxReport(from, to) {
  const rows = await db.prepare("SELECT * FROM invoices WHERE issue_date BETWEEN ? AND ? AND status != 'rechazada'").all(from, to);
  const r2 = einvoice.round2;
  const sign = (i) => (i.doc_type === 'nota_credito' ? -1 : 1);
  const sum = (list, f) => r2(list.reduce((s, i) => s + sign(i) * (Number(i[f]) || 0), 0));
  const ventas = rows.filter((i) => i.direction === 'emitida');
  const compras = rows.filter((i) => i.direction === 'recibida');
  const ventasFact = ventas.filter((i) => i.doc_type === 'factura');
  const notas = ventas.filter((i) => i.doc_type === 'nota_credito');

  // Base e IVA por tarifa (0/5/19%): el formulario de IVA los pide separados.
  const lines = await db
    .prepare(
      `SELECT il.iva_rate, il.subtotal, il.iva, i.direction, i.doc_type
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
        WHERE i.issue_date BETWEEN ? AND ? AND i.status != 'rechazada'`
    )
    .all(from, to);
  const byRate = (direction) => {
    const m = new Map();
    for (const l of lines.filter((x) => x.direction === direction)) {
      const s = l.doc_type === 'nota_credito' ? -1 : 1;
      const cur = m.get(l.iva_rate) || { rate: l.iva_rate, base: 0, iva: 0 };
      cur.base += s * l.subtotal;
      cur.iva += s * l.iva;
      m.set(l.iva_rate, cur);
    }
    return [...m.values()].map((x) => ({ rate: x.rate, base: r2(x.base), iva: r2(x.iva) })).sort((a, b) => b.rate - a.rate);
  };

  const byCategory = new Map();
  for (const i of compras) {
    const k = i.category || 'Sin clasificar';
    byCategory.set(k, (byCategory.get(k) || 0) + sign(i) * i.subtotal);
  }

  // Terceros (base de la información exógena): cuánto se le vendió y compró
  // a cada NIT en el periodo.
  const terceros = new Map();
  for (const i of rows) {
    const key = String(i.party_nit || i.party_name).replace(/[.\s]/g, '');
    const t = terceros.get(key) || { nit: i.party_nit || '', name: i.party_name, ventas: 0, iva_ventas: 0, compras: 0, iva_compras: 0 };
    if (i.direction === 'emitida') {
      t.ventas += sign(i) * i.subtotal;
      t.iva_ventas += sign(i) * i.iva;
    } else {
      t.compras += sign(i) * i.subtotal;
      t.iva_compras += sign(i) * i.iva;
    }
    terceros.set(key, t);
  }

  const ivaGenerado = sum(ventas, 'iva');
  const ivaDescontable = sum(compras, 'iva');
  return {
    from,
    to,
    ingresos: {
      brutos: r2(ventasFact.reduce((s, i) => s + i.subtotal, 0)),
      devoluciones: r2(notas.reduce((s, i) => s + i.subtotal, 0)),
      netos: sum(ventas, 'subtotal'),
      facturas: ventasFact.length,
      notas_credito: notas.length,
      por_tarifa: byRate('emitida'),
    },
    compras: { total: sum(compras, 'subtotal'), facturas: compras.length, por_tarifa: byRate('recibida'), sin_clasificar: compras.filter((i) => !i.category).length },
    iva: { generado: ivaGenerado, descontable: ivaDescontable, saldo: r2(ivaGenerado - ivaDescontable) },
    gastos_por_categoria: [...byCategory.entries()].map(([name, total]) => ({ name, total: r2(total) })).sort((a, b) => b.total - a.total),
    terceros: [...terceros.values()]
      .map((t) => ({ ...t, ventas: r2(t.ventas), iva_ventas: r2(t.iva_ventas), compras: r2(t.compras), iva_compras: r2(t.iva_compras) }))
      .sort((a, b) => b.ventas + b.compras - (a.ventas + a.compras)),
  };
}

router.get('/tax/settings', async (req, res) => {
  res.json({ ...(await taxSettings()), regimes: TAX_REGIMES, period_types: Object.keys(PERIOD_TYPES) });
});

router.put('/tax/settings', requireRole('admin'), async (req, res) => {
  const { regime, iva_period } = req.body || {};
  if (regime && !TAX_REGIMES[regime]) return res.status(400).json({ error: 'Régimen inválido' });
  if (iva_period && !PERIOD_TYPES[iva_period]) return res.status(400).json({ error: 'Periodicidad inválida' });
  if (regime !== undefined) await setSetting('tax_regime', regime || '');
  if (iva_period !== undefined) await setSetting('tax_iva_period', iva_period || '');
  res.json(await taxSettings());
});

// GET /api/invoices/tax/report?year=2026&type=bimestral&n=5
router.get('/tax/report', async (req, res) => {
  const year = Number(req.query.year) || Number(erp.todayBogota().slice(0, 4));
  const type = PERIOD_TYPES[req.query.type] ? req.query.type : 'bimestral';
  const periods = periodsOf(year, type);
  const today = erp.todayBogota();
  const current = periods.find((p) => today >= p.from && today <= p.to) || periods[periods.length - 1];
  const period = periods.find((p) => p.n === Number(req.query.n)) || current;
  res.json({ year, type, periods, period, settings: await taxSettings(), report: await taxReport(period.from, period.to) });
});

router.get('/:id', async (req, res) => {
  const inv = await readInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  res.json(inv);
});

// Emitir una factura de venta.
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.party_name || !String(b.party_name).trim()) return res.status(400).json({ error: 'Falta el nombre o razón social del cliente' });
  if (!b.party_nit || !String(b.party_nit).trim()) return res.status(400).json({ error: 'Falta el NIT o cédula del cliente (la DIAN lo exige)' });
  const raw = Array.isArray(b.lines) ? b.lines.filter((l) => l && String(l.description || '').trim() && Number(l.qty) > 0 && Number(l.unit_price) > 0) : [];
  if (!raw.length) return res.status(400).json({ error: 'Agrega al menos una línea con descripción, cantidad y precio' });

  const lines = einvoice.computeLines(raw);
  const totals = einvoice.totalsOf(lines);
  const issue_date = erp.todayBogota();
  const prov = await einvoice.provider();
  const issuer = await einvoice.issuer();

  const id = await db.transaction(async () => {
    const number = await einvoice.nextNumber('factura');
    const doc = { number, issue_date, party_nit: String(b.party_nit).replace(/\D/g, ''), totals, issuer, lines };
    const result = await prov.emit(doc);
    return insertInvoice(
      {
        direction: 'emitida',
        number,
        cufe: result.cufe,
        issue_date,
        due_date: addDays(issue_date, Number(b.due_days) >= 0 ? Number(b.due_days) : 0),
        party_name: String(b.party_name).trim(),
        party_nit: String(b.party_nit).trim(),
        party_email: b.party_email,
        party_address: b.party_address,
        lead_id: Number(b.lead_id) || null,
        ...totals,
        status: result.status,
        category: null,
        notes: b.notes,
        source: prov.key,
        created_by: req.user.id,
      },
      lines
    );
  })();
  broadcast('invoices_changed', { id });
  res.status(201).json(await readInvoice(id));
});

// Anular una factura emitida con una nota crédito por el total. En
// Colombia una factura aceptada por la DIAN no se borra ni se edita: se
// corrige con una nota crédito que la referencia.
router.post('/:id/credit-note', async (req, res) => {
  const inv = await readInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (inv.direction !== 'emitida' || inv.doc_type !== 'factura') return res.status(409).json({ error: 'Solo se anulan facturas de venta' });
  if (inv.status === 'anulada') return res.status(409).json({ error: 'Esta factura ya tiene nota crédito' });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Escribe el motivo de la anulación' });
  const prov = await einvoice.provider();
  const issuer = await einvoice.issuer();
  const issue_date = erp.todayBogota();
  const id = await db.transaction(async () => {
    const number = await einvoice.nextNumber('nota_credito');
    const totals = { subtotal: inv.subtotal, iva: inv.iva, total: inv.total };
    const result = await prov.emit({ number, issue_date, party_nit: String(inv.party_nit || '').replace(/\D/g, ''), totals, issuer, lines: inv.lines });
    const ncId = await insertInvoice(
      { ...inv, doc_type: 'nota_credito', number, cufe: result.cufe, issue_date, due_date: null, related_invoice_id: inv.id, ...totals, status: result.status, payment_status: 'pagada', notes: reason, source: prov.key, created_by: req.user.id },
      inv.lines
    );
    await db.prepare("UPDATE invoices SET status = 'anulada', updated_at = datetime('now') WHERE id = ?").run(inv.id);
    return ncId;
  })();
  broadcast('invoices_changed', { id });
  res.status(201).json(await readInvoice(id));
});

// "Descargar" las facturas que los proveedores le emitieron a Velara en el
// periodo. Las que ya estaban (mismo CUFE) no se repiten; las nuevas se
// clasifican solas cuando se puede.
router.post('/sync-received', async (req, res) => {
  const { from, to } = range(req.body || {});
  const prov = await einvoice.provider();
  const found = await prov.fetchReceived({ from, to });
  let created = 0;
  let classified = 0;
  await db.transaction(async () => {
    for (const f of found) {
      const exists = await db.prepare('SELECT id FROM invoices WHERE cufe = ?').get(f.cufe);
      if (exists) continue;
      const supplier = await db
        .prepare("SELECT id FROM suppliers WHERE REPLACE(REPLACE(nit, '.', ''), ' ', '') IN (?, ?)")
        .get(f.party_nit, f.party_nit.split('-')[0]);
      const cls = await einvoice.classify(f, f.lines);
      if (cls.category) classified++;
      await insertInvoice({ ...f, direction: 'recibida', supplier_id: supplier ? supplier.id : null, status: 'aceptada', ...cls, source: prov.key }, f.lines);
      created++;
    }
  })();
  if (created) broadcast('invoices_changed', {});
  res.json({ found: found.length, created, already: found.length - created, classified, unclassified: created - classified });
});

// Clasificar / anotar. Clasificar una factura recibida a mano enseña la
// regla para ese NIT y, si se pide, la aplica a las demás de ese proveedor
// que sigan sin clasificar.
router.patch('/:id', async (req, res) => {
  const inv = await readInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  const { category, notes, apply_to_supplier } = req.body || {};
  let applied = 0;
  if (category !== undefined) {
    if (inv.direction !== 'recibida') return res.status(409).json({ error: 'Solo se clasifican facturas de compra' });
    if (category !== null && !erp.EXPENSE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoría inválida' });
    await db.prepare("UPDATE invoices SET category = ?, category_source = ?, updated_at = datetime('now') WHERE id = ?").run(category, category ? 'manual' : null, inv.id);
    if (category && inv.party_nit) {
      await db
        .prepare("INSERT INTO invoice_category_rules (party_nit, category) VALUES (?, ?) ON CONFLICT(party_nit) DO UPDATE SET category = excluded.category, updated_at = datetime('now')")
        .run(inv.party_nit, category);
      if (apply_to_supplier) {
        const r = await db
          .prepare("UPDATE invoices SET category = ?, category_source = 'regla', updated_at = datetime('now') WHERE direction = 'recibida' AND party_nit = ? AND category IS NULL")
          .run(category, inv.party_nit);
        applied = Number(r.changes) || 0;
      }
    }
  }
  if (notes !== undefined) await db.prepare("UPDATE invoices SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(String(notes).trim() || null, inv.id);
  broadcast('invoices_changed', { id: inv.id });
  res.json({ invoice: await readInvoice(inv.id), applied });
});

// Marcar pagada. Si es una factura de compra, el pago queda también como
// egreso en Caja, en el mismo rubro, para que Finanzas lo cuente.
router.post('/:id/pay', async (req, res) => {
  const inv = await readInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  if (inv.doc_type !== 'factura' || inv.status !== 'aceptada') return res.status(409).json({ error: 'Esta factura no se puede marcar como pagada' });
  if (inv.payment_status === 'pagada') return res.status(409).json({ error: 'Ya está pagada' });
  const paidAt = isoDate(req.body?.date) || erp.todayBogota();
  const method = String(req.body?.method || 'transferencia');
  await db.transaction(async () => {
    await db.prepare("UPDATE invoices SET payment_status = 'pagada', paid_at = ?, updated_at = datetime('now') WHERE id = ?").run(paidAt, inv.id);
    if (inv.direction === 'recibida' && req.body?.register_cash !== false) {
      await db
        .prepare('INSERT INTO cash_entries (kind, category, amount, method, description, entry_date, invoice_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('egreso', inv.category || 'Otros gastos', Math.round(inv.total), method, `Factura ${inv.number} · ${inv.party_name}`, paidAt, inv.id, req.user.id || null);
    }
  })();
  broadcast('invoices_changed', { id: inv.id });
  res.json(await readInvoice(inv.id));
});

// Libro para el contador: ventas y compras del periodo en Excel.
router.get('/export/xlsx', async (req, res) => {
  const { from, to } = range(req.query);
  const rows = await db.prepare('SELECT * FROM invoices WHERE issue_date BETWEEN ? AND ? ORDER BY issue_date, id').all(from, to);
  const sign = (i) => (i.doc_type === 'nota_credito' ? -1 : 1);
  const map = (i) => ({
    Fecha: i.issue_date,
    Tipo: i.doc_type === 'nota_credito' ? 'Nota crédito' : 'Factura',
    Número: i.number,
    [i.direction === 'emitida' ? 'Cliente' : 'Proveedor']: i.party_name,
    NIT: i.party_nit || '',
    ...(i.direction === 'recibida' ? { Rubro: i.category || 'Sin clasificar' } : {}),
    Subtotal: sign(i) * i.subtotal,
    IVA: sign(i) * i.iva,
    Total: sign(i) * i.total,
    Estado: i.status,
    Pago: i.payment_status,
    CUFE: i.cufe || '',
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter((i) => i.direction === 'emitida').map(map)), 'Ventas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter((i) => i.direction === 'recibida').map(map)), 'Compras y gastos');
  const rep = await taxReport(from, to);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rep.terceros.map((t) => ({ NIT: t.nit, Nombre: t.name, 'Ventas (base)': t.ventas, 'IVA ventas': t.iva_ventas, 'Compras (base)': t.compras, 'IVA compras': t.iva_compras }))),
    'Terceros'
  );
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="facturas-${from}-a-${to}.xlsx"`);
  res.send(buf);
});

const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

// 2026-10-06 -> 06-10-2026, mismo formato que la cotización.
const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('-') : iso);

const PAYMENT_LABEL = { pendiente: 'Pendiente', pagada: 'Pagada', parcial: 'Pago parcial', vencida: 'Vencida' };

// Representación gráfica (PDF) de la factura, sobre la hoja oficial de VELARA
// (Velara/VELARA_IDENTIDAD_VISUAL/02_PAPELERIA/Factura): encabezado de marca,
// título con filete rojo, N.º con línea roja, adquiriente y emisor en dos
// columnas, tabla con encabezado grafito, "Total a pagar" en bloque rojo,
// CUFE al lado de los totales y firmas al pie. Ver server/pdfBrand.js.
function drawInvoicePdf(doc, { inv, issuer, cfg }) {
  const { C, F, PAGE } = brand;
  const isSale = inv.direction === 'emitida';
  const issuerNit = `${issuer.nit}-${einvoice.nitDv(issuer.nit)}`;
  const seller = isSale
    ? { name: issuer.name, nit: issuerNit, address: cfg.address, phone: brand.formatPhone(cfg.phone), email: cfg.email }
    : { name: inv.party_name, nit: inv.party_nit };
  const buyer = isSale
    ? { name: inv.party_name, nit: inv.party_nit, address: inv.party_address, email: inv.party_email }
    : { name: issuer.name, nit: issuerNit, address: cfg.address, email: cfg.email };

  brand.setup(doc, cfg);

  if (inv.source === 'simulado') {
    doc.save().rotate(-30, { origin: [306, 420] });
    doc.font(F.bold).fontSize(64).fillColor('#ECEAE4').text('SIMULACIÓN', 40, 385, { width: 532, align: 'center', lineBreak: false });
    doc.restore();
  }

  brand.drawLetterhead(doc, cfg);

  const isCredit = inv.doc_type === 'nota_credito';
  const title = isCredit ? 'Nota crédito' : 'Factura';
  const subtitle = !isSale ? 'Recibida de proveedor' : isCredit ? 'Electrónica' : 'Electrónica de venta';
  brand.drawTitle(doc, title, 162, subtitle);
  const meta = [
    ['Fecha de emisión', dmy(inv.issue_date)],
    ['Fecha de vencimiento', dmy(inv.due_date)],
  ];
  if (inv.related_number) meta.push(['Referencia', `Factura ${inv.related_number}`]);
  if (inv.payment_status) meta.push(['Estado de pago', PAYMENT_LABEL[inv.payment_status] || inv.payment_status]);
  brand.drawDocMeta(doc, 362, 120, inv.number, meta, { redLine: true });

  // ---- adquiriente (izq.) / emisor (der.) ----------------------------------
  const top = 236;
  const leftW = 247;
  const rightX = 349;
  const rightW = PAGE.R - rightX;
  let y1 = brand.sectionHeading(doc, 'Adquiriente', PAGE.L, top);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Nombre / razón social', buyer.name);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'NIT / C.C.', buyer.nit);
  if (buyer.email) y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Correo', buyer.email);
  if (buyer.address) y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Dirección', buyer.address);

  let y2 = brand.sectionHeading(doc, 'Emisor', rightX, top, rightW);
  doc.font(F.regular).fontSize(8.5).fillColor(C.ink);
  for (const line of [seller.name, seller.nit ? `NIT ${seller.nit}` : null, seller.address, seller.phone, seller.email].filter(Boolean)) {
    doc.text(line, rightX, y2, { width: rightW });
    y2 += doc.heightOfString(line, { width: rightW }) + 4;
  }
  const colsBottom = Math.max(y1, y2 + 6);
  doc.moveTo(320, top).lineTo(320, colsBottom - 7).lineWidth(0.6).strokeColor(C.line).stroke();

  // ---- líneas ----------------------------------------------------------------
  const cols = [
    { key: 'item', label: 'Ítem', x: PAGE.L + 4, w: 30, align: 'center', muted: true },
    { key: 'desc', label: 'Descripción', x: PAGE.L + 40, w: 205 },
    { key: 'qty', label: 'Cant.', x: PAGE.L + 249, w: 44, align: 'right' },
    { key: 'price', label: 'Valor unitario', x: PAGE.L + 297, w: 80, align: 'right' },
    { key: 'iva', label: 'IVA', x: PAGE.L + 381, w: 40, align: 'right' },
    { key: 'total', label: 'Valor total', x: PAGE.L + 425, w: 90, align: 'right' },
  ];
  const rows = inv.lines.map((l, i) => ({
    item: String(i + 1),
    desc: l.description,
    qty: String(l.qty),
    price: money(l.unit_price),
    iva: `${l.iva_rate} %`,
    total: money(l.subtotal),
  }));
  let y = brand.drawTable(doc, colsBottom + 6, cols, rows, { minRows: 3 });

  // ---- CUFE (izq.) + totales (der.) -----------------------------------------
  y = brand.ensureSpace(doc, y + 12, 80);
  const blockTop = y;
  const legal =
    inv.source === 'simulado'
      ? 'Documento SIMULADO generado por Velara CRM para pruebas. No fue enviado a la DIAN y no tiene validez fiscal.'
      : `Representación gráfica de la factura electrónica. Proveedor tecnológico: ${inv.source}.`;
  doc.font(F.semibold).fontSize(7.5).fillColor(C.ink).text(isCredit ? 'CUDE' : 'CUFE', PAGE.L, blockTop + 5, { characterSpacing: 1.1 });
  doc.font(F.regular).fontSize(7).fillColor(C.smoke).text(inv.cufe || '—', PAGE.L, blockTop + 18, { width: 270 });
  let yLeft = blockTop + 18 + doc.heightOfString(inv.cufe || '—', { width: 270 }) + 6;
  doc.font(F.regular).fontSize(7.5).fillColor(C.ink).text(legal, PAGE.L, yLeft, { width: 270 });
  yLeft += doc.heightOfString(legal, { width: 270 });
  y = brand.drawTotals(doc, blockTop, [
    ['Subtotal', money(inv.subtotal)],
    ['IVA', money(inv.iva)],
    [isCredit ? 'Total' : 'Total a pagar', money(inv.total)],
  ]);
  y = Math.max(y, yLeft) + 20;

  // ---- observaciones ----------------------------------------------------------
  if (inv.notes) {
    y = brand.ensureSpace(doc, y, 40);
    y = brand.sectionHeading(doc, 'Observaciones', PAGE.L, y);
    doc.font(F.regular).fontSize(8).fillColor(C.ink).text(inv.notes, PAGE.L, y, { width: PAGE.W });
    y += doc.heightOfString(inv.notes, { width: PAGE.W }) + 14;
  }

  // ---- firmas -----------------------------------------------------------------
  y = brand.ensureSpace(doc, y + 24, 40);
  const sigW = 235;
  [
    ['Firma autorizada', isSale ? cfg.name : seller.name],
    ['Recibido por', 'Nombre, C.C. y fecha'],
  ].forEach(([label, sub], i) => {
    const x = i === 0 ? PAGE.L : PAGE.R - sigW;
    doc.moveTo(x, y).lineTo(x + sigW, y).lineWidth(1).strokeColor(C.ink).stroke();
    doc.font(F.semibold).fontSize(7.5).fillColor(C.ink).text(label.toUpperCase(), x, y + 8, { width: sigW, characterSpacing: 1.1 });
    doc.font(F.regular).fontSize(8).fillColor(C.smoke).text(sub || '', x, y + 20, { width: sigW });
  });
}

router.get('/:id/pdf', async (req, res) => {
  const inv = await readInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  const [issuer, cfg] = await Promise.all([einvoice.issuer(), quoteSettings()]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`);
  const doc = new PDFDocument({ size: 'LETTER', margin: 45, info: { Title: inv.number, Author: cfg.name } });
  doc.pipe(res);
  drawInvoicePdf(doc, { inv, issuer, cfg });
  doc.end();
});

module.exports = router;
module.exports.drawInvoicePdf = drawInvoicePdf;
