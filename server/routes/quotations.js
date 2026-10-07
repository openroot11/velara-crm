const express = require('express');
const PDFDocument = require('pdfkit');
const { db, getSetting } = require('../db');
const { broadcast } = require('../realtime');
const nativeQuotes = require('../nativeQuotes');
const velaraServices = require('../velaraServices');
const brand = require('../pdfBrand');
const quoteTemplates = require('../quoteTemplates');

const router = express.Router();

const money = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

// DD-MM-AAAA, igual que la plantilla de Odoo que se usaba antes (ver un
// Cotización_S0....pdf viejo del proyecto).
function fmtDateDMY(value) {
  const iso = String(value || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '—';
}

async function loadOwned(req, res) {
  const id = Number(req.params.id);
  const quotation = await nativeQuotes.readQuotation(id);
  if (!quotation) {
    res.status(404).json({ error: 'Cotización no encontrada' });
    return null;
  }
  if (!(await nativeQuotes.canAccessQuotation(req.user, quotation))) {
    res.status(403).json({ error: 'No tienes permiso sobre esta cotización' });
    return null;
  }
  return quotation;
}

// GET /api/quotations?q=&state=&service=&advisor_id=&from=&to=
// Lista TODAS las cotizaciones nativas (no las de Odoo -- esas siguen en
// GET /api/leads/quotations, para la pantalla vieja) con filtros de
// búsqueda -- alimenta la pantalla "Cotizaciones". Un asesor solo ve las de
// sus propios leads, igual que en el resto del CRM.
router.get('/', async (req, res) => {
  const { q, state, service, advisor_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (state) {
    conditions.push('quo.state = ?');
    params.push(state);
  }
  if (service) {
    conditions.push('quo.service_slug = ?');
    params.push(service);
  }
  if (from) {
    conditions.push('quo.date_order >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('quo.date_order <= ?');
    params.push(`${to} 23:59:59`);
  }
  if (req.user.role === 'asesor') {
    conditions.push('l.assigned_advisor_id = ?');
    params.push(req.user.advisor_id);
  } else if (advisor_id) {
    conditions.push('l.assigned_advisor_id = ?');
    params.push(Number(advisor_id));
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    conditions.push('(l.client_name LIKE ? OR l.phone LIKE ? OR l.document LIKE ? OR quo.number LIKE ?)');
    params.push(like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db
    .prepare(
      `SELECT quo.*, l.client_name, l.phone, l.document, l.city, l.assigned_advisor_id
         FROM quotations quo
         JOIN leads l ON l.id = quo.lead_id
         ${where}
        ORDER BY quo.date_order DESC, quo.id DESC
        LIMIT 300`
    )
    .all(...params);
  const advisorsById = new Map((await db.prepare('SELECT id, name FROM advisors').all()).map((a) => [a.id, a]));
  const quotations = rows.map((r) => ({
    id: r.id,
    number: r.number,
    state: r.state,
    date_order: r.date_order,
    validity_date: r.validity_date,
    amount_total: r.amount_total,
    service_slug: r.service_slug,
    service_title: r.service_slug ? velaraServices.findService(r.service_slug)?.title || r.service_slug : null,
    lead_id: r.lead_id,
    client_name: r.client_name,
    phone: r.phone,
    city: r.city,
    advisor_name: r.assigned_advisor_id ? advisorsById.get(r.assigned_advisor_id)?.name || null : null,
  }));
  res.json({ quotations });
});

router.get('/:id', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  res.json({ quotation });
});

// Reescribe las lineas de un borrador (una cotizacion ya enviada o
// confirmada no se toca aqui -- mismo criterio que el flujo de Odoo).
router.put('/:id', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state !== 'draft' && quotation.state !== 'sent') {
    return res.status(409).json({ error: 'Esta cotización ya está confirmada; no se pueden cambiar sus líneas' });
  }
  const { lines, service_slug, service_fields, note } = req.body || {};
  const cleanLines = Array.isArray(lines) ? lines.filter((l) => l && l.product_name && Number(l.qty) > 0) : [];
  if (!cleanLines.length) return res.status(400).json({ error: 'Agrega al menos un producto a la cotización' });

  if (service_slug !== undefined) {
    if (service_slug) {
      const check = velaraServices.validateServiceFields(service_slug, service_fields);
      if (!check.ok) return res.status(400).json({ error: check.error });
      await db
        .prepare("UPDATE quotations SET service_slug = ?, service_fields = ?, updated_at = datetime('now') WHERE id = ?")
        .run(service_slug, Object.keys(check.fields).length ? JSON.stringify(check.fields) : null, quotation.id);
    } else {
      await db.prepare("UPDATE quotations SET service_slug = NULL, service_fields = NULL, updated_at = datetime('now') WHERE id = ?").run(quotation.id);
    }
  }
  if (note !== undefined) {
    await db.prepare("UPDATE quotations SET note = ?, updated_at = datetime('now') WHERE id = ?").run((note && note.trim()) || null, quotation.id);
  }

  await nativeQuotes.writeLines(quotation.id, cleanLines);
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

router.post('/:id/send', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state === 'draft') {
    await db.prepare("UPDATE quotations SET state = 'sent', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  }
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

// Estados intermedios entre "Enviada" y "Aprobada": se marcan a mano, igual
// que el resto del embudo en este CRM (nada se auto-avanza solo). "En
// seguimiento" = ya se le está insistiendo al cliente; "Aprobada" = el
// cliente dio el visto bueno, falta solo convertirla en venta.
router.post('/:id/seguimiento', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state === 'sent' || quotation.state === 'draft') {
    await db.prepare("UPDATE quotations SET state = 'seguimiento', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  }
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

router.post('/:id/aprobar', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state !== 'sale') {
    await db.prepare("UPDATE quotations SET state = 'aprobada', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  }
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

// La confirma como "Pedido de venta" (state 'sale'). El cierre real del lead
// (ganado/perdido, monto, fecha) sigue pasando por POST /api/leads/:id/close
// -- el frontend llama a los dos: primero cierra el lead, y si quedó
// "ganado" llama esto para que la cotización quede marcada como confirmada.
router.post('/:id/confirm', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state !== 'sale') {
    await db.prepare("UPDATE quotations SET state = 'sale', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  }
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

// Cancela la cotización (state 'cancel') -- disponible desde cualquier
// estado salvo ya confirmada como venta.
router.post('/:id/cancel', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state === 'sale') return res.status(409).json({ error: 'Ya está confirmada como venta; no se puede cancelar' });
  await db.prepare("UPDATE quotations SET state = 'cancel', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

// "Clonar" (como el botón Clone de Salesforce): arma una cotización nueva en
// borrador para el mismo lead, copiando las líneas de esta -- útil para
// hacer una revisión sin perder ni tocar la original.
router.post('/:id/duplicate', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  const copy = await nativeQuotes.duplicateQuotation(quotation.id, req.user.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.status(201).json({ quotation: copy });
});

// Datos de la empresa para el encabezado y el pie (editables en Ajustes ->
// "Datos de la empresa (cotizaciones)"). Los usan también la factura y los
// documentos de producción.
async function quoteSettings() {
  const [name, nit, address, phone, email, web, payment, terms] = await Promise.all([
    getSetting('quote_company_name', 'Velara Taller S.A.S.'),
    getSetting('quote_company_nit', ''),
    getSetting('quote_company_address', ''),
    getSetting('quote_company_phone', ''),
    getSetting('quote_company_email', ''),
    getSetting('quote_company_web', ''),
    getSetting('quote_payment_details', ''),
    getSetting('quote_terms', ''),
  ]);
  const { politicasFabricacion, garantias, garantiaReclamo, tiempos } = await quoteTemplates.getConfig();
  return { name, nit, address, phone, email, web, payment, terms, termsFabricacion: politicasFabricacion, garantias, garantiaReclamo, tiempos };
}

// Condiciones que trae la hoja oficial; se usan si en Ajustes no hay ninguna.
const DEFAULT_TERMS = [
  'Los precios incluyen materiales, mano de obra e instalación.',
  'Para iniciar la producción se requiere un anticipo del 50 % del valor total.',
  'El 50 % restante se cancela contra entrega.',
  'Cualquier cambio en el diseño o los materiales puede modificar el precio.',
];

// Dibuja la cotización completa sobre un PDFDocument ya creado (sin abrirlo
// ni cerrarlo -- eso lo hace quien llama). Calca la hoja oficial de VELARA
// (Velara/VELARA_IDENTIDAD_VISUAL/02_PAPELERIA/Cotizacion): encabezado con
// logo y datos de la empresa, título con filete rojo, N.º y fechas a la
// derecha, cliente y vehículo/proyecto en dos columnas, tabla con
// encabezado grafito, total en bloque rojo, condiciones comerciales y pie
// con las franjas de marca (ver server/pdfBrand.js). Aparte del router para
// poder probarla desde un script suelto sin pasar por HTTP/auth.
function drawQuotationPdf(doc, { quotation, lead, client, advisor, cfg }) {
  const { C, F, PAGE } = brand;
  const service = quotation.service_slug ? velaraServices.findService(quotation.service_slug) : null;

  brand.setup(doc, cfg);
  brand.drawLetterhead(doc, cfg);

  // ---- título + datos del documento ---------------------------------------
  brand.drawTitle(doc, 'Cotización', 168);
  brand.drawDocMeta(doc, 362, 132, quotation.number, [
    ['Fecha de emisión', fmtDateDMY(quotation.date_order)],
    ['Válida hasta', fmtDateDMY(quotation.validity_date)],
    ['Asesor', advisor ? advisor.name : ''],
  ]);

  // ---- cliente (izq.) / vehículo o proyecto (der.) ------------------------
  const top = 230;
  const leftW = 247;
  const rightX = 349;
  const rightW = PAGE.R - rightX;

  let y1 = brand.sectionHeading(doc, 'Datos del cliente', PAGE.L, top);
  const clientName = lead ? lead.client_name : client ? client.name : '';
  const clientDoc = (lead && lead.document) || (client && client.document);
  const phone = (lead && lead.phone) || (client && client.phone);
  const email = (lead && lead.email) || (client && client.email);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Nombre / razón social', clientName);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'NIT / C.C.', clientDoc);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Teléfono', brand.formatPhone(phone) || phone);
  if (email) y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Correo', email);
  const address = (lead && lead.address) || (client && client.address);
  if (address) y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Dirección', address);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Ciudad', lead && lead.city);

  let y2 = brand.sectionHeading(doc, 'Vehículo o proyecto', rightX, top, rightW);
  y2 = brand.fieldRow(doc, rightX, y2, 92, rightW, 'Servicio', service ? service.title : lead ? lead.product : '');
  if (service && quotation.service_fields) {
    const f = quotation.service_fields;
    // Marca / modelo / año van juntos en una fila, como en la hoja impresa.
    const vehicle = ['marca', 'modelo', 'anio'].map((k) => f[k]).filter(Boolean).join(' / ');
    if (vehicle) y2 = brand.fieldRow(doc, rightX, y2, 92, rightW, 'Marca / modelo / año', vehicle);
    for (const field of service.fields) {
      if (['marca', 'modelo', 'anio'].includes(field.key)) continue;
      if (f[field.key]) y2 = brand.fieldRow(doc, rightX, y2, 92, rightW, field.label, f[field.key]);
    }
  }
  if (advisor) y2 = brand.fieldRow(doc, rightX, y2, 92, rightW, 'Asesor comercial', advisor.name);

  // Filete vertical entre las dos columnas.
  const colsBottom = Math.max(y1, y2);
  doc.moveTo(320, top).lineTo(320, colsBottom - 7).lineWidth(0.6).strokeColor(C.line).stroke();

  // ---- tabla de líneas ------------------------------------------------------
  const cols = [
    { key: 'item', label: 'Ítem', x: PAGE.L + 4, w: 30, align: 'center', muted: true },
    { key: 'desc', label: 'Descripción', x: PAGE.L + 40, w: 238, bold: true },
    { key: 'qty', label: 'Cant.', x: PAGE.L + 282, w: 58, align: 'right' },
    { key: 'price', label: 'Valor unitario', x: PAGE.L + 346, w: 82, align: 'right' },
    { key: 'total', label: 'Valor total', x: PAGE.L + 432, w: 83, align: 'right' },
  ];
  const rows = quotation.lines.map((l, i) => ({
    item: String(i + 1),
    desc: { text: l.product_name, sub: l.description || null },
    qty: String(l.qty),
    price:
      l.discount_percent > 0
        ? { text: money(l.price_unit), sub: `Descuento ${l.discount_percent} %`, subColor: C.red }
        : money(l.price_unit),
    total: money(l.subtotal),
  }));
  let y = brand.drawTable(doc, colsBottom + 6, cols, rows, { minRows: 3 });

  // ---- totales (der.) + datos de pago (izq., en el hueco de la plantilla) ---
  const paymentLines = (cfg.payment || '').split('\n').map((s) => s.trim()).filter(Boolean);
  y = brand.ensureSpace(doc, y + 12, Math.max(70, 22 + paymentLines.length * 12));
  const blockTop = y;
  let yPay = blockTop;
  if (paymentLines.length) {
    yPay = brand.sectionHeading(doc, 'Datos de pago', PAGE.L, blockTop + 5, 270);
    doc.font(F.regular).fontSize(8).fillColor(C.ink);
    for (const line of paymentLines) {
      doc.text(line, PAGE.L, yPay, { width: 270 });
      yPay += doc.heightOfString(line, { width: 270 }) + 2;
    }
  }
  y = brand.drawTotals(doc, blockTop, [
    ['Subtotal', money(quotation.amount_untaxed)],
    ['IVA (19 %)', money(quotation.amount_tax)],
    ['Total', money(quotation.amount_total)],
  ]);
  y = Math.max(y, yPay) + 20;

  // ---- observaciones (si hay) ----------------------------------------------
  const notes = quotation.note || (lead && lead.notes);
  if (notes) {
    y = brand.ensureSpace(doc, y, 40);
    y = brand.sectionHeading(doc, 'Observaciones', PAGE.L, y);
    doc.font(F.regular).fontSize(8).fillColor(C.ink).text(notes, PAGE.L, y, { width: PAGE.W });
    y += doc.heightOfString(notes, { width: PAGE.W }) + 14;
  }

  // ---- condiciones comerciales --------------------------------------------
  // Carpas y forros (fabricación) llevan sus propias políticas, editables en
  // Cotizaciones › Plantillas y tarifas; el resto usa las de Ajustes.
  const fabrication = quoteTemplates.isFabrication(quotation.service_slug) && (cfg.termsFabricacion || []).length;
  const terms = fabrication
    ? cfg.termsFabricacion.map((s) => String(s).trim()).filter(Boolean)
    : (cfg.terms || '').split('\n').map((s) => s.trim()).filter(Boolean);
  // Tiempo de entrega y garantía salen de una sola tabla por servicio
  // (Plantillas y tarifas), igual a la del sitio: se quitan las líneas de
  // tiempo/garantía escritas a mano y se ponen las del servicio cotizado.
  const slug = quotation.service_slug;
  const termLines = (terms.length ? terms : DEFAULT_TERMS.slice()).filter((t) => !/^(garant[ií]a|tiempo estimado)/i.test(t));
  const leadTime = cfg.tiempos && slug ? cfg.tiempos[slug] : null;
  const warranty = cfg.garantias && slug ? cfg.garantias[slug] : null;
  const generated = [];
  if (leadTime) generated.push(`Tiempo estimado de entrega: ${leadTime} (puede variar según la carga del taller y la complejidad del trabajo).`);
  if (warranty) generated.push(`Garantía: ${warranty}. ${cfg.garantiaReclamo || ''}`.trim());
  termLines.splice(fabrication ? Math.min(2, termLines.length) : 0, 0, ...generated);
  if (quotation.validity_date) termLines.push(`Esta cotización es válida hasta el ${fmtDateDMY(quotation.validity_date)}.`);
  y = brand.ensureSpace(doc, y, 50);
  y = brand.sectionHeading(doc, fabrication ? 'Políticas y condiciones' : 'Condiciones comerciales', PAGE.L, y);
  y = brand.bulletList(doc, PAGE.L, y, PAGE.W, termLines);

  // ---- cierre -----------------------------------------------------------------
  y = brand.ensureSpace(doc, y + 14, 11);
  brand.thanksLine(doc, y);
}

router.get('/:id/pdf', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(quotation.lead_id);
  const client = lead && lead.client_id ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(lead.client_id) : null;
  const advisor =
    lead && lead.assigned_advisor_id ? await db.prepare('SELECT name FROM advisors WHERE id = ?').get(lead.assigned_advisor_id) : null;
  const cfg = await quoteSettings();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${quotation.number || 'cotizacion'}.pdf"`);

  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 45,
    info: { Title: `Cotizacion ${quotation.number || ''}`.trim(), Author: cfg.name },
  });
  doc.pipe(res);
  drawQuotationPdf(doc, { quotation, lead, client, advisor, cfg });
  doc.end();
});

module.exports = router;
module.exports.drawQuotationPdf = drawQuotationPdf;
module.exports.quoteSettings = quoteSettings;
