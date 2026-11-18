const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Categorías del catálogo (Cotizaciones › Catálogo). Cada una trae a la
// cotización su encabezado (el texto que abre su sección), su garantía y su
// tiempo de entrega. Cualquier rol las lee (las usa la pantalla de
// cotizar); solo admin/coordinador las cambia.

const SELECT = `SELECT c.*,
                       (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
                  FROM product_categories c`;

router.get('/', async (req, res) => {
  const where = req.query.all === '1' ? '' : 'WHERE c.active = 1';
  res.json(await db.prepare(`${SELECT} ${where} ORDER BY c.position ASC, c.name ASC`).all());
});

function text(v) {
  return (v && String(v).trim()) || null;
}

router.post('/', requireRole('admin', 'coordinador'), async (req, res) => {
  const { name, header, warranty, lead_time, service_slug } = req.body || {};
  if (!text(name)) return res.status(400).json({ error: 'El nombre es requerido' });
  const pos = (await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM product_categories').get()).p;
  const info = await db
    .prepare('INSERT INTO product_categories (name, header, warranty, lead_time, service_slug, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(text(name), text(header), text(warranty), text(lead_time), text(service_slug), pos);
  res.status(201).json(await db.prepare(`${SELECT} WHERE c.id = ?`).get(info.lastInsertRowid));
});

router.patch('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const cat = await db.prepare('SELECT * FROM product_categories WHERE id = ?').get(id);
  if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
  const b = req.body || {};
  if (b.name !== undefined && !text(b.name)) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  const pick = (key) => (b[key] !== undefined ? text(b[key]) : cat[key]);
  await db
    .prepare(
      "UPDATE product_categories SET name = ?, header = ?, warranty = ?, lead_time = ?, service_slug = ?, position = ?, active = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(
      pick('name'),
      pick('header'),
      pick('warranty'),
      pick('lead_time'),
      pick('service_slug'),
      b.position !== undefined ? Number(b.position) || 0 : cat.position,
      b.active !== undefined ? (b.active ? 1 : 0) : cat.active,
      id
    );
  res.json(await db.prepare(`${SELECT} WHERE c.id = ?`).get(id));
});

// Baja lógica: las cotizaciones viejas siguen mostrando su garantía.
router.delete('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const cat = await db.prepare('SELECT id FROM product_categories WHERE id = ?').get(id);
  if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
  await db.prepare("UPDATE product_categories SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
