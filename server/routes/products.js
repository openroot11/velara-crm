const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');
const quoteTemplates = require('../quoteTemplates');

const router = express.Router();

// Catálogo de productos de Velara (Cotizaciones › Catálogo). Cada producto
// pertenece a una categoría (routes/productCategories.js), que es la que
// trae el encabezado, la garantía y el tiempo de entrega a la cotización.
// Cualquier rol puede buscar (lo necesita el buscador de líneas); solo
// admin/coordinador lo administra.

const SELECT = `SELECT p.*, c.name AS category_name
                  FROM products p
                  LEFT JOIN product_categories c ON c.id = p.category_id`;

function readOne(id) {
  return db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
}

// GET /api/products?q=&category_id=&all=1
// Sin all=1 (el buscador de la cotización) solo salen los activos y ya
// revisados; con all=1 (la pantalla de catálogo) salen todos.
router.get('/', async (req, res) => {
  const { q, all, category_id } = req.query;
  const conditions = [];
  const params = [];
  if (all !== '1') conditions.push('p.active = 1 AND p.needs_review = 0');
  if (category_id) {
    conditions.push('p.category_id = ?');
    params.push(Number(category_id));
  }
  if (q && q.trim()) {
    conditions.push('(p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`${SELECT} ${where} ORDER BY c.position ASC, p.name ASC`).all(...params);
  res.json(rows);
});

function cleanText(v) {
  return v === undefined ? undefined : (v && String(v).trim()) || null;
}

async function validCategory(id) {
  if (id === undefined) return { ok: true, value: undefined };
  if (id === null || id === '') return { ok: true, value: null };
  const c = await db.prepare('SELECT id FROM product_categories WHERE id = ?').get(Number(id));
  return c ? { ok: true, value: c.id } : { ok: false };
}

router.post('/', requireRole('admin', 'coordinador'), async (req, res) => {
  const { name, price, description, category_id, unit } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  const cat = await validCategory(category_id);
  if (!cat.ok) return res.status(400).json({ error: 'Esa categoría no existe' });
  const info = await db
    .prepare('INSERT INTO products (name, price, description, category_id, unit) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).trim(), Number(price) || 0, cleanText(description) ?? null, cat.value ?? null, cleanText(unit) || 'Unidad');
  res.status(201).json(await readOne(info.lastInsertRowid));
});

router.patch('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  const { name, price, active, description, category_id, unit, needs_review } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  const cat = await validCategory(category_id);
  if (!cat.ok) return res.status(400).json({ error: 'Esa categoría no existe' });
  await db
    .prepare(
      "UPDATE products SET name = ?, price = ?, active = ?, description = ?, category_id = ?, unit = ?, needs_review = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(
      name !== undefined ? String(name).trim() : product.name,
      price !== undefined ? Number(price) || 0 : product.price,
      active !== undefined ? (active ? 1 : 0) : product.active,
      description !== undefined ? cleanText(description) : product.description,
      cat.value !== undefined ? cat.value : product.category_id,
      unit !== undefined ? cleanText(unit) || 'Unidad' : product.unit,
      needs_review !== undefined ? (needs_review ? 1 : 0) : product.needs_review,
      id
    );
  res.json(await readOne(id));
});

// Baja lógica (active=0): las cotizaciones ya guardadas conservan el nombre
// y el precio de ese momento; solo deja de salir en el buscador.
router.delete('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  await db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

// Trae al catálogo la lista de precios que tenía el cotizador anterior
// (Plantillas y tarifas › catálogo, sacada del cotizador de la empresa de
// referencia). Entran marcados "por revisar" en la categoría de forros de
// protección: no salen en el buscador de la cotización hasta que alguien
// los confirme. No repite un producto que ya exista con el mismo nombre.
router.post('/import-legacy', requireRole('admin', 'coordinador'), async (req, res) => {
  const cfg = await quoteTemplates.getConfig();
  const category = await db.prepare("SELECT id FROM product_categories WHERE service_slug = 'forros' ORDER BY id LIMIT 1").get();
  const exists = db.prepare('SELECT id FROM products WHERE LOWER(name) = LOWER(?)');
  const insert = db.prepare('INSERT INTO products (name, price, description, category_id, needs_review) VALUES (?, ?, ?, ?, 1)');
  let added = 0;
  let skipped = 0;
  for (const group of cfg.catalogo || []) {
    for (const item of group.items || []) {
      const name = String(item.t || '').trim();
      if (!name) continue;
      if (await exists.get(name)) {
        skipped++;
        continue;
      }
      await insert.run(name, Number(item.p) || 0, (item.d && String(item.d).trim()) || null, category ? category.id : null);
      added++;
    }
  }
  res.json({ added, skipped });
});

module.exports = router;
