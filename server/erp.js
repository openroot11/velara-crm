// Lógica compartida del ERP (Inventario, Compras, Caja): el único punto por
// donde cambian las existencias (applyMovement), para que el stock de cada
// material y su historial nunca se descuadren. Producción NO usa esto: no
// toca inventario, solo genera solicitudes de material (ver production.js).

const { db } = require('./db');

const MOVEMENT_TYPES = ['entrada', 'consumo', 'devolucion', 'ajuste'];
const UNITS = ['m', 'm2', 'und', 'kg', 'rollo', 'lt'];

// Categorías de gasto: las comparten Caja (cash_entries) y las facturas de
// compra recibidas (invoices), para que un gasto pagado en efectivo y uno
// que llegó con factura electrónica se sumen en el mismo rubro.
// Rubros de gasto del negocio (Finanzas y facturas recibidas). Los nombres
// viejos se conservan tal cual: hay reglas de clasificación y movimientos
// guardados con ellos.
const EXPENSE_CATEGORIES = [
  'Compra de materiales',
  'Nómina y pagos a operarios',
  'Arriendo',
  'Servicios públicos',
  'Transporte y domicilios',
  'Herramientas y mantenimiento',
  'Publicidad',
  'Impuestos',
  'Comisiones y gastos bancarios',
  'Alimentación y cafetería',
  'Otros gastos',
];

// Fecha de hoy en Colombia (AAAA-MM-DD).
function todayBogota(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Registra el movimiento y actualiza el saldo del material en la misma
// transacción. qty con signo (+ entra, - sale). Una entrada con costo fija
// el costo actual del material. No deja que un consumo deje el stock en
// negativo.
async function applyMovement({ material_id, type, qty, unit_cost, work_order_id, note, user_id }) {
  if (!MOVEMENT_TYPES.includes(type)) throw Object.assign(new Error('Tipo de movimiento inválido'), { status: 400 });
  const amount = Number(qty);
  if (!Number.isFinite(amount) || amount === 0) throw Object.assign(new Error('La cantidad debe ser distinta de cero'), { status: 400 });

  const run = db.transaction(async () => {
    const material = await db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(material_id));
    if (!material) throw Object.assign(new Error('Material no encontrado'), { status: 404 });
    const newStock = Math.round((Number(material.stock) + amount) * 1000) / 1000;
    if (type === 'consumo' && newStock < 0) {
      throw Object.assign(new Error(`No hay suficiente ${material.name}: quedan ${material.stock} ${material.unit}`), { status: 409 });
    }
    const given = Number(unit_cost) > 0 ? Number(unit_cost) : null;
    const movementCost = (type === 'entrada' || type === 'devolucion') && given ? given : Number(material.cost) || 0;
    const materialCost = type === 'entrada' && given ? given : Number(material.cost) || 0;
    await db
      .prepare('INSERT INTO stock_movements (material_id, type, qty, unit_cost, work_order_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(material.id, type, amount, movementCost, work_order_id || null, (note && String(note).trim()) || null, user_id || null);
    await db
      .prepare("UPDATE materials SET stock = ?, cost = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newStock, materialCost, material.id);
    return db.prepare('SELECT * FROM materials WHERE id = ?').get(material.id);
  });
  return run();
}

// Medio de pago que corresponde a cada tipo de cuenta, y al revés: la cuenta
// por defecto para un medio de pago (para lo que llega sin cuenta, como un
// pago a proveedor desde Compras).
const METHOD_BY_ACCOUNT_KIND = { efectivo: 'efectivo', digital: 'nequi', banco: 'transferencia' };
const ACCOUNT_KIND_BY_METHOD = { efectivo: 'efectivo', nequi: 'digital', transferencia: 'banco', tarjeta: 'banco' };

// Devuelve { account_id, method } para un movimiento de plata: si llega una
// cuenta válida se usa esa (y el medio sale de su tipo); si no, se elige la
// cuenta según el medio de pago (o Efectivo). Lanza 400 si la cuenta no existe.
async function resolveAccount(accountId, method) {
  if (accountId) {
    const acc = await db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(accountId));
    if (!acc) throw Object.assign(new Error('Cuenta no encontrada'), { status: 400 });
    return { account_id: acc.id, method: METHOD_BY_ACCOUNT_KIND[acc.kind] || method || 'otro' };
  }
  const kind = ACCOUNT_KIND_BY_METHOD[method] || 'efectivo';
  const acc =
    (await db.prepare('SELECT id FROM accounts WHERE kind = ? AND active = 1 ORDER BY position, id LIMIT 1').get(kind)) ||
    (await db.prepare('SELECT id FROM accounts WHERE active = 1 ORDER BY position, id LIMIT 1').get());
  return { account_id: acc ? acc.id : null, method: method || METHOD_BY_ACCOUNT_KIND[kind] };
}

module.exports = { MOVEMENT_TYPES, UNITS, EXPENSE_CATEGORIES, METHOD_BY_ACCOUNT_KIND, todayBogota, nowUtc, applyMovement, resolveAccount };
