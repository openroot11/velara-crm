// Motor de cotizaciones nativo de Nova CRM (pestaña "Cotizar"), sin ninguna
// dependencia de Odoo -- vive en su propia base (tablas quotations/
// quotation_lines/products, ver db.js) para que el CRM pueda seguir
// cotizando aunque en algún momento se deje de usar Odoo en conjunto. El
// flujo viejo de cotizar contra Odoo (server/odoo.js, rutas /:id/quotation
// singular en routes/leads.js) sigue intacto y aparte -- este módulo no lo
// toca ni lo reemplaza.

const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

// Imágenes de las cotizaciones (tabla quotation_images).
const UPLOAD_ROOT = path.join(DATA_DIR, 'uploads');

const quoteTemplates = require('./quoteTemplates');

// IVA de las cotizaciones: sale de Cotizaciones › Plantillas y tarifas
// (campo "iva", en %). Por ahora VELARA no cobra IVA (0). Un solo impuesto,
// sin lista de impuestos por producto.
async function ivaRate() {
  const { iva } = await quoteTemplates.getConfig();
  const pct = Math.min(100, Math.max(0, Number(iva) || 0));
  return pct / 100;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// El subtotal de una línea ya descuenta su discount_percent (0-100) -- igual
// que Salesforce/Odoo, el descuento es por línea, no global.
function lineSubtotal(l) {
  const qty = Number(l.qty) || 0;
  const price = Number(l.price_unit) || 0;
  const discount = Math.min(100, Math.max(0, Number(l.discount_percent) || 0));
  return qty * price * (1 - discount / 100);
}

function computeTotals(lines, rate = 0) {
  const amount_untaxed = lines.reduce((s, l) => s + lineSubtotal(l), 0);
  const amount_tax = amount_untaxed * rate;
  return {
    amount_untaxed: round2(amount_untaxed),
    amount_tax: round2(amount_tax),
    amount_total: round2(amount_untaxed + amount_tax),
  };
}

async function readQuotation(id) {
  const q = await db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  if (!q) return null;
  const lines = await db.prepare('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY position ASC, id ASC').all(id);
  let service_fields = {};
  if (q.service_fields) {
    try {
      service_fields = JSON.parse(q.service_fields);
    } catch {
      service_fields = {};
    }
  }
  const images = await db
    .prepare('SELECT id, caption, original_name, mime, size, position FROM quotation_images WHERE quotation_id = ? ORDER BY position ASC, id ASC')
    .all(id);
  return { ...q, service_fields, lines, images, is_confirmed: q.state === 'sale' };
}

// Reescribe TODAS las lineas de una cotizacion (se usa tanto al crearla como
// al editar un borrador) y deja los totales de la cabecera al dia.
async function writeLines(quotationId, lines) {
  await db.prepare('DELETE FROM quotation_lines WHERE quotation_id = ?').run(quotationId);
  const insert = db.prepare(
    'INSERT INTO quotation_lines (quotation_id, product_id, product_name, description, qty, price_unit, discount_percent, subtotal, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  let position = 0;
  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    const price_unit = Number(l.price_unit) || 0;
    const discount_percent = Math.min(100, Math.max(0, Number(l.discount_percent) || 0));
    await insert.run(
      quotationId,
      l.product_id || null,
      l.product_name,
      (l.description && String(l.description).trim()) || null,
      qty,
      price_unit,
      discount_percent,
      round2(lineSubtotal(l)),
      position++
    );
  }
  const totals = computeTotals(lines, await ivaRate());
  await db
    .prepare("UPDATE quotations SET amount_untaxed = ?, amount_tax = ?, amount_total = ?, updated_at = datetime('now') WHERE id = ?")
    .run(totals.amount_untaxed, totals.amount_tax, totals.amount_total, quotationId);
  return totals;
}

// "Clonar" (como el botón Clone de Salesforce en Oportunidades/Quotes):
// arma una cotización nueva en borrador, para el mismo lead, con una copia
// de las líneas de otra -- para armar una revisión sin perder la anterior
// (que sigue intacta, con su propio número y estado).
async function duplicateQuotation(sourceId, createdBy) {
  const source = await readQuotation(sourceId);
  if (!source) return null;
  const days = source.validity_days || 8;
  const validityDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const info = await db
    .prepare('INSERT INTO quotations (lead_id, validity_days, validity_date, note, created_by, service_slug, service_fields, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      source.lead_id,
      days,
      validityDate,
      source.note,
      createdBy || null,
      source.service_slug || null,
      Object.keys(source.service_fields || {}).length ? JSON.stringify(source.service_fields) : null,
      source.terms || null
    );
  const newId = info.lastInsertRowid;
  await db.prepare("UPDATE quotations SET number = printf('COT-%04d', id) WHERE id = ?").run(newId);
  await writeLines(
    newId,
    source.lines.map((l) => ({
      product_id: l.product_id,
      product_name: l.product_name,
      description: l.description,
      qty: l.qty,
      price_unit: l.price_unit,
      discount_percent: l.discount_percent,
    }))
  );
  // Las imágenes se copian (archivo aparte) para que borrar una en la copia
  // no la quite de la original.
  const imgs = await db.prepare('SELECT * FROM quotation_images WHERE quotation_id = ? ORDER BY position, id').all(sourceId);
  for (const img of imgs) {
    const src = path.resolve(UPLOAD_ROOT, img.stored_path);
    if (!src.startsWith(path.resolve(UPLOAD_ROOT)) || !fs.existsSync(src)) continue;
    const dir = path.join(UPLOAD_ROOT, 'cotizaciones', String(newId));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(src)}`);
    fs.copyFileSync(src, dest);
    await db
      .prepare('INSERT INTO quotation_images (quotation_id, caption, original_name, stored_path, mime, size, position, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId, img.caption, img.original_name, path.relative(UPLOAD_ROOT, dest), img.mime, img.size, img.position, createdBy || null);
  }
  return readQuotation(newId);
}

// Un asesor solo opera sobre cotizaciones de sus propios leads -- mismo
// criterio que canOperateOn() en routes/leads.js, pero resuelto a partir del
// lead_id de la cotizacion (no siempre se tiene el lead ya cargado a mano).
async function canAccessQuotation(user, quotation) {
  if (!quotation) return false;
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(quotation.lead_id);
  if (!lead) return false;
  if (user.role !== 'asesor') return true;
  return lead.assigned_advisor_id === user.advisor_id;
}

// Número de la cotización: el que el asesor escriba (ej. "COT-2026-015") o,
// si lo deja vacío, el consecutivo de siempre COT-0001 armado con el id.
// No puede repetirse con otra cotización. Devuelve { error } o { number }.
async function setNumber(quotationId, raw) {
  const wanted = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!wanted) {
    await db.prepare("UPDATE quotations SET number = printf('COT-%04d', id) WHERE id = ?").run(quotationId);
    return { number: (await db.prepare('SELECT number FROM quotations WHERE id = ?').get(quotationId)).number };
  }
  const taken = await db.prepare('SELECT id FROM quotations WHERE LOWER(number) = LOWER(?) AND id != ?').get(wanted, quotationId);
  if (taken) return { error: `Ya existe otra cotización con el número ${wanted}` };
  await db.prepare("UPDATE quotations SET number = ?, updated_at = datetime('now') WHERE id = ?").run(wanted, quotationId);
  return { number: wanted };
}

module.exports = { UPLOAD_ROOT, ivaRate, round2, computeTotals, readQuotation, writeLines, duplicateQuotation, canAccessQuotation, setNumber };
