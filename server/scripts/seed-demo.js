// Llena una base de DEMOSTRACIÓN con ~7 meses de vida de VELARA: clientes
// que escriben por WhatsApp, cotizaciones, ventas ganadas y perdidas,
// trabajos del taller en todas las etapas, abonos, pagos a operarios,
// compras de material, gastos fijos, traslados y retiros del dueño. Sirve
// para ver cómo se ven Inicio, Ventas, Trabajos, Finanzas e Inventario con
// el negocio andando.
//
// Uso (desde velara-crm/):  iniciar_demo.bat
//   o a mano:  set NOVA_DATA_DIR=server\data-demo && node server\scripts\seed-demo.js
//
// NUNCA corre contra la base real (server/data): exige NOVA_DATA_DIR y que
// esa base no tenga ventas. Para volver a generarla, borra la carpeta
// server/data-demo. Inserta directo en SQLite con fechas del pasado (por la
// API todo quedaría con fecha de hoy).

const path = require('path');

const dataDir = process.env.NOVA_DATA_DIR ? path.resolve(process.env.NOVA_DATA_DIR) : null;
if (!dataDir || dataDir === path.resolve(__dirname, '..', 'data')) {
  console.error('Este script solo llena una base de demostración. Define NOVA_DATA_DIR (ej. server\\data-demo).');
  process.exit(1);
}

const { db, init } = require('../db');
const { findService } = require('../velaraServices');

// ---- azar repetible (siempre sale la misma demo) -------------------------------------------
let seed = 20261008;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const chance = (p) => rand() < p;
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [item, w] of pairs) {
    if ((r -= w) < 0) return item;
  }
  return pairs[pairs.length - 1][0];
}
const roundTo = (n, step) => Math.round(n / step) * step;

// ---- fechas: todo se piensa en hora de Colombia (UTC-5) ------------------------------------
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso, n) => new Date(dayMs(iso) + n * DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((dayMs(a) - dayMs(b)) / DAY);
// Fecha local + hora local -> texto UTC como lo guarda el CRM.
function utc(isoDate, hour = 10, minute = 0) {
  const d = new Date(dayMs(isoDate) + (hour + 5) * 3600000 + minute * 60000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
const workHour = () => [randInt(8, 17), randInt(0, 59)];
const isSunday = (iso) => new Date(dayMs(iso)).getUTCDay() === 0;
const workday = (iso) => (isSunday(iso) ? addDays(iso, 1) : iso);
const START = `${addDays(TODAY, -215).slice(0, 7)}-02`; // ~7 meses atrás
const past = (iso) => iso <= TODAY;

// ---- catálogos ------------------------------------------------------------------------------
const FIRST = ['Andrea', 'Carlos', 'María', 'Juan', 'Laura', 'Diego', 'Camila', 'Andrés', 'Valentina', 'Felipe', 'Daniela', 'Santiago', 'Paula', 'Jorge', 'Natalia', 'Julián', 'Sofía', 'Ricardo', 'Carolina', 'Óscar', 'Alejandra', 'Mauricio', 'Ximena', 'Hernán', 'Luisa', 'Fabián', 'Tatiana', 'Gustavo', 'Yolanda', 'Iván', 'Kelly', 'Wilmer', 'Yeison', 'Dayana', 'Elkin', 'Marlon', 'Shirley', 'Rafael', 'Lina', 'Álvaro'];
const LAST = ['Rodríguez', 'Gómez', 'García', 'Martínez', 'López', 'Hernández', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Vargas', 'Castro', 'Ortiz', 'Rojas', 'Moreno', 'Muñoz', 'Suárez', 'Pardo', 'Cárdenas', 'Barrios', 'De la Hoz', 'Charris', 'Mendoza', 'Polo', 'Ariza', 'Escorcia', 'Fontalvo', 'Navarro'];
const COMPANIES = ['Restaurante La Cueva del Mar', 'Panadería El Trigal', 'Ferretería El Tornillo', 'Droguería San Jorge', 'Taxis Costa Caribe', 'Colegio Los Ángeles', 'Heladería Polo Norte', 'Asadero Don Pepe', 'Lavautos La 72', 'Gimnasio Fit Zone', 'Hotel Prado Mar', 'Transportes Sabana S.A.S.', 'Café del Parque', 'Pizzería La Toscana'];
const CITIES = [['Barranquilla', 70], ['Soledad', 13], ['Puerto Colombia', 7], ['Malambo', 6], ['Galapa', 4]];
const STREETS = ['Calle', 'Carrera', 'Calle', 'Carrera', 'Diagonal'];
const CAR_MODELS = [['Chevrolet', ['Onix', 'Spark GT', 'Sail', 'Tracker', 'Captiva']], ['Renault', ['Duster', 'Logan', 'Sandero', 'Kwid', 'Stepway']], ['Mazda', ['2', '3', 'CX-30', 'CX-5']], ['Kia', ['Picanto', 'Rio', 'Sportage']], ['Toyota', ['Hilux', 'Fortuner', 'Corolla']], ['Nissan', ['March', 'Versa', 'Frontier']], ['Hyundai', ['Accent', 'Tucson', 'i10']]];
const MOTO_MODELS = { AKT: ['NKD 125', 'TT 150', 'CR4 125'], Bajaj: ['Boxer CT 100', 'Pulsar NS 200', 'Discover 125'], Yamaha: ['FZ 2.0', 'XTZ 150', 'NMAX'], Honda: ['CB 125F', 'XR 150L', 'Navi'], Suzuki: ['Gixxer 150', 'AX4'] };
const MATERIALS_TXT = ['Cuero sintético', 'Cuero sintético premium', 'Tela técnica', 'Cuerina', 'Cuero genuino'];
const COLORS = ['Negro', 'Negro', 'Gris', 'Beige', 'Café', 'Negro con costura roja', 'Negro y gris'];

const LOST_REASONS = [['Precio', 40], ['No respondió', 30], ['Se fue con otro taller', 12], ['Ya no lo necesita', 10], ['Tiempo de entrega', 8]];
const CHANNELS = [['Google Ads', 35], ['Orgánico', 35], ['Referido', 22], ['Otro', 8]];

// Cada servicio: cuánto pesa en la demanda, cómo se cotiza, qué material
// gasta (nombre, cantidad mín-máx) y cuántos días toma.
const SERVICE_PLAN = {
  'forros-para-carros': { weight: 30, days: [2, 5] },
  'tapizado-automotriz': { weight: 18, days: [4, 9] },
  'tapizado-de-motos': { weight: 24, days: [1, 2] },
  'carpas-para-negocio': { weight: 12, days: [5, 10] },
  forros: { weight: 16, days: [3, 7] },
};

function quoteFor(slug) {
  const mat = pick(MATERIALS_TXT);
  const color = pick(COLORS);
  if (slug === 'forros-para-carros') {
    const [marca, modelos] = pick(CAR_MODELS);
    const modelo = pick(modelos);
    const tipo = weighted([['Forro completo', 70], ['Solo delanteros', 20], ['Forro con espaldar acolchado', 10]]);
    const base = tipo === 'Solo delanteros' ? randInt(38, 55) : randInt(65, 120);
    const lines = [{ name: `${tipo} ${marca} ${modelo}`, desc: `${mat} ${color.toLowerCase()}, costura reforzada`, qty: 1, price: base * 10000 }];
    if (chance(0.35)) lines.push({ name: 'Forro para timón', desc: 'A juego con los forros', qty: 1, price: 45000 });
    if (chance(0.2)) lines.push({ name: 'Tapetes en vinilo', desc: 'Juego de 4', qty: 1, price: 120000 });
    return { fields: { marca, modelo, anio: String(randInt(2012, 2025)), tipo_forro: tipo, material: mat, color }, lines, use: [['cuero', 4, 8], ['espuma2', 1, 2], ['hilo', 1, 1], ['pegante', 0.3, 0.6]] };
  }
  if (slug === 'tapizado-automotriz') {
    const [marca, modelos] = pick(CAR_MODELS);
    const modelo = pick(modelos);
    const zona = weighted([['Sillas completas', 45], ['Techo', 20], ['Puertas y paneles', 15], ['Timón y palanca', 10], ['Interior completo', 10]]);
    const price = { 'Sillas completas': randInt(140, 260), Techo: randInt(55, 90), 'Puertas y paneles': randInt(60, 110), 'Timón y palanca': randInt(18, 35), 'Interior completo': randInt(320, 480) }[zona] * 10000;
    const lines = [{ name: `Tapizado ${zona.toLowerCase()} ${marca} ${modelo}`, desc: `${mat} ${color.toLowerCase()}`, qty: 1, price }];
    if (zona === 'Sillas completas' && chance(0.4)) lines.push({ name: 'Cambio de espuma', desc: 'Espuma de alta densidad', qty: 2, price: 120000 });
    const big = price > 1500000;
    return { fields: { marca, modelo, anio: String(randInt(2010, 2025)), zona, material: mat, color }, lines, use: [['cuero', big ? 10 : 4, big ? 16 : 9], ['espuma5', big ? 2 : 0.5, big ? 4 : 2], ['hilo', 1, 2], ['pegante', 0.5, 1.5], ['grapas', 150, 500]] };
  }
  if (slug === 'tapizado-de-motos') {
    const marca = pick(Object.keys(MOTO_MODELS));
    const modelo = pick(MOTO_MODELS[marca]);
    const tipo = weighted([['Biplaza', 70], ['Individual', 25], ['Baúl o maleta', 5]]);
    const lines = [{ name: `Tapizado sillín ${marca} ${modelo}`, desc: `${mat} ${color.toLowerCase()}, antideslizante`, qty: 1, price: randInt(12, 28) * 10000 }];
    if (chance(0.3)) lines.push({ name: 'Espuma ergonómica', desc: 'Relleno nuevo', qty: 1, price: 60000 });
    return { fields: { marca, modelo, anio: String(randInt(2015, 2025)), tipo_sillin: tipo, material: mat, color }, lines, use: [['cuero', 0.6, 1.2], ['hilo', 0.2, 0.3], ['grapas', 40, 90]] };
  }
  if (slug === 'carpas-para-negocio') {
    const tipo = weighted([['Toldo para fachada', 45], ['Carpa plegable', 35], ['Parasol / cubierta', 20]]);
    const w = randInt(2, 6);
    const h = randInt(2, 4);
    const lines = [{ name: `${tipo} ${w}m x ${h}m`, desc: 'Lona PVC blackout con estampado del logo', qty: 1, price: roundTo(w * h * randInt(85, 130) * 1000, 10000) }];
    if (tipo !== 'Carpa plegable') lines.push({ name: 'Instalación', desc: 'Incluye anclajes', qty: 1, price: randInt(15, 30) * 10000 });
    return { fields: { tipo, dimensiones: `${w}m x ${h}m`, material: 'Lona PVC', color: pick(['Blanco', 'Azul', 'Rojo', 'Verde', 'Negro']), ubicacion: 'Fachada del local' }, lines, use: [['lona', w * h * 1.1, w * h * 1.4], ['hilo', 1, 2], ['cierre', 0, 4]] };
  }
  const tipo = pick(['Juego de sala 3-2-1', 'Sofá cama', 'Sillas de comedor (6)', 'Silla de oficina', 'Butaco de barbería', 'Silla de peluquería', 'Cojines de terraza']);
  const lines = [{ name: `Forro / retapizado ${tipo.toLowerCase()}`, desc: `${mat} ${color.toLowerCase()}`, qty: 1, price: randInt(40, 150) * 10000 }];
  return { fields: { tipo_mueble: tipo, piezas: tipo.includes('(6)') ? '6 piezas' : tipo.includes('3-2-1') ? '3 piezas' : '1 pieza', material: mat, color }, lines, use: [['tela', 3, 9], ['espuma5', 1, 3], ['hilo', 1, 2], ['cierre', 2, 8], ['grapas', 100, 400]] };
}

// [clave, nombre, unidad, mínimo, costo]
const MATERIALS = [
  ['cuero', 'Cuero sintético premium negro', 'm', 15, 42000],
  ['cuero_gris', 'Cuero sintético premium gris', 'm', 8, 42000],
  ['tela', 'Tela técnica para tapicería', 'm', 10, 24000],
  ['espuma2', 'Espuma alta densidad 2 cm', 'm2', 6, 21000],
  ['espuma5', 'Espuma alta densidad 5 cm', 'm2', 6, 38000],
  ['lona', 'Lona PVC blackout', 'm2', 25, 16500],
  ['hilo', 'Hilo de nylon calibre 40', 'rollo', 5, 12000],
  ['pegante', 'Pegante de contacto', 'lt', 3, 32000],
  ['cierre', 'Cierre (cremallera) #5', 'und', 20, 1800],
  ['grapas', 'Grapas tapicería 10 mm', 'und', 800, 12],
];
const SUPPLIERS = [
  ['Distribuidora de Cueros del Caribe', '900456123-1', 'Marta Ruiz', '3015550101', ['cuero', 'cuero_gris', 'tela']],
  ['Espumas y Rellenos Atlántico', '901223344-5', 'Jairo Polo', '3045550202', ['espuma2', 'espuma5']],
  ['Lonas y Toldos de la Costa', '900778899-2', 'Ana Charris', '3005550303', ['lona']],
  ['Insumos de Tapicería El Hilo', '800112233-7', 'Pedro Ariza', '3105550404', ['hilo', 'pegante', 'cierre', 'grapas']],
];
const WORKERS = [
  ['Jhon Pérez', 'Costura y forros'],
  ['Luis Barrios', 'Tapicería automotriz, carpas e instalación'],
];
const FIXED = [
  ['Arriendo del local', 'Arriendo', 1800000, 5, 'banco'],
  ['Energía y agua', 'Servicios públicos', 340000, 15, 'banco'],
  ['Internet y celular', 'Servicios públicos', 125000, 18, 'digital'],
  ['Pauta en Google y redes', 'Publicidad', 600000, 2, 'digital'],
  ['Contador', 'Otros gastos', 300000, 28, 'digital'],
];

// Cuántos clientes escriben cada mes (el negocio va creciendo).
const LEADS_PER_MONTH = [14, 20, 27, 33, 39, 45, 51, 55];

// ---- inserciones ----------------------------------------------------------------------------
const q = (sql) => db.prepare(sql);
let accounts; // kind -> id
let materials; // clave -> { id, stock, cost }
let suppliersByMat; // clave -> supplier id
let workers; // [id]
const methodFor = { efectivo: 'efectivo', digital: 'nequi', banco: 'transferencia' };

async function cashEntry({ kind, category, amount, account, date, description, extra = {} }) {
  const [h, m] = workHour();
  const cols = ['kind', 'category', 'amount', 'method', 'description', 'entry_date', 'account_id', 'created_at', ...Object.keys(extra)];
  const vals = [kind, category, Math.round(amount), methodFor[account], description, date, accounts[account], utc(date, h, m), ...Object.values(extra)];
  await q(`INSERT INTO cash_entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
}

async function stockMove(key, type, qty, date, { unit_cost, work_order_id, note } = {}) {
  const mat = materials[key];
  mat.stock = Math.round((mat.stock + qty) * 1000) / 1000;
  if (type === 'entrada' && unit_cost) mat.cost = unit_cost;
  const [h, m] = workHour();
  await q('INSERT INTO stock_movements (material_id, type, qty, unit_cost, work_order_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').run(
    mat.id, type, qty, unit_cost || mat.cost, work_order_id || null, note || null, utc(date, h, m)
  );
}

let poCount = 0;
// Compra a cada proveedor lo que esté por debajo de lo que se va a necesitar.
async function restock(date, needed) {
  const bySupplier = {};
  for (const [key, , , min] of MATERIALS) {
    const target = Math.max(min * 2.5, (needed[key] || 0) * 1.3 + min);
    if (materials[key].stock < target) {
      const step = key === 'grapas' ? 1000 : key === 'cierre' ? 50 : 1;
      const qty = Math.ceil((target - materials[key].stock) / step) * step;
      (bySupplier[suppliersByMat[key]] = bySupplier[suppliersByMat[key]] || []).push([key, qty]);
    }
  }
  for (const [supplierId, lines] of Object.entries(bySupplier)) {
    poCount++;
    const number = `OC-${pad(poCount).padStart(4, '0')}`;
    const ordered = date;
    const received = addDays(date, randInt(1, 3));
    const isPending = !past(received);
    const priced = lines.map(([key, qty]) => {
      const base = MATERIALS.find((m) => m[0] === key)[4];
      return [key, qty, Math.round(base * (1 + (rand() - 0.4) * 0.08))];
    });
    const total = priced.reduce((s, [, qty, cost]) => s + qty * cost, 0);
    const po = await q(
      `INSERT INTO purchase_orders (number, supplier_id, status, expected_date, total, ordered_at, received_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(number, Number(supplierId), isPending ? 'pedida' : 'recibida', received, Math.round(total), utc(ordered, 9), isPending ? null : utc(received, 11), utc(ordered, 9), utc(isPending ? ordered : received, 11));
    const poId = po.lastInsertRowid;
    for (const [key, qty, cost] of priced) {
      await q('INSERT INTO purchase_order_lines (purchase_order_id, material_id, qty, unit_cost) VALUES (?, ?, ?, ?)').run(poId, materials[key].id, qty, cost);
      if (!isPending) await stockMove(key, 'entrada', qty, received, { unit_cost: cost, note: `Recibido ${number}` });
    }
    if (!isPending) {
      await cashEntry({
        kind: 'egreso', category: 'Compra de materiales', amount: total, account: total > 400000 ? 'banco' : 'digital', date: received,
        description: `Pago ${number}`, extra: { purchase_order_id: poId },
      });
    }
  }
}

// ---- simulación -----------------------------------------------------------------------------
async function main() {
  await init();
  const already = await q('SELECT COUNT(*) AS n FROM leads').get();
  if (already.n > 0) {
    console.error(`La base de ${dataDir} ya tiene ventas. Borra esa carpeta para generar la demo de nuevo.`);
    process.exit(1);
  }

  // Un solo asesor (el dueño): los otros del semillero quedan inactivos.
  const advisor = (await q('SELECT id FROM advisors ORDER BY priority_order LIMIT 1').get()).id;
  await q('UPDATE advisors SET active = 0 WHERE id != ?').run(advisor);

  accounts = {};
  for (const a of await q('SELECT id, kind FROM accounts').all()) accounts[a.kind] = accounts[a.kind] || a.id;

  materials = {};
  for (const [key, name, unit, min, cost] of MATERIALS) {
    const r = await q('INSERT INTO materials (name, unit, stock, min_stock, cost, created_at) VALUES (?, ?, 0, ?, ?, ?)').run(name, unit, min, cost, utc(START, 8));
    materials[key] = { id: r.lastInsertRowid, stock: 0, cost };
  }
  suppliersByMat = {};
  for (const [name, nit, contact, phone, mats] of SUPPLIERS) {
    const r = await q('INSERT INTO suppliers (name, nit, contact, phone, created_at) VALUES (?, ?, ?, ?, ?)').run(name, nit, contact, phone, utc(START, 8));
    for (const m of mats) suppliersByMat[m] = r.lastInsertRowid;
  }
  workers = [];
  for (const [name, specialty] of WORKERS) {
    workers.push((await q('INSERT INTO workers (name, specialty, created_at) VALUES (?, ?, ?)').run(name, specialty, utc(START, 8))).lastInsertRowid);
  }
  const fixed = [];
  for (const [name, category, amount, day, kind] of FIXED) {
    const r = await q('INSERT INTO recurring_expenses (name, category, amount, day_of_month, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(name, category, amount, day, accounts[kind], utc(START, 8));
    fixed.push({ id: r.lastInsertRowid, name, category, amount, day, kind });
  }

  // Capital inicial del dueño y primera compra grande de material.
  await cashEntry({ kind: 'ingreso', category: 'Aporte de socios', amount: 16000000, account: 'banco', date: START, description: 'Capital inicial para arrancar el taller' });
  await cashEntry({ kind: 'ingreso', category: 'Aporte de socios', amount: 1000000, account: 'efectivo', date: START, description: 'Base de caja' });
  await cashEntry({ kind: 'ingreso', category: 'Aporte de socios', amount: 1000000, account: 'digital', date: START, description: 'Base en Nequi' });
  await cashEntry({ kind: 'egreso', category: 'Herramientas y mantenimiento', amount: 4850000, account: 'banco', date: addDays(START, 1), description: 'Máquina de coser industrial, grapadora neumática y compresor' });
  await restock(addDays(START, 2), { cuero: 40, tela: 20, espuma5: 10, lona: 60 });

  // 1) Clientes y ventas mes a mes.
  const months = [];
  for (let d = START.slice(0, 7); d <= TODAY.slice(0, 7); ) {
    months.push(d);
    const [y, m] = d.split('-').map(Number);
    d = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  }
  const leads = [];
  months.forEach((month, i) => {
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    const firstDay = month === START.slice(0, 7) ? Number(START.slice(8)) + 3 : 1;
    const days = month === TODAY.slice(0, 7) ? Number(TODAY.slice(8)) : lastDay;
    const n = Math.round((LEADS_PER_MONTH[i] || 44) * ((days - firstDay + 1) / lastDay));
    for (let k = 0; k < n; k++) leads.push(workday(`${month}-${pad(randInt(firstDay, days))}`));
  });
  leads.sort();

  const jobs = [];
  let quoteSeq = 0;
  let clientsByPhone = new Map();
  const returning = [];
  for (const date of leads) {
    const age = diffDays(TODAY, date);
    // Algunos clientes vuelven (segundo carro, la moto, el toldo del negocio).
    let person;
    if (returning.length && chance(0.08)) person = pick(returning);
    else {
      const company = chance(0.18) ? pick(COMPANIES) : null;
      person = {
        name: company || `${pick(FIRST)} ${pick(LAST)}`,
        phone: `3${pick(['00', '01', '04', '05', '10', '12', '14', '15', '17', '18', '20', '22'])}${randInt(1000000, 9999999)}`,
        city: weighted(CITIES),
        company: !!company,
      };
      person.address = `${pick(STREETS)} ${randInt(1, 99)} # ${randInt(1, 80)}-${pad(randInt(1, 99))}, ${person.city}`;
    }
    const slug = person.company && chance(0.6) ? pick(['carpas-para-negocio', 'forros']) : weighted(Object.entries(SERVICE_PLAN).map(([s, p]) => [s, p.weight]));
    const svc = findService(slug);
    const channel = person.returning ? 'Referido' : weighted(CHANNELS);
    const source = weighted([['WhatsApp', 78], ['Llamada', 14], ['Correo', 4], ['Otro', 4]]);

    // ¿Hasta dónde llegó? Los viejos ya se cerraron; los recientes siguen vivos.
    let outcome;
    if (age > 20) outcome = weighted([['ganado', 46], ['perdido_cotizado', 30], ['perdido_sin_cotizar', 24], ['cotizado', age < 45 ? 8 : 0]]);
    else if (age > 7) outcome = weighted([['ganado', 45], ['perdido_cotizado', 15], ['perdido_sin_cotizar', 10], ['cotizado', 30], ['contactado', 10]]);
    else if (age > 2) outcome = weighted([['ganado', 30], ['cotizado', 30], ['contactado', 25], ['asignado', 15]]);
    else outcome = weighted([['asignado', 65], ['contactado', 35]]);

    const [h, mi] = workHour();
    const created = utc(date, h, mi);
    const contacted = outcome === 'asignado' ? null : utc(date, Math.min(h + randInt(0, 2), 19), randInt(0, 59));
    const quotedDate = ['asignado', 'contactado', 'perdido_sin_cotizar'].includes(outcome) ? null : workday(addDays(date, randInt(0, 2)));
    const quoted = quotedDate && past(quotedDate) ? quotedDate : quotedDate ? TODAY : null;
    let closedDate = null;
    if (outcome === 'ganado') closedDate = addDays(quoted, randInt(1, 8));
    if (outcome.startsWith('perdido')) closedDate = addDays(date, randInt(5, 18));
    if (closedDate && !past(closedDate)) closedDate = TODAY;

    let clientId = null;
    if (outcome === 'ganado') {
      const existing = clientsByPhone.get(person.phone);
      if (existing) clientId = existing;
      else {
        clientId = (await q('INSERT INTO clients (name, phone, address, created_at) VALUES (?, ?, ?, ?)').run(person.name, person.phone, person.address, created)).lastInsertRowid;
        clientsByPhone.set(person.phone, clientId);
      }
    }

    const quote = quoted ? quoteFor(slug) : null;
    const total = quote ? quote.lines.reduce((s, l) => s + l.qty * l.price, 0) : 0;
    const status = outcome === 'ganado' ? 'cerrado_ganado' : outcome.startsWith('perdido') ? 'cerrado_perdido' : outcome;
    let nextAt = null;
    let nextNote = null;
    if (['contactado', 'cotizado'].includes(status)) {
      nextAt = addDays(TODAY, randInt(-2, 4));
      nextNote = status === 'cotizado' ? pick(['Llamar para saber si aprobó', 'Enviar fotos de trabajos parecidos', 'Confirmar color del material', 'Recordarle que la cotización vence']) : pick(['Pedir fotos del vehículo', 'Agendar visita para medir', 'Enviar cotización', 'Preguntar modelo exacto']);
    }
    const followups = status === 'cotizado' ? randInt(0, 3) : outcome === 'perdido_cotizado' ? randInt(1, 3) : 0;

    const lead = await q(
      `INSERT INTO leads (client_name, phone, product, notes, status, assigned_advisor_id, amount, created_at, contacted_at, quoted_at, closed_at,
                          source, channel_detail, city, client_id, address, lost_reason, next_action_at, next_action_note, followup_count, last_followup_at, contact_ack_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      person.name, person.phone, svc.title,
      person.returning ? 'Cliente que vuelve' : null,
      status, advisor, outcome === 'ganado' ? total : 0, created, contacted,
      quoted ? utc(quoted, randInt(9, 17)) : null,
      closedDate ? utc(closedDate, randInt(9, 18)) : null,
      source, channel, person.city, clientId, person.address,
      status === 'cerrado_perdido' ? (outcome === 'perdido_sin_cotizar' ? pick(['No respondió', 'No respondió', 'Ya no lo necesita']) : weighted(LOST_REASONS)) : null,
      nextAt, nextNote, followups, followups ? utc(addDays(quoted, randInt(1, 3)), 11) : null, contacted
    );
    const leadId = lead.lastInsertRowid;
    if (outcome === 'ganado' && !person.returning) {
      person.returning = true;
      returning.push(person);
    }

    if (quote) {
      quoteSeq++;
      const state =
        outcome === 'ganado' ? 'sale' : outcome === 'perdido_cotizado' ? 'cancel' : weighted([['sent', 45], ['seguimiento', 40], ['aprobada', 15]]);
      const qr = await q(
        `INSERT INTO quotations (lead_id, number, state, validity_days, date_order, validity_date, amount_untaxed, amount_tax, amount_total, service_slug, service_fields, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 8, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)`
      ).run(leadId, `COT-${String(quoteSeq).padStart(4, '0')}`, state, utc(quoted, 10), addDays(quoted, 8), total, total, slug, JSON.stringify(quote.fields), utc(quoted, 10), utc(closedDate || quoted, 12));
      let pos = 0;
      for (const l of quote.lines) {
        await q('INSERT INTO quotation_lines (quotation_id, product_name, description, qty, price_unit, discount_percent, subtotal, position) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(
          qr.lastInsertRowid, l.name, l.desc, l.qty, l.price, l.qty * l.price, pos++
        );
      }
      if (outcome === 'ganado') {
        jobs.push({ leadId, quotationId: qr.lastInsertRowid, person, slug, quote, total, closed: closedDate });
      }
    }
  }

  // 2) Trabajos del taller, día por día, con su material, abonos y pago al operario.
  jobs.sort((a, b) => a.closed.localeCompare(b.closed));
  let otSeq = 0;
  const events = []; // [fecha, fn] para compras según lo que viene
  for (const job of jobs) {
    otSeq++;
    const plan = SERVICE_PLAN[job.slug];
    // Lo reciente hace fila en el taller: arranca más tarde y tarda más.
    const busy = diffDays(TODAY, job.closed) <= 14;
    const start = workday(addDays(job.closed, busy ? randInt(1, 5) : randInt(0, 3)));
    const ready = workday(addDays(start, Math.round(randInt(...plan.days) * (busy ? 1.6 : 1))));
    const delivered = workday(addDays(ready, randInt(0, 4)));
    const promised = addDays(start, plan.days[1] + 1);
    const cancelled = chance(0.03) && past(start);
    let stage = 'por_iniciar';
    if (past(start)) stage = 'en_proceso';
    if (past(ready)) stage = 'listo';
    if (past(delivered) && diffDays(TODAY, ready) > 3) stage = 'entregado';
    if (cancelled) stage = 'cancelada';
    const worker = job.slug === 'carpas-para-negocio' || job.slug === 'tapizado-automotriz' ? workers[chance(0.8) ? 1 : 0] : workers[chance(0.8) ? 0 : 1];
    const labor = roundTo(job.total * (randInt(16, 22) / 100), 5000);
    const description = job.quote.lines.map((l) => `${l.qty} × ${l.name} (${l.desc})`).join('\n');
    const svc = findService(job.slug);
    const wo = await q(
      `INSERT INTO work_orders (number, quotation_id, lead_id, client_name, phone, address, service_slug, service_fields, description, amount_total, stage, worker_id, labor_cost,
                                promised_date, started_at, ready_at, delivered_at, received_by, warranty_months, cancel_reason, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      `OT-${String(otSeq).padStart(4, '0')}`, job.quotationId, job.leadId, job.person.name, job.person.phone, job.person.address, job.slug, JSON.stringify(job.quote.fields),
      description, job.total, stage, worker, labor, promised,
      ['en_proceso', 'listo', 'entregado'].includes(stage) ? utc(start, 8, 30) : null,
      ['listo', 'entregado'].includes(stage) ? utc(ready, 16) : null,
      stage === 'entregado' ? utc(delivered, 17) : null,
      stage === 'entregado' ? job.person.name.split(' ')[0] : null,
      job.slug === 'carpas-para-negocio' ? 12 : 6,
      cancelled ? 'El cliente desistió antes de empezar' : null,
      utc(job.closed, 12), utc(job.closed, 12)
    );
    job.id = wo.lastInsertRowid;
    Object.assign(job, { start, ready, delivered, stage, worker, labor, svc });
  }

  // Línea de tiempo: compras al inicio de cada quincena según lo que se va a
  // gastar, y luego el material de cada trabajo el día que arranca.
  const halves = [];
  for (let d = addDays(START, 28); d <= TODAY; d = addDays(d, 30)) halves.push(d);
  const consumption = [];
  for (const job of jobs) {
    if (!['en_proceso', 'listo', 'entregado'].includes(job.stage)) continue;
    for (const [key0, min, max] of job.quote.use) {
      const key = key0 === 'cuero' && /gris/i.test(job.quote.fields.color || '') ? 'cuero_gris' : key0;
      let qty = min + rand() * (max - min);
      qty = key === 'grapas' || key === 'cierre' ? Math.round(qty) : Math.round(qty * 10) / 10;
      if (qty > 0) consumption.push({ date: job.start, key, qty, job });
    }
  }
  consumption.sort((a, b) => a.date.localeCompare(b.date));
  let ci = 0;
  for (const h of [...halves, addDays(TODAY, 1)]) {
    const until = addDays(h, 30);
    const needed = {};
    for (const c of consumption) if (c.date >= h && c.date < until) needed[c.key] = (needed[c.key] || 0) + c.qty;
    while (ci < consumption.length && consumption[ci].date < h) {
      const c = consumption[ci++];
      if (materials[c.key].stock < c.qty) await stockMove(c.key, 'entrada', Math.ceil(c.qty * 2), addDays(c.date, -1), { note: 'Compra de urgencia en almacén' });
      await stockMove(c.key, 'consumo', -c.qty, c.date, { work_order_id: c.job.id, note: c.job.svc.title });
    }
    if (h <= TODAY) await restock(h, needed);
  }

  // Abonos del cliente, pago al operario y gastos ligados a cada trabajo.
  const pendingBalance = new Set();
  for (const job of jobs) {
    if (job.stage === 'cancelada') continue;
    const acc = () => weighted([['efectivo', 35], ['digital', 40], ['banco', 25]]);
    const deposit = roundTo(job.total * (job.total > 1500000 ? 0.5 : weighted([[0.5, 60], [1, 25], [0.6, 15]])), 10000);
    await q('INSERT INTO payments (lead_id, amount, paid_at, notes, registered_by, method, account_id, work_order_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)').run(
      job.leadId, Math.min(deposit, job.total), utc(job.closed, 11), deposit >= job.total ? 'Pago total' : 'Anticipo', ...(() => { const a = acc(); return [methodFor[a], accounts[a]]; })(), job.id, utc(job.closed, 11)
    );
    const rest = job.total - Math.min(deposit, job.total);
    if (rest > 0 && job.stage === 'entregado') {
      // Unos pocos quedan debiendo un saldo después de entregar.
      if (diffDays(TODAY, job.delivered) < 45 && chance(0.18)) pendingBalance.add(job.id);
      else {
        const a = acc();
        await q('INSERT INTO payments (lead_id, amount, paid_at, notes, registered_by, method, account_id, work_order_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)').run(
          job.leadId, rest, utc(job.delivered, 17), 'Saldo contra entrega', methodFor[a], accounts[a], job.id, utc(job.delivered, 17)
        );
      }
    }
    if (job.stage === 'entregado' && !(diffDays(TODAY, job.delivered) < 6 && chance(0.5))) {
      const payDay = workday(addDays(job.delivered, (6 - new Date(dayMs(job.delivered)).getUTCDay() + 7) % 7)); // el sábado
      if (past(payDay)) {
        await cashEntry({
          kind: 'egreso', category: 'Nómina y pagos a operarios', amount: job.labor, account: chance(0.6) ? 'efectivo' : 'digital', date: payDay,
          description: `Pago ${job.svc.title.toLowerCase()} · ${job.person.name}`, extra: { work_order_id: job.id, worker_id: job.worker },
        });
      }
    }
    if (job.slug === 'carpas-para-negocio' && ['listo', 'entregado'].includes(job.stage)) {
      await cashEntry({ kind: 'egreso', category: 'Transporte y domicilios', amount: randInt(4, 9) * 10000, account: 'efectivo', date: job.delivered > TODAY ? job.ready : job.delivered, description: `Transporte e instalación carpa · ${job.person.name}`, extra: { work_order_id: job.id } });
    }
  }

  // 3) Gastos del mes: fijos, pequeños del día a día, traslados y retiros.
  const transferDays = [];
  for (const month of months) {
    for (const f of fixed) {
      const due = `${month}-${pad(f.day)}`;
      if (due < START || !past(due)) continue;
      await cashEntry({ kind: 'egreso', category: f.category, amount: f.category === 'Servicios públicos' && f.kind === 'banco' ? roundTo(f.amount * (0.85 + rand() * 0.3), 1000) : f.amount, account: f.kind, date: workday(due), description: f.name, extra: { recurring_id: f.id } });
    }
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    const smalls = [
      ['Alimentación y cafetería', 'Tinto, agua y refrigerios del taller', 25000, 60000, 4],
      ['Transporte y domicilios', 'Domicilio de material', 12000, 35000, 3],
      ['Herramientas y mantenimiento', 'Agujas, cuchillas y repuestos de máquina', 30000, 120000, 1],
      ['Comisiones y gastos bancarios', 'Cuota de manejo y 4x1000', 18000, 45000, 1],
    ];
    for (const [cat, desc, min, max, times] of smalls) {
      for (let t = 0; t < times; t++) {
        const d = workday(`${month}-${pad(randInt(1, lastDay))}`);
        if (d < START || !past(d)) continue;
        await cashEntry({ kind: 'egreso', category: cat, amount: roundTo(randInt(min, max), 1000), account: cat.startsWith('Comisiones') ? 'banco' : 'efectivo', date: d, description: desc });
      }
    }
    // Días de consignar (se hacen al final, ya con todos los movimientos).
    for (const day of [15, Math.min(lastDay, 29)]) {
      const d = workday(`${month}-${pad(day)}`);
      if (d >= addDays(START, 10) && past(d)) transferDays.push(d);
    }
    // El dueño empieza a sacar sueldo cuando el negocio se sostiene.
    const idx = months.indexOf(month);
    const payday = workday(`${month}-${pad(Math.min(lastDay, 30))}`);
    if (idx >= 3 && past(payday)) {
      await cashEntry({ kind: 'egreso', category: 'Retiro del dueño', amount: idx >= 5 ? 2500000 : 1500000, account: 'banco', date: payday, description: 'Sueldo del dueño' });
    }
  }
  // Saldo de una cuenta al cierre de un día.
  async function balanceOn(account, d) {
    const id = accounts[account];
    const r = await q(
      `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE account_id = ? AND date(paid_at, '-5 hours') <= ?), 0)
            + COALESCE((SELECT SUM(CASE kind WHEN 'ingreso' THEN amount ELSE -amount END) FROM cash_entries WHERE account_id = ? AND entry_date <= ?), 0)
            - COALESCE((SELECT SUM(amount) FROM account_transfers WHERE from_account_id = ? AND transfer_date <= ?), 0)
            + COALESCE((SELECT SUM(amount) FROM account_transfers WHERE to_account_id = ? AND transfer_date <= ?), 0) AS bal`
    ).get(id, d, id, d, id, d, id, d);
    return Number(r.bal) || 0;
  }
  // Mínimo que tendrá la cuenta de ese día en adelante (para no dejarla en rojo).
  async function lowestFrom(account, d) {
    let low = await balanceOn(account, d);
    for (let x = addDays(d, 1); x <= TODAY; x = addDays(x, 1)) low = Math.min(low, await balanceOn(account, x));
    return low;
  }
  // Consignar al banco el efectivo y lo de Nequi que sobra, dejando una base.
  for (const d of transferDays) {
    for (const [from, keep] of [['efectivo', 500000], ['digital', 1500000]]) {
      const amount = roundTo(Math.min(await balanceOn(from, d), await lowestFrom(from, d)) - keep, 50000);
      if (amount > 200000) {
        await q('INSERT INTO account_transfers (from_account_id, to_account_id, amount, transfer_date, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)').run(
          accounts[from], accounts.banco, amount, d, from === 'efectivo' ? 'Consignación del efectivo' : 'Paso de Nequi al banco', utc(d, 16)
        );
      }
    }
  }
  await cashEntry({ kind: 'ingreso', category: 'Otros ingresos', amount: 180000, account: 'efectivo', date: workday(addDays(START, 120)), description: 'Venta de retazos de cuero' });

  // El saldo de cada material queda igual a la suma de sus movimientos.
  for (const m of Object.values(materials)) await q("UPDATE materials SET stock = ?, cost = ?, updated_at = datetime('now') WHERE id = ?").run(m.stock, m.cost, m.id);

  // 4) Garantías de un par de trabajos entregados.
  const delivered = jobs.filter((j) => j.stage === 'entregado');
  const w1 = delivered[Math.floor(delivered.length * 0.3)];
  const w2 = delivered[Math.floor(delivered.length * 0.75)];
  if (w1) await q("INSERT INTO warranty_claims (work_order_id, description, status, resolution, reported_at, resolved_at, created_by) VALUES (?, 'Se soltó una costura del espaldar', 'resuelto', 'Se recosió sin costo', ?, ?, NULL)").run(w1.id, utc(addDays(w1.delivered, 40), 10), utc(addDays(w1.delivered, 42), 15));
  if (w2) await q("INSERT INTO warranty_claims (work_order_id, description, status, reported_at, created_by) VALUES (?, 'El forro de la silla del conductor se arrugó', 'abierto', ?, NULL)").run(w2.id, utc(addDays(TODAY, -2), 10));

  // ---- resumen ----
  const count = async (sql) => (await q(sql).get()).n;
  console.log(`Demo creada en ${dataDir} (desde ${START} hasta ${TODAY}):`);
  console.log(`  ${await count('SELECT COUNT(*) AS n FROM leads')} clientes potenciales, ${await count("SELECT COUNT(*) AS n FROM leads WHERE status = 'cerrado_ganado'")} ventas ganadas`);
  console.log(`  ${await count('SELECT COUNT(*) AS n FROM quotations')} cotizaciones, ${await count('SELECT COUNT(*) AS n FROM work_orders')} trabajos`);
  for (const r of await q('SELECT stage, COUNT(*) AS n FROM work_orders GROUP BY stage').all()) console.log(`     ${r.stage}: ${r.n}`);
  console.log(`  ${await count('SELECT COUNT(*) AS n FROM payments')} abonos, ${await count('SELECT COUNT(*) AS n FROM cash_entries')} movimientos de caja, ${await count('SELECT COUNT(*) AS n FROM purchase_orders')} órdenes de compra`);
  console.log(`  ${pendingBalance.size} trabajos entregados con saldo por cobrar`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
