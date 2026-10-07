const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { db, DATA_DIR, getSetting } = require('../db');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');
const erp = require('../erp');
const nativeQuotes = require('../nativeQuotes');
const velaraServices = require('../velaraServices');
const jobPdf = require('../jobPdf');

// Trabajos del taller (reemplaza la producción por pedidos/OP pensada para
// una fábrica). Un trabajo = lo que se le hace a un cliente, con cuatro
// etapas: por_iniciar -> en_proceso -> listo -> entregado (o cancelada).
// Vive en work_orders. Cada trabajo cuelga de una venta (lead ganado) para
// que sus abonos y su saldo cuadren con Finanzas.
const router = express.Router();
router.use(requireRole('admin', 'coordinador', 'produccion'));
const manage = requireRole('admin', 'coordinador');

const STAGES = ['por_iniciar', 'en_proceso', 'listo', 'entregado'];
const FILE_KINDS = ['antes', 'despues', 'diseno', 'otro'];
const LABOR_CATEGORY = 'Nómina y pagos a operarios';
const UPLOAD_ROOT = path.join(DATA_DIR, 'uploads');
const MAX_FILE_MB = 15;

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(UPLOAD_ROOT, 'trabajos', String(Number(req.params.id) || 0));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

const round = (n) => Math.round(Number(n) || 0);
function text(v) {
  const t = v == null ? '' : String(v).trim();
  return t || null;
}
function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}
function changed(id, reason) {
  broadcast('jobs_changed', { id, reason });
  broadcast('cash_changed', { reason: 'job' });
}

async function nextNumber() {
  const last = await db.prepare("SELECT number FROM work_orders WHERE number LIKE 'OT-%' ORDER BY id DESC LIMIT 1").get();
  const n = last ? Number(String(last.number).replace(/\D/g, '')) || 0 : 0;
  return `OT-${String(n + 1).padStart(4, '0')}`;
}

// Lo pagado por el cliente para este trabajo: abonos ligados al trabajo, más
// los abonos de su venta que no están ligados a ningún otro trabajo.
const PAID_SQL = `COALESCE((SELECT SUM(p.amount) FROM payments p
   WHERE p.work_order_id = wo.id OR (p.work_order_id IS NULL AND wo.lead_id IS NOT NULL AND p.lead_id = wo.lead_id)), 0)`;

const LIST_SQL = `
  SELECT wo.*, w.name AS worker_name, ${PAID_SQL} AS paid,
         (SELECT COUNT(*) FROM work_order_files f WHERE f.work_order_id = wo.id) AS files_count
    FROM work_orders wo LEFT JOIN workers w ON w.id = wo.worker_id`;

function serialize(wo) {
  let fields = {};
  try {
    fields = wo.service_fields ? JSON.parse(wo.service_fields) : {};
  } catch {
    fields = {};
  }
  const service = wo.service_slug ? velaraServices.findService(wo.service_slug) : null;
  const today = erp.todayBogota();
  const open = !['entregado', 'cancelada'].includes(wo.stage);
  return {
    ...wo,
    service_fields: fields,
    service_title: service ? service.title : null,
    paid: round(wo.paid),
    balance: round((Number(wo.amount_total) || 0) - (Number(wo.paid) || 0)),
    overdue: open && !!wo.promised_date && wo.promised_date < today,
    due_soon: open && !!wo.promised_date && wo.promised_date >= today && wo.promised_date <= erp.todayBogota(1),
    warranty_until: wo.delivered_at && wo.warranty_months ? addMonths(wo.delivered_at.slice(0, 10), wo.warranty_months) : null,
  };
}

function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + Number(months), d));
  return date.toISOString().slice(0, 10);
}

async function readJob(id) {
  const wo = await db.prepare(`${LIST_SQL} WHERE wo.id = ?`).get(Number(id));
  if (!wo) return null;
  const job = serialize(wo);
  job.materials = await db
    .prepare(
      `SELECT sm.id, sm.type, sm.qty, sm.unit_cost, sm.note, sm.created_at, m.id AS material_id, m.name, m.unit
         FROM stock_movements sm JOIN materials m ON m.id = sm.material_id
        WHERE sm.work_order_id = ? ORDER BY sm.id`
    )
    .all(job.id);
  job.expenses = await db
    .prepare(
      `SELECT ce.id, ce.category, ce.amount, ce.description, ce.entry_date, ce.worker_id, w.name AS worker_name, a.name AS account_name
         FROM cash_entries ce LEFT JOIN workers w ON w.id = ce.worker_id LEFT JOIN accounts a ON a.id = ce.account_id
        WHERE ce.work_order_id = ? AND ce.kind = 'egreso' ORDER BY ce.entry_date, ce.id`
    )
    .all(job.id);
  job.payments = job.lead_id
    ? await db
        .prepare(
          `SELECT p.id, p.amount, p.notes, p.paid_at, p.work_order_id, a.name AS account_name
             FROM payments p LEFT JOIN accounts a ON a.id = p.account_id
            WHERE p.work_order_id = ? OR (p.work_order_id IS NULL AND p.lead_id = ?) ORDER BY p.paid_at`
        )
        .all(job.id, job.lead_id)
    : [];
  job.files = await db.prepare('SELECT id, kind, original_name, mime, created_at FROM work_order_files WHERE work_order_id = ? ORDER BY id').all(job.id);
  const materialsCost = round(job.materials.reduce((s, m) => s - Number(m.qty) * Number(m.unit_cost), 0));
  const laborPaid = round(job.expenses.filter((e) => e.category === LABOR_CATEGORY).reduce((s, e) => s + e.amount, 0));
  const otherCost = round(job.expenses.filter((e) => e.category !== LABOR_CATEGORY).reduce((s, e) => s + e.amount, 0));
  const revenue = round((Number(job.amount_total) || 0) / 1.19);
  job.profit = {
    revenue,
    materials_cost: materialsCost,
    labor_paid: laborPaid,
    labor_pending: Math.max(0, round(job.labor_cost) - laborPaid),
    other_cost: otherCost,
    // La ganancia cuenta el pago acordado al operario aunque no se haya
    // pagado todavía: es un costo del trabajo igual.
    margin: revenue - materialsCost - Math.max(laborPaid, round(job.labor_cost)) - otherCost,
  };
  if (job.quotation_id) {
    const q = await db.prepare('SELECT id, number FROM quotations WHERE id = ?').get(job.quotation_id);
    job.quotation_number = q ? q.number : null;
  }
  return job;
}

// ---- listado / tablero --------------------------------------------------------------------

router.get('/meta', async (req, res) => {
  res.json({
    stages: STAGES,
    workers: await db.prepare('SELECT id, name FROM workers WHERE active = 1 ORDER BY name').all(),
    materials: await db.prepare('SELECT id, name, unit, stock, cost FROM materials WHERE active = 1 ORDER BY name').all(),
    services: velaraServices.SERVICES.map((s) => ({ slug: s.slug, title: s.title })),
    warranty_months: Number(await getSetting('warranty_months_default', '6')) || 6,
  });
});

// GET /api/jobs?q=&worker=&all=1 -- trabajos abiertos + entregados de los
// últimos 30 días (all=1: todos, incluso cancelados).
router.get('/', async (req, res) => {
  const all = req.query.all === '1';
  const where = all ? '1=1' : "(wo.stage IN ('por_iniciar', 'en_proceso', 'listo') OR (wo.stage = 'entregado' AND wo.delivered_at >= datetime('now', '-30 days')))";
  let rows = (await db.prepare(`${LIST_SQL} WHERE ${where} ORDER BY COALESCE(wo.promised_date, '9999') ASC, wo.id DESC`).all()).map(serialize);
  if (req.query.worker) rows = rows.filter((r) => String(r.worker_id) === String(req.query.worker));
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) rows = rows.filter((r) => [r.number, r.client_name, r.phone, r.description, r.service_title].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const job = await readJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json(job);
});

// ---- crear --------------------------------------------------------------------------------------

async function insertJob(data, user) {
  const number = await nextNumber();
  const info = await db
    .prepare(
      `INSERT INTO work_orders (number, quotation_id, lead_id, client_name, phone, address, service_slug, service_fields, description,
                                amount_total, stage, worker_id, labor_cost, promised_date, notes, warranty_months, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'por_iniciar', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      number,
      data.quotation_id || null,
      data.lead_id || null,
      data.client_name,
      data.phone || null,
      data.address || null,
      data.service_slug || null,
      JSON.stringify(data.service_fields || {}),
      data.description || null,
      round(data.amount_total),
      data.worker_id || null,
      round(data.labor_cost),
      data.promised_date || null,
      data.notes || null,
      Number(data.warranty_months) || Number(await getSetting('warranty_months_default', '6')) || 6,
      user.id || null
    );
  return info.lastInsertRowid;
}

async function workerId(id) {
  if (!id) return null;
  const w = await db.prepare('SELECT id FROM workers WHERE id = ?').get(Number(id));
  if (!w) throw Object.assign(new Error('Operario no encontrado'), { status: 400 });
  return w.id;
}

// Desde una cotización: el cliente aceptó. Marca la venta como ganada (si
// estaba abierta) por el valor de la cotización, la cotización como vendida,
// y crea el trabajo con el detalle de la cotización.
router.post('/from-quotation', manage, async (req, res) => {
  const quotation = await nativeQuotes.readQuotation(Number(req.body?.quotation_id));
  if (!quotation) return res.status(404).json({ error: 'Cotización no encontrada' });
  if (!(await nativeQuotes.canAccessQuotation(req.user, quotation))) return res.status(403).json({ error: 'No tienes permiso sobre esta cotización' });
  if (quotation.state === 'cancel') return res.status(409).json({ error: 'La cotización está cancelada' });
  const existing = await db.prepare("SELECT id, number FROM work_orders WHERE quotation_id = ? AND stage != 'cancelada'").get(quotation.id);
  if (existing) return res.status(409).json({ error: `Esta cotización ya tiene el trabajo ${existing.number}`, id: existing.id });
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(quotation.lead_id);
  if (!lead) return res.status(404).json({ error: 'La cotización no tiene cliente' });
  const client = lead.client_id ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(lead.client_id) : null;
  try {
    const b = req.body || {};
    const id = await db.transaction(async () => {
      if (!String(lead.status).startsWith('cerrado')) {
        await db
          .prepare("UPDATE leads SET status = 'cerrado_ganado', closed_at = ?, amount = ? WHERE id = ?")
          .run(erp.nowUtc(), round(quotation.amount_total), lead.id);
      }
      await db.prepare("UPDATE quotations SET state = 'sale', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
      const service = velaraServices.findService(quotation.service_slug);
      const description = quotation.lines.map((l) => `${Number(l.qty) || 1} × ${l.product_name}${l.description ? ` (${l.description})` : ''}`).join('\n');
      return insertJob(
        {
          quotation_id: quotation.id,
          lead_id: lead.id,
          client_name: lead.client_name,
          phone: lead.phone || client?.phone,
          address: lead.address || client?.address,
          service_slug: service ? service.slug : null,
          service_fields: quotation.service_fields,
          description,
          amount_total: quotation.amount_total,
          worker_id: await workerId(b.worker_id),
          labor_cost: b.labor_cost,
          promised_date: isoDate(b.promised_date),
          notes: quotation.note || null,
        },
        req.user
      );
    })();
    broadcast('leads_changed', { reason: 'won', id: lead.id });
    changed(id, 'created');
    res.status(201).json(await readJob(id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// A mano (trabajo que no pasó por cotización): crea también la venta ganada
// y, si no existe, el cliente, para que los abonos y el saldo funcionen.
router.post('/', manage, async (req, res) => {
  const b = req.body || {};
  const amount = round(b.amount_total);
  if (amount < 0) return res.status(400).json({ error: 'El valor no puede ser negativo' });
  const service = b.service_slug ? velaraServices.findService(b.service_slug) : null;

  // Para una venta que ya existe (ej. "Ganado" en el embudo sin cotización):
  // no se crea otro cliente ni otra venta, se usa esa y se marca ganada.
  if (b.lead_id) {
    const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(b.lead_id));
    if (!lead) return res.status(404).json({ error: 'Cliente no encontrado' });
    try {
      const id = await db.transaction(async () => {
        if (!String(lead.status).startsWith('cerrado')) {
          await db.prepare("UPDATE leads SET status = 'cerrado_ganado', closed_at = ?, amount = ? WHERE id = ?").run(erp.nowUtc(), amount, lead.id);
        }
        return insertJob(
          {
            lead_id: lead.id,
            client_name: lead.client_name,
            phone: lead.phone,
            address: text(b.address) || lead.address,
            service_slug: service ? service.slug : null,
            service_fields: {},
            description: text(b.description) || lead.product,
            amount_total: amount,
            worker_id: await workerId(b.worker_id),
            labor_cost: b.labor_cost,
            promised_date: isoDate(b.promised_date),
            notes: text(b.notes) || lead.notes,
          },
          req.user
        );
      })();
      broadcast('leads_changed', { reason: 'won', id: lead.id });
      changed(id, 'created');
      return res.status(201).json(await readJob(id));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  const clientName = text(b.client_name);
  if (!clientName) return res.status(400).json({ error: 'Escribe el nombre del cliente' });
  try {
    const id = await db.transaction(async () => {
      let client = b.client_id ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(b.client_id)) : null;
      const phone = text(b.phone);
      if (!client && phone) client = await db.prepare('SELECT * FROM clients WHERE phone = ?').get(phone);
      if (!client) {
        const ci = await db.prepare('INSERT INTO clients (name, phone, address) VALUES (?, ?, ?)').run(clientName, phone, text(b.address));
        client = { id: ci.lastInsertRowid };
      }
      const advisor = await db.prepare('SELECT id FROM advisors WHERE active = 1 ORDER BY priority_order LIMIT 1').get();
      const now = erp.nowUtc();
      const li = await db
        .prepare(
          `INSERT INTO leads (client_name, phone, product, notes, status, assigned_advisor_id, amount, created_at, contacted_at, quoted_at, closed_at, source, client_id, address)
           VALUES (?, ?, ?, ?, 'cerrado_ganado', ?, ?, ?, ?, ?, ?, 'Directo', ?, ?)`
        )
        .run(clientName, phone, service ? service.title : text(b.description), text(b.notes), advisor ? advisor.id : null, amount, now, now, now, now, client.id, text(b.address));
      return insertJob(
        {
          lead_id: li.lastInsertRowid,
          client_name: clientName,
          phone,
          address: text(b.address),
          service_slug: service ? service.slug : null,
          service_fields: {},
          description: text(b.description),
          amount_total: amount,
          worker_id: await workerId(b.worker_id),
          labor_cost: b.labor_cost,
          promised_date: isoDate(b.promised_date),
          notes: text(b.notes),
          warranty_months: b.warranty_months,
        },
        req.user
      );
    })();
    broadcast('leads_changed', { reason: 'won' });
    changed(id, 'created');
    res.status(201).json(await readJob(id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- editar / etapas ------------------------------------------------------------------------

router.patch('/:id', manage, async (req, res) => {
  const wo = await db.prepare('SELECT * FROM work_orders WHERE id = ?').get(Number(req.params.id));
  if (!wo) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const b = req.body || {};
  try {
    const val = (k, f = (x) => x) => (b[k] !== undefined ? f(b[k]) : wo[k]);
    const amount = val('amount_total', round);
    await db
      .prepare(
        `UPDATE work_orders SET client_name = ?, phone = ?, address = ?, description = ?, amount_total = ?, worker_id = ?, labor_cost = ?,
                promised_date = ?, notes = ?, warranty_months = ?, service_slug = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(
        val('client_name', text) || wo.client_name,
        val('phone', text),
        val('address', text),
        val('description', text),
        amount,
        b.worker_id !== undefined ? await workerId(b.worker_id) : wo.worker_id,
        val('labor_cost', round),
        b.promised_date !== undefined ? isoDate(b.promised_date) : wo.promised_date,
        val('notes', text),
        val('warranty_months', (x) => Math.max(0, Number(x) || 0)),
        b.service_slug !== undefined ? (velaraServices.findService(b.service_slug) ? b.service_slug : null) : wo.service_slug,
        wo.id
      );
    // El valor del trabajo es el valor de la venta: si cambia, la venta
    // (y por lo tanto el saldo por cobrar) también.
    if (b.amount_total !== undefined && wo.lead_id) {
      const jobs = await db.prepare("SELECT COUNT(*) AS n FROM work_orders WHERE lead_id = ? AND stage != 'cancelada'").get(wo.lead_id);
      if (jobs.n === 1) await db.prepare("UPDATE leads SET amount = ? WHERE id = ? AND status = 'cerrado_ganado'").run(amount, wo.lead_id);
    }
    changed(wo.id, 'updated');
    res.json(await readJob(wo.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /:id/stage { stage, received_by?, date? } -- mover de etapa (hacia
// adelante o atrás). Entregar guarda quién recibió y arranca la garantía.
router.post('/:id/stage', async (req, res) => {
  const wo = await db.prepare('SELECT * FROM work_orders WHERE id = ?').get(Number(req.params.id));
  if (!wo) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const stage = req.body?.stage;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Etapa inválida' });
  if (wo.stage === 'cancelada') return res.status(409).json({ error: 'El trabajo está cancelado' });
  const now = erp.nowUtc();
  const idx = STAGES.indexOf(stage);
  const sets = ['stage = ?', "updated_at = datetime('now')"];
  const args = [stage];
  if (idx >= 1 && !wo.started_at) {
    sets.push('started_at = ?');
    args.push(now);
  }
  if (idx >= 2 && !wo.ready_at) {
    sets.push('ready_at = ?');
    args.push(now);
  }
  if (idx < 2) sets.push('ready_at = NULL');
  if (stage === 'entregado') {
    const date = isoDate(req.body?.date);
    sets.push('delivered_at = ?', 'received_by = ?');
    args.push(date ? `${date} 17:00:00` : now, text(req.body?.received_by));
  } else {
    sets.push('delivered_at = NULL');
  }
  await db.prepare(`UPDATE work_orders SET ${sets.join(', ')} WHERE id = ?`).run(...args, wo.id);
  changed(wo.id, 'stage');
  res.json(await readJob(wo.id));
});

router.post('/:id/cancel', manage, async (req, res) => {
  const wo = await db.prepare('SELECT * FROM work_orders WHERE id = ?').get(Number(req.params.id));
  if (!wo) return res.status(404).json({ error: 'Trabajo no encontrado' });
  await db
    .prepare("UPDATE work_orders SET stage = 'cancelada', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .run(text(req.body?.reason), wo.id);
  changed(wo.id, 'cancelled');
  res.json(await readJob(wo.id));
});

// ---- material usado ----------------------------------------------------------------------------

// POST /:id/materials { material_id, qty, note } -- saca material del
// inventario para este trabajo (qty positiva). return=true lo devuelve.
router.post('/:id/materials', async (req, res) => {
  const wo = await db.prepare('SELECT id FROM work_orders WHERE id = ?').get(Number(req.params.id));
  if (!wo) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const qty = Math.abs(Number(req.body?.qty));
  if (!(qty > 0)) return res.status(400).json({ error: 'La cantidad debe ser mayor que cero' });
  const back = !!req.body?.return;
  try {
    await erp.applyMovement({
      material_id: req.body?.material_id,
      type: back ? 'devolucion' : 'consumo',
      qty: back ? qty : -qty,
      work_order_id: wo.id,
      note: req.body?.note,
      user_id: req.user.id,
    });
    broadcast('materials_changed', { reason: 'job' });
    changed(wo.id, 'materials');
    res.json(await readJob(wo.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- fotos y archivos -----------------------------------------------------------------------------

router.post(
  '/:id/files',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `El archivo supera ${MAX_FILE_MB} MB` : err.message });
      next();
    }),
  async (req, res) => {
    const wo = await db.prepare('SELECT id FROM work_orders WHERE id = ?').get(Number(req.params.id));
    if (!wo) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Trabajo no encontrado' });
    }
    if (!req.file) return res.status(400).json({ error: 'Adjunta una foto o archivo' });
    const kind = FILE_KINDS.includes(req.body?.kind) ? req.body.kind : 'otro';
    await db
      .prepare('INSERT INTO work_order_files (work_order_id, kind, original_name, stored_path, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(wo.id, kind, req.file.originalname, path.relative(UPLOAD_ROOT, req.file.path), req.file.mimetype, req.file.size, req.user.id || null);
    changed(wo.id, 'files');
    res.status(201).json(await readJob(wo.id));
  }
);

router.get('/files/:fileId', async (req, res) => {
  const f = await db.prepare('SELECT * FROM work_order_files WHERE id = ?').get(Number(req.params.fileId));
  if (!f) return res.status(404).json({ error: 'Archivo no encontrado' });
  const abs = path.resolve(UPLOAD_ROOT, f.stored_path);
  if (!abs.startsWith(path.resolve(UPLOAD_ROOT)) || !fs.existsSync(abs)) return res.status(404).json({ error: 'El archivo ya no está en el disco' });
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.original_name || 'archivo')}"`);
  fs.createReadStream(abs).pipe(res);
});

router.delete('/files/:fileId', manage, async (req, res) => {
  const f = await db.prepare('SELECT * FROM work_order_files WHERE id = ?').get(Number(req.params.fileId));
  if (!f) return res.status(404).json({ error: 'Archivo no encontrado' });
  await db.prepare('DELETE FROM work_order_files WHERE id = ?').run(f.id);
  const abs = path.resolve(UPLOAD_ROOT, f.stored_path);
  if (abs.startsWith(path.resolve(UPLOAD_ROOT)) && fs.existsSync(abs)) fs.unlink(abs, () => {});
  changed(f.work_order_id, 'files');
  res.json({ ok: true });
});

// ---- PDF: orden de trabajo / acta de entrega ------------------------------------------------------

router.get('/:id/pdf/:doc', async (req, res) => {
  const job = await readJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const draw = jobPdf.DOCS[req.params.doc];
  if (!draw) return res.status(404).json({ error: 'Documento no encontrado' });
  const cfg = await jobPdf.settings();
  const file = `${draw.file}-${job.number}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${file}"`);
  const doc = new PDFDocument({ size: 'LETTER', margin: 45, info: { Title: `${draw.title} ${job.number}`, Author: cfg.name } });
  doc.pipe(res);
  draw.draw(doc, job, cfg);
  doc.end();
});

module.exports = router;
module.exports.readJob = readJob;
