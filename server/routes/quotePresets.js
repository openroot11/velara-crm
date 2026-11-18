const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');
const nativeQuotes = require('../nativeQuotes');

const router = express.Router();

// Plantillas de cotización (como las de Odoo): un grupo de líneas listo
// -- productos, secciones y notas -- que se aplica de un clic en Nueva
// cotización. Al aplicarla, cada producto del catálogo llega con su precio
// y su descripción de HOY (no los de cuando se guardó la plantilla).

function parseLines(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Solo lo que una plantilla necesita guardar de cada línea.
function slimLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      line_type: nativeQuotes.lineType(l),
      category_id: Number(l.category_id) || null,
      product_id: Number(l.product_id) || null,
      product_name: String(l.product_name || '').trim(),
      description: (l.description && String(l.description).trim()) || null,
      qty: Number(l.qty) || 0,
      price_unit: Number(l.price_unit) || 0,
      discount_percent: Math.min(100, Math.max(0, Number(l.discount_percent) || 0)),
    }))
    .filter((l) => (l.line_type === 'note' ? l.description : l.product_name));
}

async function serialize(row) {
  const lines = parseLines(row.lines);
  const ids = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
  const products = ids.length
    ? await db.prepare(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const fresh = lines.map((l) => {
    const p = l.product_id ? byId.get(l.product_id) : null;
    if (!p || !p.active) return l;
    return { ...l, product_name: p.name, price_unit: p.price, category_id: p.category_id || l.category_id };
  });
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    validity_days: row.validity_days,
    note: row.note,
    active: row.active,
    lines: fresh,
    product_count: fresh.filter((l) => l.line_type === 'product').length,
    updated_at: row.updated_at,
  };
}

router.get('/', async (req, res) => {
  const where = req.query.all === '1' ? '' : 'WHERE active = 1';
  const rows = await db.prepare(`SELECT * FROM quote_presets ${where} ORDER BY name ASC`).all();
  res.json(await Promise.all(rows.map(serialize)));
});

router.post('/', requireRole('admin', 'coordinador'), async (req, res) => {
  const { name, description, lines, validity_days, note } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Ponle un nombre a la plantilla' });
  const slim = slimLines(lines);
  if (!slim.some((l) => l.line_type === 'product')) return res.status(400).json({ error: 'La plantilla necesita al menos un producto' });
  const info = await db
    .prepare('INSERT INTO quote_presets (name, description, lines, validity_days, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      String(name).trim(),
      (description && String(description).trim()) || null,
      JSON.stringify(slim),
      Number(validity_days) > 0 ? Math.round(Number(validity_days)) : null,
      (note && String(note).trim()) || null,
      req.user.id || null
    );
  res.status(201).json(await serialize(await db.prepare('SELECT * FROM quote_presets WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM quote_presets WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  let lines = row.lines;
  if (b.lines !== undefined) {
    const slim = slimLines(b.lines);
    if (!slim.some((l) => l.line_type === 'product')) return res.status(400).json({ error: 'La plantilla necesita al menos un producto' });
    lines = JSON.stringify(slim);
  }
  await db
    .prepare("UPDATE quote_presets SET name = ?, description = ?, lines = ?, validity_days = ?, note = ?, active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(
      b.name !== undefined ? String(b.name).trim() : row.name,
      b.description !== undefined ? (b.description && String(b.description).trim()) || null : row.description,
      lines,
      b.validity_days !== undefined ? (Number(b.validity_days) > 0 ? Math.round(Number(b.validity_days)) : null) : row.validity_days,
      b.note !== undefined ? (b.note && String(b.note).trim()) || null : row.note,
      b.active !== undefined ? (b.active ? 1 : 0) : row.active,
      id
    );
  res.json(await serialize(await db.prepare('SELECT * FROM quote_presets WHERE id = ?').get(id)));
});

router.delete('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT id FROM quote_presets WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Plantilla no encontrada' });
  await db.prepare('DELETE FROM quote_presets WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
