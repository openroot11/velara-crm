const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// NOVA_DATA_DIR permite levantar una copia de prueba con otra base sin tocar la real.
const DATA_DIR = process.env.NOVA_DATA_DIR ? path.resolve(process.env.NOVA_DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Abrir el archivo YA es "conectar" en SQLite (no hay handshake de red que
// pueda quedar a medias como con Postgres) -- por eso pasa aqui arriba, en
// vez de dentro de init(), a diferencia del pool de Postgres que se conectaba
// solo.
const conn = new DatabaseSync(path.join(DATA_DIR, 'nova_crm.db'));
conn.exec('PRAGMA journal_mode = WAL');
conn.exec('PRAGMA foreign_keys = ON');

function prepare(sql) {
  const stmt = conn.prepare(sql);
  return {
    get(...params) {
      return stmt.get(...params);
    },
    all(...params) {
      return stmt.all(...params);
    },
    run(...params) {
      return stmt.run(...params);
    },
  };
}

function exec(sql) {
  return conn.exec(sql);
}

// Misma firma que antes con Postgres (db.transaction(fn) -> fn ejecutable,
// fn puede ser async), pero mas simple: como SQLite es una sola conexion (no
// un pool), no hace falta AsyncLocalStorage para "pegar" las queries de
// dentro de fn() a la transaccion -- db.prepare(...) ya usa siempre la misma
// conexion, este sea o no el codigo que corre entre BEGIN y COMMIT.
function transaction(fn) {
  return async function runTransaction(...args) {
    exec('BEGIN');
    try {
      const result = await fn(...args);
      exec('COMMIT');
      return result;
    } catch (err) {
      try {
        exec('ROLLBACK');
      } catch {
        /* si el rollback tambien falla, se propaga el error original */
      }
      throw err;
    }
  };
}

const db = { prepare, exec, transaction };

// ---------------------------------------------------------------------------
// Producción (ver Velara_CRM_Produccion_Especificacion_Aprobada.md y
// docs/PLAN-PRODUCCION.md). Pedido comercial -> 1..N Órdenes de Producción.
// Producción NO toca inventario: solo registra lo que necesita y genera
// Solicitudes de Material para el futuro módulo de Inventario. Ningún
// registro se borra físicamente (se cancela/anula), y todo cambio importante
// queda en activity_log (lo escribe el servidor, ver server/production.js).
// ---------------------------------------------------------------------------
const PRODUCTION_SCHEMA_SQL = `
-- Pedido comercial (PED-2026-00001). Cliente/contacto/asesor salen del lead;
-- aquí solo lo propio del pedido. status: recibido -> por_validar ->
-- (info_solicitada) -> validado; o cancelado.
CREATE TABLE IF NOT EXISTS sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  quotation_id INTEGER REFERENCES quotations(id),
  lead_id INTEGER REFERENCES leads(id),
  client_name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  address TEXT,
  destination TEXT,
  advisor_id INTEGER REFERENCES advisors(id),
  product_summary TEXT,
  requested_date TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'por_validar' CHECK (status IN ('recibido', 'por_validar', 'info_solicitada', 'validado', 'cancelado')),
  info_request TEXT,
  notes TEXT,
  cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_orders_lead ON sales_orders(lead_id);

-- Orden de Producción (OP-2026-0001, consecutivo por año, único).
CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id),
  product_name TEXT NOT NULL,
  product_code TEXT,
  service_slug TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'und',
  received_at TEXT,
  requested_date TEXT,
  committed_date TEXT,
  start_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baja', 'normal', 'alta', 'urgente')),
  responsible_worker_id INTEGER REFERENCES workers(id),
  advisor_id INTEGER REFERENCES advisors(id),
  status TEXT NOT NULL DEFAULT 'por_validar' CHECK (status IN ('por_validar', 'programada', 'en_produccion', 'pausada', 'control', 'lista', 'entregada', 'cerrada', 'cancelada')),
  paused_from TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  observations TEXT,
  cancel_reason TEXT,
  started_at TEXT,
  finished_at TEXT,
  delivered_at TEXT,
  closed_at TEXT,
  warranty_months INTEGER NOT NULL DEFAULT 6,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (year, seq)
);
CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_production_orders_so ON production_orders(sales_order_id);

-- Producto y especificaciones técnicas como filas clave/valor (section =
-- producto | tecnica): crecen sin rediseñar la OP.
CREATE TABLE IF NOT EXISTS production_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  section TEXT NOT NULL CHECK (section IN ('producto', 'tecnica')),
  label TEXT NOT NULL,
  value TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_production_specs_op ON production_specs(op_id);

-- Diseños y archivos con versiones: una versión nueva de un mismo grupo
-- ("Diseño principal") deja la anterior como no vigente; nunca se borra.
CREATE TABLE IF NOT EXISTS production_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  kind TEXT NOT NULL DEFAULT 'diseno' CHECK (kind IN ('diseno', 'plano', 'ficha', 'foto', 'pdf', 'otro')),
  group_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  note TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_production_files_op ON production_files(op_id);

-- Materiales requeridos por la OP (NO es inventario).
CREATE TABLE IF NOT EXISTS material_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  material TEXT NOT NULL,
  code TEXT,
  qty REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'und',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'solicitado', 'disponible', 'bloqueado', 'anulado')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_material_requirements_op ON material_requirements(op_id);

-- Solicitud de material (SM-0001): la bandeja que atenderá el futuro módulo
-- de Inventario. No modifica ninguna existencia.
CREATE TABLE IF NOT EXISTS material_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  requirement_id INTEGER REFERENCES material_requirements(id),
  material TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'und',
  reason TEXT NOT NULL DEFAULT 'Producción',
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'atendida', 'cancelada')),
  requested_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tareas de la OP (el % de progreso sale de aquí).
CREATE TABLE IF NOT EXISTS production_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  name TEXT NOT NULL,
  worker_id INTEGER REFERENCES workers(id),
  planned_date TEXT,
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_proceso', 'completada', 'bloqueada', 'anulada')),
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_production_tasks_op ON production_tasks(op_id);

-- Operarios asignados a la OP (además del responsable principal).
CREATE TABLE IF NOT EXISTS production_workers (
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  PRIMARY KEY (op_id, worker_id)
);

-- Bloqueos: mientras haya uno activo la OP queda PAUSADA.
CREATE TABLE IF NOT EXISTS production_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  reason TEXT NOT NULL CHECK (reason IN ('info_incompleta', 'diseno_pendiente', 'aprobacion_pendiente', 'material_pendiente', 'problema_produccion', 'otro')),
  responsible TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'resuelto')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS idx_production_blocks_op ON production_blocks(op_id);

-- Control / revisión al terminar la producción.
CREATE TABLE IF NOT EXISTS production_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  result TEXT NOT NULL CHECK (result IN ('aprobado', 'correccion')),
  checklist TEXT,
  notes TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aprobación del asesor comercial (confirmaciones + firma dibujada).
CREATE TABLE IF NOT EXISTS production_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  advisor_id INTEGER REFERENCES advisors(id),
  signed_name TEXT NOT NULL,
  confirm_features INTEGER NOT NULL DEFAULT 0,
  confirm_quantities INTEGER NOT NULL DEFAULT 0,
  confirm_design INTEGER NOT NULL DEFAULT 0,
  signature_path TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registros de entrega: kind = lista (terminada y autorizada) | entregada.
CREATE TABLE IF NOT EXISTS production_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL REFERENCES production_orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('lista', 'entregada')),
  date TEXT NOT NULL,
  responsible TEXT,
  review_done INTEGER NOT NULL DEFAULT 0,
  authorized_by TEXT,
  received_by TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial / auditoría de pedidos y OP.
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('op', 'pedido')),
  entity_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity, entity_id);
`;

// users.role tiene un CHECK con los roles permitidos; para sumar el rol
// "produccion" (jefe de producción) hay que reconstruir la tabla, mismo
// procedimiento que ensureQuotationsStateCheck(). Copia todas las columnas
// que tenga la tabla hoy, sin suponer cuáles son.
// warranty_claims.work_order_id nació NOT NULL (reclamos de la orden de
// trabajo vieja); ahora los reclamos cuelgan de la OP (production_order_id)
// y ese campo debe poder ir vacío. Se reconstruye la tabla una sola vez.
function ensureWarrantyClaimsNullable() {
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'warranty_claims'").get();
  const oldDef = 'work_order_id INTEGER NOT NULL REFERENCES work_orders(id)';
  if (!row || !row.sql.includes(oldDef)) return;
  const newSql = row.sql
    .replace(oldDef, 'work_order_id INTEGER REFERENCES work_orders(id)')
    .replace(/^CREATE TABLE\s+"?warranty_claims"?/i, 'CREATE TABLE warranty_claims_new');
  const cols = conn.prepare('PRAGMA table_info(warranty_claims)').all().map((c) => c.name).join(', ');
  exec('PRAGMA foreign_keys = OFF');
  exec('BEGIN');
  try {
    exec(newSql);
    exec(`INSERT INTO warranty_claims_new (${cols}) SELECT ${cols} FROM warranty_claims`);
    exec('DROP TABLE warranty_claims');
    exec('ALTER TABLE warranty_claims_new RENAME TO warranty_claims');
    exec('CREATE INDEX IF NOT EXISTS idx_warranty_claims_order ON warranty_claims(work_order_id)');
    exec('COMMIT');
  } catch (err) {
    exec('ROLLBACK');
    exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  exec('PRAGMA foreign_keys = ON');
}

function ensureUsersRoleCheck() {
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row || row.sql.includes("'produccion'")) return;
  const oldCheck = "CHECK (role IN ('admin', 'coordinador', 'asesor'))";
  if (!row.sql.includes(oldCheck)) throw new Error('No se reconoce la restricción de roles de users; revisar ensureUsersRoleCheck');
  const newSql = row.sql
    .replace(oldCheck, "CHECK (role IN ('admin', 'coordinador', 'asesor', 'produccion'))")
    .replace(/^CREATE TABLE\s+"?users"?/i, 'CREATE TABLE users_new');
  const cols = conn.prepare('PRAGMA table_info(users)').all().map((c) => c.name).join(', ');
  exec('PRAGMA foreign_keys = OFF');
  exec('BEGIN');
  try {
    exec(newSql);
    exec(`INSERT INTO users_new (${cols}) SELECT ${cols} FROM users`);
    exec('DROP TABLE users');
    exec('ALTER TABLE users_new RENAME TO users');
    exec('COMMIT');
  } catch (err) {
    exec('ROLLBACK');
    exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  exec('PRAGMA foreign_keys = ON');
}

// ---------------------------------------------------------------------------
// ERP (rama erp-taller): inventario de materiales, compras, caja y
// garantías. work_orders/stock_movements son de la primera versión del
// taller (antes de Producción): Inventario y Compras siguen como apps
// aparte; la orden de trabajo quedó reemplazada por la OP de Producción.
// ---------------------------------------------------------------------------
const ERP_SCHEMA_SQL = `
-- Operarios del taller (quienes cortan, cosen e instalan). No son usuarios
-- del sistema ni asesores de venta: el taller los asigna a órdenes.
CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialty TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Orden de trabajo (OT-0001...). stage: por_iniciar -> en_proceso -> listo
-- (para entregar) -> entregado; 'cancelada' la saca del tablero.
-- promised_date es solo fecha (AAAA-MM-DD), la que se le prometió al cliente.
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  quotation_id INTEGER REFERENCES quotations(id),
  lead_id INTEGER REFERENCES leads(id),
  client_name TEXT NOT NULL,
  phone TEXT,
  service_slug TEXT,
  service_fields TEXT,
  description TEXT,
  amount_total REAL NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'por_iniciar' CHECK (stage IN ('por_iniciar', 'en_proceso', 'listo', 'entregado', 'cancelada')),
  worker_id INTEGER REFERENCES workers(id),
  promised_date TEXT,
  notes TEXT,
  started_at TEXT,
  ready_at TEXT,
  delivered_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_work_orders_stage ON work_orders(stage);
CREATE INDEX IF NOT EXISTS idx_work_orders_quotation ON work_orders(quotation_id);

-- Materiales del taller (cuero sintético, espuma, hilo...). stock y
-- min_stock en la unidad del material; cost = costo por unidad de la última
-- entrada (compra), para valorizar el inventario y el consumo de cada orden.
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'm',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Todo cambio de existencias queda registrado aquí (el stock de materials es
-- el saldo que resulta de estos movimientos). qty con signo: + entra, - sale.
-- entrada = compra/recepción, consumo = gastado en una orden, devolucion =
-- sobró de una orden y vuelve, ajuste = conteo físico.
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  type TEXT NOT NULL CHECK (type IN ('entrada', 'consumo', 'devolucion', 'ajuste')),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  work_order_id INTEGER REFERENCES work_orders(id),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_material ON stock_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_order ON stock_movements(work_order_id);

-- Proveedores de materiales.
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nit TEXT,
  contact TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Orden de compra (OC-0001). status: borrador -> pedida -> recibida (al
-- recibirla, cada línea entra al inventario con su costo) o cancelada.
-- Lo pagado al proveedor no se guarda aquí: son egresos de Caja ligados a
-- la orden (cash_entries.purchase_order_id).
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'pedida', 'recibida', 'cancelada')),
  expected_date TEXT,
  notes TEXT,
  total REAL NOT NULL DEFAULT 0,
  ordered_at TEXT,
  received_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(purchase_order_id);

-- Caja: todo lo que entra o sale de plata que NO es un abono de cliente (los
-- abonos ya viven en "payments", ligados a la venta, y Caja los suma como
-- ingresos al mostrar el día). kind: egreso (gastos, pago a proveedor,
-- nómina...) o ingreso (otros ingresos). purchase_order_id liga un pago a
-- su orden de compra.
CREATE TABLE IF NOT EXISTS cash_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('ingreso', 'egreso')),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'efectivo',
  description TEXT,
  entry_date TEXT NOT NULL,
  purchase_order_id INTEGER REFERENCES purchase_orders(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_entries_date ON cash_entries(entry_date);

-- Reclamos de garantía sobre una orden ya entregada. status: abierto ->
-- en_revision -> resuelto | rechazado (fuera de garantía o no aplica).
CREATE TABLE IF NOT EXISTS warranty_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER REFERENCES work_orders(id),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'en_revision', 'resuelto', 'rechazado')),
  resolution TEXT,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_order ON warranty_claims(work_order_id);
`;

// ---------------------------------------------------------------------------
// Facturación electrónica (ver server/einvoice.js y routes/invoices.js).
// Una sola tabla para lo que Velara factura (direction 'emitida' = ventas)
// y lo que le facturan sus proveedores (direction 'recibida' = compras y
// gastos), para poder cruzar IVA generado contra IVA descontable y ventas
// contra gastos en el mismo periodo. El CUFE es la llave con la que la
// DIAN identifica cada documento: UNIQUE evita bajar dos veces la misma
// factura recibida.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Finanzas (ver server/routes/cash.js): dónde está la plata (cuentas con su
// saldo), traslados entre cuentas y gastos fijos del mes. Los movimientos
// siguen en cash_entries (gastos y otros ingresos) y payments (abonos de
// clientes); a ambos se les agrega la cuenta y, opcional, el trabajo.
// ---------------------------------------------------------------------------
const FINANCE_SCHEMA_SQL = `
-- Cuentas de dinero del negocio. kind: efectivo | digital (Nequi/Daviplata)
-- | banco. El saldo no se guarda: es opening_balance + lo que entró - lo que
-- salió (movimientos y traslados).
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'efectivo',
  opening_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Plata que se mueve de una cuenta a otra (ej. consignar el efectivo en el
-- banco). No es ingreso ni gasto: solo cambia dónde está.
CREATE TABLE IF NOT EXISTS account_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount REAL NOT NULL CHECK (amount > 0),
  transfer_date TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gastos fijos que se repiten cada mes (arriendo, servicios, internet...).
-- Pagar uno crea el egreso en cash_entries con recurring_id; así se sabe
-- cuáles faltan por pagar en el mes.
-- Fotos y archivos de un trabajo (antes, después, diseño...).
CREATE TABLE IF NOT EXISTS work_order_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  kind TEXT NOT NULL DEFAULT 'otro',
  original_name TEXT,
  stored_path TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_work_order_files_wo ON work_order_files(work_order_id);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER REFERENCES accounts(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Cuentas con las que arranca el negocio (decisión del dueño: efectivo,
// Nequi/Daviplata y banco). Solo si no hay ninguna.
async function seedAccounts() {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM accounts').get();
  if (n.n > 0) return;
  const ins = db.prepare('INSERT INTO accounts (name, kind, position) VALUES (?, ?, ?)');
  await ins.run('Efectivo', 'efectivo', 1);
  await ins.run('Nequi / Daviplata', 'digital', 2);
  await ins.run('Banco', 'banco', 3);
}

// Movimientos registrados antes de existir las cuentas: se asignan a la
// cuenta que corresponde a su medio de pago (efectivo -> Efectivo, nequi ->
// Nequi, transferencia/tarjeta -> Banco; sin dato -> Efectivo).
async function backfillAccounts() {
  const byKind = async (kind) => (await db.prepare('SELECT id FROM accounts WHERE kind = ? ORDER BY position, id LIMIT 1').get(kind))?.id || null;
  const cash = await byKind('efectivo');
  const digital = (await byKind('digital')) || cash;
  const bank = (await byKind('banco')) || cash;
  if (!cash) return;
  for (const table of ['cash_entries', 'payments']) {
    await db.prepare(`UPDATE ${table} SET account_id = ? WHERE account_id IS NULL AND method = 'nequi'`).run(digital);
    await db.prepare(`UPDATE ${table} SET account_id = ? WHERE account_id IS NULL AND method IN ('transferencia', 'tarjeta')`).run(bank);
    await db.prepare(`UPDATE ${table} SET account_id = ? WHERE account_id IS NULL`).run(cash);
  }
}

const INVOICE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('emitida', 'recibida')),
  doc_type TEXT NOT NULL DEFAULT 'factura' CHECK (doc_type IN ('factura', 'nota_credito')),
  number TEXT NOT NULL,
  cufe TEXT UNIQUE,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  party_name TEXT NOT NULL,
  party_nit TEXT,
  party_email TEXT,
  party_address TEXT,
  lead_id INTEGER REFERENCES leads(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  related_invoice_id INTEGER REFERENCES invoices(id),
  subtotal REAL NOT NULL DEFAULT 0,
  iva REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  -- aceptada/rechazada = respuesta de la DIAN; anulada = tiene nota crédito.
  status TEXT NOT NULL DEFAULT 'aceptada' CHECK (status IN ('pendiente', 'aceptada', 'rechazada', 'anulada')),
  payment_status TEXT NOT NULL DEFAULT 'pendiente' CHECK (payment_status IN ('pendiente', 'pagada')),
  paid_at TEXT,
  -- Solo facturas recibidas: rubro de gasto (erp.EXPENSE_CATEGORIES) o NULL
  -- mientras nadie la clasifique; category_source dice si la puso una regla
  -- aprendida, una palabra clave o una persona.
  category TEXT,
  category_source TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'simulado',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_dir_date ON invoices(direction, issue_date);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  iva_rate REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  iva REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

-- Reglas aprendidas: cuando alguien clasifica a mano una factura de un
-- proveedor, las siguientes de ese mismo NIT entran ya clasificadas.
CREATE TABLE IF NOT EXISTS invoice_category_rules (
  party_nit TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

async function getSetting(key, fallback = null) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// Los 3 asesores reales del negocio.
const DEFAULT_ADVISORS = [
  { name: 'Harol', role: 'Asesor Comercial' },
  { name: 'Oscar', role: 'Asesor Comercial' },
  { name: 'Roberto', role: 'Asesor Comercial' },
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Asesor Comercial',
  active INTEGER NOT NULL DEFAULT 1,
  is_group INTEGER NOT NULL DEFAULT 0,
  priority_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  product TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'asignado',
  assigned_advisor_id INTEGER REFERENCES advisors(id),
  amount REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  contacted_at TEXT,
  closed_at TEXT,
  reassigned_count INTEGER NOT NULL DEFAULT 0,
  source TEXT DEFAULT 'WhatsApp',
  quoted_at TEXT,
  channel_detail TEXT,
  last_followup_at TEXT,
  followup_count INTEGER NOT NULL DEFAULT 0,
  city TEXT,
  is_historical INTEGER NOT NULL DEFAULT 0,
  client_id INTEGER REFERENCES clients(id),
  sale_reference TEXT,
  contact_ack_at TEXT
);

CREATE TABLE IF NOT EXISTS reassignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  from_advisor_id INTEGER REFERENCES advisors(id),
  to_advisor_id INTEGER REFERENCES advisors(id),
  reason TEXT,
  penalty_points INTEGER NOT NULL DEFAULT 5,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS informe_stats (
  fecha TEXT NOT NULL,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  asignados INTEGER NOT NULL DEFAULT 0,
  contactados INTEGER NOT NULL DEFAULT 0,
  cotizados INTEGER NOT NULL DEFAULT 0,
  pendientes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fecha, advisor_id)
);

CREATE TABLE IF NOT EXISTS informe_ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  cliente TEXT,
  monto REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS informe_canales (
  fecha TEXT PRIMARY KEY,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  correo INTEGER NOT NULL DEFAULT 0,
  llamadas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'asesor' CHECK (role IN ('admin', 'coordinador', 'asesor')),
  advisor_id INTEGER REFERENCES advisors(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Costo/clics/conversiones por campaña y día, traídos de la API de Google
-- Ads (ver server/googleAds.js + server/googleAdsSync.js). Es el detalle
-- fino que alimenta tanto el desglose "por campaña" de Rentabilidad de
-- Leads como los totales mensuales de ad_spend (la sync los suma y
-- actualiza ad_spend solo, sin necesidad de teclearlos a mano).
CREATE TABLE IF NOT EXISTS google_ads_campaign_stats (
  date TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  conversions REAL NOT NULL DEFAULT 0,
  conversions_value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, campaign_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('rendimiento', 'rentabilidad', 'asesor')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  advisor_id INTEGER REFERENCES advisors(id),
  generated_by INTEGER REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL,
  notes TEXT,
  registered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lista de precios propia del CRM (pestaña "Cotizar"): a diferencia del
-- catálogo de productos de Odoo, esta vive 100% en Nova y no depende de esa
-- integración -- la idea es que, cuando el negocio deje de usar Odoo en
-- conjunto con el CRM, cotizar siga funcionando igual. "active=0" = producto
-- descontinuado (no aparece en el buscador de nuevas líneas, pero se
-- conserva para no romper cotizaciones viejas que ya lo referencian).
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cotizaciones nativas del CRM (pestaña "Cotizar"), independientes de Odoo.
-- "number" es el consecutivo mostrado (COT-0001...), armado a partir del id
-- tras el INSERT. "state" imita las mismas 4 etapas que ya se usaban con
-- Odoo (draft/sent/sale/cancel) para no rediseñar la barra de estado de la
-- pantalla -- pero aquí nada de esto toca sale.order.
CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  -- NULL brevemente entre el INSERT y el UPDATE que le pone el consecutivo
  -- (necesita el id, que solo se conoce tras insertar) -- UNIQUE en SQLite
  -- no choca entre varios NULL, asi que no hace falta un valor de relleno.
  number TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'sent', 'seguimiento', 'aprobada', 'sale', 'cancel')),
  note TEXT,
  validity_days INTEGER NOT NULL DEFAULT 8,
  date_order TEXT NOT NULL DEFAULT (datetime('now')),
  validity_date TEXT,
  amount_untaxed REAL NOT NULL DEFAULT 0,
  amount_tax REAL NOT NULL DEFAULT 0,
  amount_total REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  price_unit REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

-- Vista que leen las pantallas de ventas y los reportes. Antes dejaba solo
-- los leads de Google Ads (regla del negocio anterior); Velara cuenta todos
-- los canales, así que hoy es la tabla completa (ver init()).
CREATE VIEW IF NOT EXISTS leads_visible AS
SELECT * FROM leads;
`;

async function seedIfEmpty() {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM advisors').get();
  if (row.c > 0) return;

  const insert = db.prepare('INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, 1, 0, ?)');
  for (let idx = 0; idx < DEFAULT_ADVISORS.length; idx++) {
    const a = DEFAULT_ADVISORS[idx];
    await insert.run(a.name, a.role, idx + 1);
  }

  await setSetting('auto_backup_weekly', 'true');
  await setSetting('last_backup_at', '');
}

// CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existe --
// para una base con datos reales (como esta, en uso desde antes de agregar
// contact_ack_at) hace falta migrar la columna a mano si todavia no esta.
function ensureColumn(table, column, definition) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// El CHECK de una columna no se puede alterar con ALTER TABLE: para ampliar
// los tipos de reporte permitidos (se agrego 'mensual', el reporte de
// gerencia) hay que reconstruir la tabla. Procedimiento oficial de SQLite
// para redefinir una tabla (foreign_keys OFF + transaccion + rename).
function ensureReportsTypeCheck() {
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get();
  if (!row || row.sql.includes("'mensual'")) return;

  exec('PRAGMA foreign_keys = OFF');
  exec('BEGIN');
  try {
    exec(`
      CREATE TABLE reports_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('rendimiento', 'rentabilidad', 'asesor', 'mensual')),
        period_from TEXT NOT NULL,
        period_to TEXT NOT NULL,
        advisor_id INTEGER REFERENCES advisors(id),
        generated_by INTEGER REFERENCES users(id),
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        data TEXT NOT NULL
      );
    `);
    exec(
      'INSERT INTO reports_new (id, type, period_from, period_to, advisor_id, generated_by, generated_at, data) ' +
        'SELECT id, type, period_from, period_to, advisor_id, generated_by, generated_at, data FROM reports'
    );
    exec('DROP TABLE reports');
    exec('ALTER TABLE reports_new RENAME TO reports');
    exec('COMMIT');
  } catch (err) {
    exec('ROLLBACK');
    exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  exec('PRAGMA foreign_keys = ON');
}

// Igual que ensureReportsTypeCheck() de arriba, pero para quotations: se
// agregan los estados intermedios 'seguimiento' y 'aprobada' (cotización en
// seguimiento con el cliente / ya aprobada por el cliente, antes de
// convertirse en venta) al rediseño de Cotizaciones sobre el concepto de
// Velara.
function ensureQuotationsStateCheck() {
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quotations'").get();
  if (!row || row.sql.includes("'seguimiento'")) return;

  exec('PRAGMA foreign_keys = OFF');
  exec('BEGIN');
  try {
    exec(`
      CREATE TABLE quotations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL REFERENCES leads(id),
        number TEXT UNIQUE,
        state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'sent', 'seguimiento', 'aprobada', 'sale', 'cancel')),
        note TEXT,
        validity_days INTEGER NOT NULL DEFAULT 8,
        date_order TEXT NOT NULL DEFAULT (datetime('now')),
        validity_date TEXT,
        amount_untaxed REAL NOT NULL DEFAULT 0,
        amount_tax REAL NOT NULL DEFAULT 0,
        amount_total REAL NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    exec(
      'INSERT INTO quotations_new (id, lead_id, number, state, note, validity_days, date_order, validity_date, amount_untaxed, amount_tax, amount_total, created_by, created_at, updated_at) ' +
        'SELECT id, lead_id, number, state, note, validity_days, date_order, validity_date, amount_untaxed, amount_tax, amount_total, created_by, created_at, updated_at FROM quotations'
    );
    exec('DROP TABLE quotations');
    exec('ALTER TABLE quotations_new RENAME TO quotations');
    exec('COMMIT');
  } catch (err) {
    exec('ROLLBACK');
    exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  exec('PRAGMA foreign_keys = ON');
}

// Pone un valor por defecto SOLO si esa llave todavia no existe -- a
// diferencia de seedIfEmpty() (que solo corre en una base recien creada,
// vacia de advisors), esto corre siempre y no pisa un valor que el usuario
// ya haya editado desde Ajustes.
async function ensureDefaultSetting(key, value) {
  const current = await getSetting(key, null);
  if (current === null) await setSetting(key, value);
}

// Datos de la empresa para el PDF de cotización nativo (pestaña "Cotizar",
// ver server/routes/quotations.js). Datos reales de Velara Taller S.A.S.
// (ver Velara/notas/proyecto-velara.md) donde ya se conocen; NIT y cuenta de
// pago se dejan en blanco a propósito -- no hay uno real confirmado todavía,
// y no tiene sentido inventar un número bancario en un documento real.
// Editables desde Ajustes -> "Datos de la empresa (cotizaciones)".
async function seedQuoteDefaults() {
  await ensureDefaultSetting('quote_company_name', 'Velara Taller S.A.S.');
  await ensureDefaultSetting('quote_company_nit', '');
  await ensureDefaultSetting('quote_company_address', 'Calle 56 # 12C-02, Local 3, Barranquilla, Atlántico');
  await ensureDefaultSetting('quote_company_phone', '3003666093');
  await ensureDefaultSetting('quote_company_email', 'velarataller@gmail.com');
  await ensureDefaultSetting('quote_company_web', '');
  await ensureDefaultSetting('quote_payment_details', '');
  await ensureDefaultSetting(
    'quote_terms',
    // Tiempo de entrega y garantía no van aquí: el PDF los arma por servicio
    // desde quote_templates_config (ver server/quoteTemplates.js).
    'El valor puede variar según el estado real del vehículo/mueble y las personalizaciones solicitadas al momento de recibirlo.\n' +
      'Para iniciar el trabajo se confirma disponibilidad y se coordina el ingreso del vehículo o los muebles al taller.\n' +
      'Esta cotización no representa una reserva de cupo.'
  );
}

// Debe correr (y terminar) una sola vez al arrancar, antes de aceptar
// peticiones -- ver index.js.
async function init() {
  exec(SCHEMA_SQL);
  ensureColumn('leads', 'contact_ack_at', 'TEXT');
  // Semaforo de carga por asesor (ver server/routes/advisors.js): NULL =
  // "automatico" (se calcula solo desde cuantos leads vencidos tiene
  // encima); 'rojo'/'amarillo'/'verde' = forzado a mano por
  // coordinador/admin, que manda sobre el calculo automatico hasta que se
  // borre (vuelva a NULL).
  ensureColumn('advisors', 'manual_status_override', 'TEXT');
  // Direccion y correo del cliente: antes no se pedian en ningun formulario
  // (solo nombre/telefono/documento). Se agregan para el "pegar y
  // autocompletar" de Alta Rapida (ver ventas.js) -- viven en clients, no en
  // leads, porque son datos del contacto, no de un pedido puntual.
  ensureColumn('clients', 'address', 'TEXT');
  ensureColumn('clients', 'email', 'TEXT');
  // Enlace con Odoo (ver server/odoo.js): al crear un lead en el CRM tambien
  // se crea/deduplica el contacto y la oportunidad en Odoo, y al cotizar se
  // crea el sale.order. Guardamos esos ids para poder abrir/actualizar el
  // registro correcto despues (PDF, sincronizacion de vuelta). NULL = ese
  // lead nunca llego a Odoo (integracion apagada, o fallo puntual).
  ensureColumn('leads', 'odoo_partner_id', 'INTEGER');
  ensureColumn('leads', 'odoo_lead_id', 'INTEGER');
  ensureColumn('leads', 'odoo_order_id', 'INTEGER');
  // Dirección y correo directo en el lead (igual que ya vivía "document") --
  // para que la pestaña "Cotizar" pueda pedir los datos de una cotización
  // formal (NIT, dirección, correo) sin depender de que el lead tenga un
  // cliente vinculado en la tabla clients (ver ensureColumn('clients',
  // 'address'...) más abajo, que es el otro lugar donde ya vivían estos dos
  // campos para "Alta Rápida").
  ensureColumn('leads', 'address', 'TEXT');
  ensureColumn('leads', 'email', 'TEXT');
  ensureColumn('clients', 'odoo_partner_id', 'INTEGER');
  // Emparejamiento explicito asesor del CRM <-> usuario y equipo de ventas en
  // Odoo. El Odoo del equipo tiene nombres distintos ("HAROLD SAN JUAN LECHUGA",
  // equipo "HAROL SAN JUAN") a los del CRM ("Harol"), asi que adivinar por
  // nombre no sirve -- se guardan los ids resueltos (ver scripts/odoo-setup.js
  // y routes/advisors.js). NULL = caer al emparejamiento por nombre.
  ensureColumn('advisors', 'odoo_user_id', 'INTEGER');
  ensureColumn('advisors', 'odoo_team_id', 'INTEGER');
  // Descripción larga y descuento por línea de cotización (pestaña
  // "Cotizar", motor nativo) -- se agregan aparte de CREATE TABLE porque
  // quotation_lines ya puede tener filas de antes de este cambio.
  ensureColumn('quotation_lines', 'description', 'TEXT');
  ensureColumn('quotation_lines', 'discount_percent', 'REAL NOT NULL DEFAULT 0');
  // Descripción del producto en el catálogo propio -- se copia como valor
  // por defecto a la línea al elegirlo (el asesor la puede editar o borrar
  // ahí, sin afectar la ficha del producto).
  ensureColumn('products', 'description', 'TEXT');
  // Integración con Google Ads (ver server/googleAds.js): de dónde vino
  // cada mes de ad_spend ('manual' = lo tecleó alguien en Ajustes,
  // 'google_ads_api' = lo llenó la sincronización sola) -- la sync nunca
  // pisa un mes marcado 'manual', para no perder una corrección a mano.
  // gclid/google_ads_conversion_sent_at: para reportar la venta cerrada
  // como conversión offline a Google Ads (solo aplica a un lead que haya
  // llegado con ese parámetro; hoy nada en el CRM lo captura todavía --
  // queda listo para cuando exista esa fuente, ej. una landing page).
  ensureColumn('ad_spend', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn('leads', 'gclid', 'TEXT');
  ensureColumn('leads', 'google_ads_conversion_sent_at', 'TEXT');
  // Rediseño de Cotizaciones sobre el concepto de Velara: cada cotización
  // queda ligada a un servicio (server/velaraServices.js) y guarda sus
  // campos propios (marca/modelo/año del vehículo, material, color, etc.)
  // como JSON -- son distintos por servicio, no tiene sentido una columna
  // por campo. Ver también ensureQuotationsStateCheck() arriba (estados
  // 'seguimiento'/'aprobada' nuevos).
  ensureColumn('quotations', 'service_slug', 'TEXT');
  ensureColumn('quotations', 'service_fields', 'TEXT');
  ensureReportsTypeCheck();
  ensureQuotationsStateCheck();
  exec(ERP_SCHEMA_SQL);
  // Medio de pago de cada abono de cliente (efectivo, transferencia...),
  // para que Caja cuadre por medio. NULL en abonos viejos = sin dato.
  ensureColumn('payments', 'method', 'TEXT');
  // Garantía (meses desde la entrega; se copia del ajuste general al crear
  // la orden) y factura electrónica: por ahora se emite a mano en el
  // facturador gratuito de la DIAN y aquí solo se anota el número/CUFE.
  ensureColumn('work_orders', 'warranty_months', 'INTEGER NOT NULL DEFAULT 6');
  ensureColumn('work_orders', 'invoice_number', 'TEXT');
  ensureColumn('work_orders', 'invoice_cufe', 'TEXT');
  ensureColumn('work_orders', 'received_by', 'TEXT');
  // Producción (ver PRODUCTION_SCHEMA_SQL): rol nuevo + tablas + las
  // garantías pasan a colgar de la OP (work_order_id queda para las viejas).
  ensureUsersRoleCheck();
  exec(PRODUCTION_SCHEMA_SQL);
  ensureColumn('warranty_claims', 'production_order_id', 'INTEGER REFERENCES production_orders(id)');
  ensureWarrantyClaimsNullable();
  exec(INVOICE_SCHEMA_SQL);
  // Pago de una factura de compra registrado como egreso de Caja.
  ensureColumn('cash_entries', 'invoice_id', 'INTEGER REFERENCES invoices(id)');
  // Finanzas: cuentas, traslados y gastos fijos; cada movimiento sabe de qué
  // cuenta salió/entró y, si aplica, a qué trabajo (ganancia por trabajo) u
  // operario (pagos al taller) corresponde, y puede llevar foto del recibo.
  exec(FINANCE_SCHEMA_SQL);
  ensureColumn('cash_entries', 'account_id', 'INTEGER REFERENCES accounts(id)');
  ensureColumn('cash_entries', 'work_order_id', 'INTEGER REFERENCES work_orders(id)');
  ensureColumn('cash_entries', 'worker_id', 'INTEGER REFERENCES workers(id)');
  ensureColumn('cash_entries', 'recurring_id', 'INTEGER REFERENCES recurring_expenses(id)');
  ensureColumn('cash_entries', 'receipt_path', 'TEXT');
  ensureColumn('cash_entries', 'receipt_mime', 'TEXT');
  ensureColumn('payments', 'account_id', 'INTEGER REFERENCES accounts(id)');
  ensureColumn('payments', 'work_order_id', 'INTEGER REFERENCES work_orders(id)');
  // Trabajos (server/routes/jobs.js): pago acordado al operario por el
  // trabajo, dirección de instalación y motivo si se cancela.
  ensureColumn('work_orders', 'labor_cost', 'REAL NOT NULL DEFAULT 0');
  // Ventas (embudo): por qué se perdió una venta y el próximo paso con fecha
  // ("llamar el jueves"), que aparece en los pendientes del día.
  ensureColumn('leads', 'lost_reason', 'TEXT');
  ensureColumn('leads', 'next_action_at', 'TEXT');
  ensureColumn('leads', 'next_action_note', 'TEXT');
  // Velara es un negocio nuevo con clientes de todos los canales: los
  // reportes y listas cuentan todos los leads, no solo los de Google Ads
  // (era un filtro del negocio anterior).
  exec('DROP VIEW IF EXISTS leads_visible; CREATE VIEW leads_visible AS SELECT * FROM leads;');
  ensureColumn('work_orders', 'address', 'TEXT');
  ensureColumn('work_orders', 'cancel_reason', 'TEXT');
  await seedAccounts();
  await backfillAccounts();
  await seedIfEmpty();
  await seedQuoteDefaults();
}

module.exports = { db, getSetting, setSetting, DEFAULT_ADVISORS, DATA_DIR, init };
