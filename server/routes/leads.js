const express = require('express');
const XLSX = require('xlsx');
const { db } = require('../db');
const sla = require('../sla');
const followup = require('../followup');
const odoo = require('../odoo');
const googleAds = require('../googleAds');
const nativeQuotes = require('../nativeQuotes');
const velaraServices = require('../velaraServices');
const erp = require('../erp');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Listados/exportaciones (lo que arma pantallas como Ventas, SLA,
// Seguimiento y Ventas Cerradas) leen de "leads_visible" -- solo Google Ads,
// ver la vista en db.js -- para que el lote historico importado de Odoo (y
// cualquier lead futuro que no sea de Ads) no aparezca ahi. Las acciones
// sobre UN lead puntual por id (abrir/editar/marcar contactado-cotizado-
// cerrado/reasignar) siguen leyendo "leads" sin filtrar: si alguien ya tiene
// el id (ej. desde la ficha de un cliente, que tampoco filtra), la accion
// debe seguir funcionando igual.
//
// Un asesor solo puede operar sobre sus propios leads; coordinador y admin
// operan sobre cualquiera. Se usa en las acciones de un solo lead (marcar
// contactado/cotizado, cerrar) donde un asesor sigue teniendo permiso, pero
// solo sobre lo suyo.
function canOperateOn(user, lead) {
  if (user.role !== 'asesor') return true;
  return lead.assigned_advisor_id === user.advisor_id;
}

// Corregir datos basicos (nombre, telefono, producto, referencia, fecha de
// registro) de un lead propio: un asesor puede hacerlo mientras el lead siga
// activo, igual que ya puede contactar/cotizar/cerrar lo suyo. Una vez
// cerrado (cerrado_ganado/perdido) el registro pasa a ser un dato financiero
// de reporte -- ahi solo coordinador/admin editan (ver /amount y
// /closed-at), para no dejar que una venta ya cerrada se altere sin control.
function canEditLead(user, lead) {
  if (!canOperateOn(user, lead)) return false;
  if (user.role === 'asesor' && lead.status.startsWith('cerrado')) return false;
  return true;
}

// Reasignar sigue siendo cosa de coordinador/admin en el dia a dia normal --
// pero un lead propio que ya se vencio (>24h sin contacto/cotizacion) el
// asesor puede pasarlo el mismo a otro companero en vez de esperar a que
// alguien mas lo note. No aplica a un lead a tiempo o en riesgo (<24h): esa
// reasignacion temprana la sigue decidiendo coordinador/admin.
function canReassignLead(user, lead) {
  if (user.role !== 'asesor') return true;
  if (!canOperateOn(user, lead)) return false;
  return sla.slaStatus(lead) === 'vencido';
}

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Colombia es UTC-5 todo el año (sin horario de verano). El resto del
// sistema guarda todo en UTC (ver sla.js), asi que una fecha/hora que el
// usuario escribe a mano (hora de Colombia, para registrar algo atrasado)
// se convierte sumando 5h, sin depender de la zona horaria del servidor.
const COLOMBIA_UTC_OFFSET_HOURS = 5;

/**
 * Convierte un datetime-local del navegador ("YYYY-MM-DDTHH:MM" u
 * opcionalmente con segundos) a "YYYY-MM-DD HH:MM:SS" UTC. Devuelve null si
 * value es vacio/ausente (para poder usar "no vino nada, usa ahora"), y
 * lanza un Error legible si vino algo pero no es una fecha valida.
 */
function parseBackdatedInput(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().replace('T', ' ');
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (!m) throw new Error('Fecha inválida');
  const [, y, mo, d, h, mi, s] = m;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) + COLOMBIA_UTC_OFFSET_HOURS, Number(mi), Number(s || 0));
  const dt = new Date(utcMs);
  if (Number.isNaN(dt.getTime())) throw new Error('Fecha inválida');
  if (dt.getTime() > Date.now() + 60000) throw new Error('La fecha no puede ser en el futuro');
  return dt.toISOString().replace('T', ' ').slice(0, 19);
}

function predictLeadScore(lead, advisorRate = 0) {
  if (!lead) return 0;
  if (lead.status === 'cerrado_ganado') return 100;
  if (lead.status === 'cerrado_perdido') return 5;

  let score = 20;
  if (lead.status === 'contactado') score = 45;
  else if (lead.status === 'cotizado') score = 70;
  else if (lead.status === 'asignado') score = 30;

  const sourceBonus = {
    WhatsApp: 8,
    Correo: 6,
    Llamada: 10,
    Otro: 4,
  };
  score += sourceBonus[lead.source] || 0;

  if (lead.product === 'Carpas') score += 5;
  if (lead.product === 'Gramas') score += 3;
  if (lead.product === 'Baby Gym') score += 4;

  if (lead.followup_count >= 2) score += 6;
  if (lead.reassigned_count > 0) score -= Math.min(10, lead.reassigned_count * 4);
  if (lead.amount && lead.amount >= 1000000) score += 5;

  if (lead.created_at) {
    const created = new Date(lead.created_at.replace(' ', 'T') + 'Z');
    const ageDays = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
    if (ageDays <= 2 && lead.status === 'asignado') score += 8;
    if (ageDays > 7 && lead.status === 'asignado') score -= 8;
    if (ageDays > 14 && lead.status === 'contactado') score -= 4;
  }

  score += Math.round(Math.max(0, Math.min(1, advisorRate)) * 20);
  score = Math.round(score);
  if (score < 5) score = 5;
  if (score > 95) score = 95;
  return score;
}

// ---------------------------------------------------------------------------
//  Sincronizacion con Odoo (ver server/odoo.js)
// ---------------------------------------------------------------------------
// Usuario + equipo de ventas en Odoo de un asesor del CRM. Prefiere los ids
// guardados en la fila del asesor (advisors.odoo_user_id / odoo_team_id, los
// deja scripts/odoo-setup.js); si no los tiene, cae al emparejamiento por
// nombre (solo sirve si el Odoo usa los mismos nombres que el CRM).
async function advisorOdooOwner(advisor) {
  if (!advisor || advisor.is_group) return {};
  let user_id = advisor.odoo_user_id || null;
  let team_id = advisor.odoo_team_id || null;
  if (!user_id) {
    try {
      user_id = await odoo.resolveSalesperson(advisor.name);
    } catch (e) {
      console.error('[odoo] no se pudo resolver el asesor', advisor.name, e.message);
    }
  }
  if (!team_id) {
    try {
      team_id = await odoo.resolveAdvisorTeam(advisor.name);
    } catch (e) {
      /* best-effort */
    }
  }
  return { user_id: user_id || undefined, team_id: team_id || undefined };
}

// Crea/deduplica el contacto y crea la oportunidad en Odoo para un lead del
// CRM, y guarda los ids resultantes en la fila del lead. Best-effort: si Odoo
// falla, el lead ya quedo creado en el CRM y esto solo lo deja sin enlazar
// (se puede reintentar despues, ej. al cotizar).
async function syncLeadToOdoo(leadId) {
  if (!odoo.isEnabled()) return { synced: false, skipped: true };
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead) return { synced: false };
  if (lead.odoo_lead_id) return { synced: true, already: true };
  const client = lead.client_id
    ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(lead.client_id)
    : null;
  const advisor = lead.assigned_advisor_id
    ? await db.prepare('SELECT * FROM advisors WHERE id = ?').get(lead.assigned_advisor_id)
    : null;
  try {
    const partner = await odoo.findOrCreatePartner({
      name: lead.client_name,
      phone: lead.phone,
      email: (client && client.email) || null,
      vat: lead.document || (client && client.document) || null,
      city: lead.city || null,
      street: (client && client.address) || null,
    });
    const owner = await advisorOdooOwner(advisor);
    const odooLeadId = await odoo.createLead({
      name: `${lead.product || 'Oportunidad'} - ${lead.client_name}`,
      partner_id: partner.id,
      phone: lead.phone,
      email: (client && client.email) || null,
      description: lead.notes || null,
      city: lead.city || null,
      user_id: owner.user_id,
      team_id: owner.team_id,
    });
    await db
      .prepare('UPDATE leads SET odoo_partner_id = ?, odoo_lead_id = ? WHERE id = ?')
      .run(partner.id, odooLeadId, leadId);
    if (client && !client.odoo_partner_id) {
      await db.prepare('UPDATE clients SET odoo_partner_id = ? WHERE id = ?').run(partner.id, client.id);
    }
    return { synced: true, partner_id: partner.id, odoo_lead_id: odooLeadId, partner_created: partner.created };
  } catch (err) {
    console.error(`[odoo] lead ${leadId} no sincronizado:`, err.message);
    return { synced: false, error: err.message };
  }
}

// Mantener el pipeline de Odoo al dia con el embudo Nova. Best-effort: el CRM
// es la fuente de verdad del embudo, asi que un fallo aqui se registra y se
// ignora (no rompe la accion del asesor).
async function pushOdooStage(lead, stageKey) {
  if (!odoo.isEnabled() || !lead || !lead.odoo_lead_id) return;
  try {
    await odoo.moveOpportunityStage(lead.odoo_lead_id, stageKey);
  } catch (err) {
    console.error(`[odoo] lead ${lead.id}: no se movio la etapa a "${stageKey}":`, err.message);
  }
}

// Al editar los datos de un lead ya sincronizado (ver "Editar" en el CRM),
// llevar notas y ciudad a la oportunidad en Odoo -- si no, quedaban pegadas
// en el CRM porque syncLeadToOdoo solo escribe una vez, al crear. Best-effort.
async function pushOdooDetails(lead) {
  if (!odoo.isEnabled() || !lead || !lead.odoo_lead_id) return;
  try {
    await odoo.updateOpportunityDetails(lead.odoo_lead_id, { description: lead.notes, city: lead.city });
  } catch (err) {
    console.error(`[odoo] lead ${lead.id}: no se actualizaron notas/ciudad:`, err.message);
  }
}

// Al asignar/reasignar un lead a otro asesor en el CRM, mover la oportunidad
// en Odoo al vendedor + equipo de ese asesor. Best-effort.
async function pushOdooOwner(lead, advisor) {
  if (!odoo.isEnabled() || !lead || !lead.odoo_lead_id || !advisor) return;
  try {
    const owner = await advisorOdooOwner(advisor);
    await odoo.setOpportunityOwner(lead.odoo_lead_id, owner);
  } catch (err) {
    console.error(`[odoo] lead ${lead.id}: no se pudo reasignar la oportunidad a "${advisor.name}":`, err.message);
  }
}

async function serialize(lead, advisorRate = 0, advisorsById = null) {
  // advisorsById permite pasar un Map pre-cargado (ver GET '/' abajo) para
  // evitar una consulta a advisors POR CADA lead: con Postgres remoto, N
  // leads en Promise.all significan N conexiones simultaneas pidiendose al
  // pool (10 por defecto) -- con cientos/miles de leads eso agota el pool y
  // el resto de la app empieza a fallar con "timeout exceeded when trying
  // to connect". Sin advisorsById (casos de un solo lead) se resuelve como
  // antes, con una consulta individual.
  const advisor = lead.assigned_advisor_id
    ? advisorsById
      ? advisorsById.get(lead.assigned_advisor_id) || null
      : await db.prepare('SELECT id, name, is_group FROM advisors WHERE id = ?').get(lead.assigned_advisor_id)
    : null;
  return {
    ...lead,
    advisor_name: advisor ? advisor.name : null,
    sla_status: sla.slaStatus(lead),
    sla_reason: sla.slaReason(lead),
    elapsed_label: lead.status.startsWith('cerrado')
      ? sla.formatElapsed(lead.created_at, sla.parseUtc(lead.closed_at || lead.created_at))
      : sla.formatElapsed(lead.created_at),
    remaining_label: lead.status.startsWith('cerrado') ? null : sla.remainingLabel(lead),
    followup_status: followup.followupStatus(lead),
    followup_elapsed_label: followup.followupElapsedLabel(lead),
    predicted_score: predictLeadScore(lead, advisorRate),
  };
}

// Compartido entre GET / (listado en pantalla) y GET /xlsx (exportar lo
// mismo que se esta viendo): mismos filtros, mismo criterio de permisos.
function buildLeadFilters(query, user) {
  const { status, advisor_id, product, source, channel_detail, city, from, to, closed_from, closed_to, q, paid_only } = query;

  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (q && q.trim()) {
    const term = q.trim();
    const like = `%${term}%`;
    if (/^\d+$/.test(term)) {
      conditions.push('(id = ? OR client_name LIKE ? OR phone LIKE ? OR document LIKE ?)');
      params.push(Number(term), like, like, like);
    } else {
      conditions.push('(client_name LIKE ? OR phone LIKE ? OR document LIKE ?)');
      params.push(like, like, like);
    }
  }
  if (user.role === 'asesor') {
    // Un asesor solo ve lo suyo, sin importar que filtro le manden desde el
    // cliente: se ignora cualquier advisor_id ajeno en vez de confiar en el.
    conditions.push('assigned_advisor_id = ?');
    params.push(user.advisor_id);
  } else if (advisor_id) {
    conditions.push('assigned_advisor_id = ?');
    params.push(Number(advisor_id));
  }
  if (product) {
    conditions.push('product = ?');
    params.push(product);
  }
  if (source) {
    conditions.push('source = ?');
    params.push(source);
  }
  if (channel_detail) {
    conditions.push('channel_detail = ?');
    params.push(channel_detail);
  }
  if (city) {
    conditions.push('city = ?');
    params.push(city);
  }
  if (from) {
    conditions.push('created_at >= ?');
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push('created_at <= ?');
    params.push(`${to} 23:59:59`);
  }
  // Rango sobre closed_at, aparte de from/to (creado): para reportes de
  // ventas concretadas (Ventas Cerradas) el rango que importa es cuando se
  // cerro, no cuando entro el lead -- distinto criterio del que ya usan
  // from/to en Registro Operativo/SLA/Seguimiento (esos si son por creacion).
  if (closed_from) {
    conditions.push('closed_at >= ?');
    params.push(`${closed_from} 00:00:00`);
  }
  if (closed_to) {
    conditions.push('closed_at <= ?');
    params.push(`${closed_to} 23:59:59`);
  }
  // Una venta cerrada pasa primero por "S0..." (cotizacion confirmada en
  // Odoo) y solo se vuelve "PED ..." cuando de verdad entra como pedido
  // facturado/pagado -- paid_only filtra a esas, dejando afuera las que se
  // cerraron en el sistema pero cuya referencia todavia es solo la cotizacion.
  if (paid_only === '1') {
    conditions.push("sale_reference LIKE 'PED%'");
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

router.get('/', async (req, res) => {
  const { critical_only, followup_only } = req.query;
  const { where, params } = buildLeadFilters(req.query, req.user);

  const advisorStats = await db
    .prepare(`
      SELECT assigned_advisor_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'cerrado_ganado' THEN 1 ELSE 0 END) AS won
      FROM leads_visible
      WHERE assigned_advisor_id IS NOT NULL
      GROUP BY assigned_advisor_id
    `)
    .all();
  const advisorRates = new Map();
  let totalWon = 0;
  let totalLeads = 0;
  advisorStats.forEach((row) => {
    advisorRates.set(row.assigned_advisor_id, row.total ? row.won / row.total : 0);
    totalWon += row.won;
    totalLeads += row.total;
  });
  const avgAdvisorRate = totalLeads ? totalWon / totalLeads : 0.15;

  const rows = await db.prepare(`SELECT * FROM leads_visible ${where} ORDER BY created_at DESC`).all(...params);
  const advisorsById = new Map(
    (await db.prepare('SELECT id, name, is_group FROM advisors').all()).map((a) => [a.id, a])
  );
  let serialized = await Promise.all(
    rows.map((row) => serialize(row, advisorRates.get(row.assigned_advisor_id) ?? avgAdvisorRate, advisorsById))
  );
  if (critical_only === '1') {
    serialized = serialized.filter((l) => l.sla_status === 'riesgo' || l.sla_status === 'vencido');
  }
  if (followup_only === '1') {
    serialized = serialized.filter((l) => l.followup_status === 'pendiente' || l.followup_status === 'urgente');
  }
  res.json(serialized);
});

// Exporta exactamente lo que la tabla de Ventas esta mostrando: mismos
// filtros (asesor, estado, canal/origen, rango de fechas, busqueda) via
// buildLeadFilters, solo que en vez de paginar en pantalla arma un .xlsx
// para descargar (ej. "ventas cerradas de Google Ads del asesor X en abril").
router.get('/xlsx', async (req, res) => {
  const { where, params } = buildLeadFilters(req.query, req.user);
  const rows = await db.prepare(`SELECT * FROM leads_visible ${where} ORDER BY created_at DESC`).all(...params);
  const advisorsById = new Map((await db.prepare('SELECT id, name FROM advisors').all()).map((a) => [a.id, a]));
  const statusLabels = {
    asignado: 'Asignado',
    contactado: 'Contactado',
    cotizado: 'Cotizado',
    cerrado_ganado: 'Vendido',
    cerrado_perdido: 'Perdido',
  };

  const sheet = XLSX.utils.json_to_sheet(
    rows.map((l) => ({
      Cliente: l.client_name,
      Teléfono: l.phone || '',
      Documento: l.document || '',
      Asesor: l.assigned_advisor_id ? advisorsById.get(l.assigned_advisor_id)?.name || '' : 'Sin asignar',
      Producto: l.product || '',
      Canal: l.source || '',
      Origen: l.channel_detail || '',
      Ciudad: l.city || '',
      Estado: statusLabels[l.status] || l.status,
      Registrado: l.created_at,
      Contactado: l.contacted_at || '',
      Cotizado: l.quoted_at || '',
      Cerrado: l.closed_at || '',
      Monto: l.status === 'cerrado_ganado' ? l.amount || 0 : '',
      'Referencia de venta': l.sale_reference || '',
      Notas: l.notes || '',
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Leads');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = nowUtc().replace(/[:\s]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="ventas-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Exporta el reporte de Ventas Cerradas: mismos filtros que esa pantalla
// (asesor, rango sobre closed_at, "Solo Google Ads" via channel_detail,
// "Solo pagadas" via paid_only), pero en vez del detalle completo del lead
// solo trae cliente/referencia/monto (lo que hace falta para conciliar
// contra Google Ads o pasarle el numero al contador) con una fila de TOTAL
// al final.
const CERRADAS_COLUMNS = ['Cliente', 'Asesor', 'Producto', 'Origen', 'Referencia de venta', 'Total', 'Fecha de cierre'];
// Ancho por columna (en caracteres): Cliente y Referencia suelen ser largos,
// Origen/Total/Fecha son cortos -- sin esto Excel abre todo al ancho por
// defecto (~8.5) y el nombre del cliente queda cortado a simple vista.
const CERRADAS_COL_WIDTHS = [{ wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 }];
// Formato de celda de Excel (no texto): el valor sigue siendo un numero real
// -- se puede sumar/ordenar/filtrar -- pero Excel lo muestra con signo peso y
// separador de miles, igual que formatMoney() en el frontend.
const MONEY_FORMAT = '"$" #,##0';
const TOTAL_COL_LETTER = XLSX.utils.encode_col(CERRADAS_COLUMNS.indexOf('Total'));

router.get('/xlsx-cerradas', async (req, res) => {
  let rows;
  if (req.query.ids !== undefined) {
    // Viene de una busqueda activa en pantalla: la busqueda local de Ventas
    // Cerradas tambien mira producto/asesor/referencia (mas de lo que cubre
    // el "q" del backend, que solo mira client_name/phone/document), asi que
    // en vez de tratar de reproducir ese filtro en el servidor, el frontend
    // manda exactamente los IDs que esta mostrando y se exportan esos --
    // "lo que ves es lo que exportas" tambien mientras se busca.
    const idList = req.query.ids
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const conditions = ["status = 'cerrado_ganado'"];
    const params = [];
    if (idList.length) {
      conditions.push(`id IN (${idList.map(() => '?').join(',')})`);
      params.push(...idList);
    } else {
      conditions.push('1 = 0');
    }
    // Mismo limite que buildLeadFilters: un asesor solo exporta lo suyo, sin
    // importar que IDs le pida el cliente.
    if (req.user.role === 'asesor') {
      conditions.push('assigned_advisor_id = ?');
      params.push(req.user.advisor_id);
    }
    rows = await db.prepare(`SELECT * FROM leads_visible WHERE ${conditions.join(' AND ')} ORDER BY closed_at DESC`).all(...params);
  } else {
    const { where, params } = buildLeadFilters({ ...req.query, status: 'cerrado_ganado' }, req.user);
    rows = await db.prepare(`SELECT * FROM leads_visible ${where} ORDER BY closed_at DESC`).all(...params);
  }
  const advisorsById = new Map((await db.prepare('SELECT id, name FROM advisors').all()).map((a) => [a.id, a]));

  const data = rows.map((l) => ({
    Cliente: l.client_name,
    Asesor: l.assigned_advisor_id ? advisorsById.get(l.assigned_advisor_id)?.name || '' : 'Sin asignar',
    Producto: l.product || '',
    Origen: l.channel_detail || '',
    'Referencia de venta': l.sale_reference || '',
    Total: l.amount || 0,
    'Fecha de cierre': l.closed_at || '',
  }));

  // Encabezado escrito a mano (no inferido de las keys de `data`) para que
  // exista incluso si el filtro no trae ninguna venta -- si no, un resultado
  // vacio abriria un Excel sin columnas.
  const sheet = XLSX.utils.aoa_to_sheet([CERRADAS_COLUMNS]);
  XLSX.utils.sheet_add_json(sheet, data, { header: CERRADAS_COLUMNS, skipHeader: true, origin: -1 });
  sheet['!cols'] = CERRADAS_COL_WIDTHS;
  data.forEach((_, i) => {
    const cell = sheet[`${TOTAL_COL_LETTER}${i + 2}`];
    if (cell) cell.z = MONEY_FORMAT;
  });
  // Flechas de filtro de Excel sobre encabezado + filas de datos -- se fija
  // ANTES de anexar el TOTAL para que esa fila quede como pie de tabla,
  // fuera del rango filtrable (si no, un filtro la podria esconder, o Excel
  // la trataria como una venta mas).
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: CERRADAS_COLUMNS.length - 1 } }) };

  const total = rows.reduce((sum, l) => sum + (l.amount || 0), 0);
  const totalRow = data.length + 2; // fila siguiente a la ultima de datos (encabezado = fila 1)
  XLSX.utils.sheet_add_aoa(sheet, [['', '', '', '', 'TOTAL', total, '']], { origin: -1 });
  sheet[`${TOTAL_COL_LETTER}${totalRow}`].z = MONEY_FORMAT;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Ventas Cerradas');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = nowUtc().replace(/[:\s]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="ventas-cerradas-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Listado de cotizaciones/pedidos: todos los leads que tienen una sale.order
// en Odoo, enriquecidos con el estado en vivo (una sola llamada batch a Odoo).
// Alimenta la vista "Cotizaciones" del CRM. Un asesor solo ve las suyas.
router.get('/quotations', async (req, res) => {
  const conditions = ['odoo_order_id IS NOT NULL'];
  const params = [];
  if (req.user.role === 'asesor') {
    conditions.push('assigned_advisor_id = ?');
    params.push(req.user.advisor_id);
  }
  const rows = await db
    .prepare(`SELECT * FROM leads WHERE ${conditions.join(' AND ')} ORDER BY COALESCE(quoted_at, created_at) DESC`)
    .all(...params);
  const advisorsById = new Map((await db.prepare('SELECT id, name FROM advisors').all()).map((a) => [a.id, a]));

  let ordersById = new Map();
  let odooError = null;
  if (odoo.isEnabled() && rows.length) {
    try {
      const orderIds = [...new Set(rows.map((r) => r.odoo_order_id))];
      const orders = await odoo.callKw('sale.order', 'read', [
        orderIds,
        ['name', 'state', 'amount_total', 'amount_untaxed', 'amount_tax', 'invoice_status', 'validity_date'],
      ]);
      ordersById = new Map(orders.map((o) => [o.id, o]));
    } catch (err) {
      odooError = err.message;
    }
  }

  const quotations = rows.map((lead) => {
    const order = ordersById.get(lead.odoo_order_id) || null;
    return {
      lead_id: lead.id,
      client_name: lead.client_name,
      advisor_name: lead.assigned_advisor_id ? advisorsById.get(lead.assigned_advisor_id)?.name || null : null,
      product: lead.product || null,
      status: lead.status,
      sale_reference: lead.sale_reference,
      quoted_at: lead.quoted_at,
      odoo_order_id: lead.odoo_order_id,
      order_state: order ? order.state : null,
      order_state_label: order ? odoo.ORDER_STATE_LABELS[order.state] || order.state : null,
      amount_total: order ? order.amount_total : lead.amount || 0,
      amount_untaxed: order ? order.amount_untaxed : null,
      amount_tax: order ? order.amount_tax : null,
      validity_date: order ? order.validity_date : null,
    };
  });
  res.json({ quotations, odoo_error: odooError });
});

router.get('/:id', async (req, res) => {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para ver este lead' });
  const advisorStat = lead.assigned_advisor_id
    ? await db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'cerrado_ganado' THEN 1 ELSE 0 END) AS won FROM leads_visible WHERE assigned_advisor_id = ?`
        )
        .get(lead.assigned_advisor_id)
    : null;
  const advisorRate = advisorStat && advisorStat.total ? advisorStat.won / advisorStat.total : 0.15;
  res.json(await serialize(lead, advisorRate));
});

// Elimina un lead por completo (registros de prueba, duplicados, errores de
// captura). Solo coordinador/admin -- a diferencia de reasignar o cerrar, esto
// no se puede deshacer desde la UI. Si el lead ya tenia oportunidad en Odoo,
// se archiva alla tambien (no se borra duro -- Odoo desaconseja el unlink de
// crm.lead; archivada ya no aparece en el pipeline activo). Best-effort: si
// Odoo falla, el lead igual se borra del CRM y se avisa en la respuesta.
router.delete('/:id', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

  let odoo_warning = null;
  if (lead.odoo_lead_id) {
    try {
      await odoo.archiveOpportunity(lead.odoo_lead_id);
    } catch (err) {
      odoo_warning = `El lead se eliminó del CRM, pero no se pudo archivar la oportunidad en Odoo: ${err.message}`;
    }
  }

  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM payments WHERE lead_id = ?').run(id);
    await db.prepare('DELETE FROM reassignments WHERE lead_id = ?').run(id);
    await db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  });
  await tx();

  broadcast('leads_changed', { reason: 'deleted', id });
  res.json({ ok: true, odoo_warning });
});

const DEFAULT_SOURCE = 'WhatsApp';
const DEFAULT_CHANNEL_DETAIL = 'Google Ads';

router.post('/', requireRole('coordinador', 'admin'), async (req, res) => {
  const { client_name, phone, document, product, notes, advisor_id, source, city, created_at, client_id, address, email, gclid } = req.body || {};
  if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'client_name es requerido' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'phone es requerido' });
  const advisor = await db.prepare('SELECT * FROM advisors WHERE id = ? AND active = true').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Selecciona un asesor activo para asignar el lead' });
  let client = null;
  if (client_id) {
    client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(client_id));
    if (!client) return res.status(400).json({ error: 'Cliente invalido' });
  }

  let now;
  try {
    now = parseBackdatedInput(created_at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const info = await db
    .prepare(
      `INSERT INTO leads (client_name, phone, document, product, notes, status, assigned_advisor_id, source, channel_detail, city, created_at, client_id, address, email, gclid)
       VALUES (?, ?, ?, ?, ?, 'asignado', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      client_name.trim(),
      phone.trim(),
      document || null,
      product || null,
      notes || null,
      advisor.id,
      (source && source.trim()) || DEFAULT_SOURCE,
      // channel_detail ya no se pide en ningun formulario -- queda fijo en
      // "Google Ads" para todo lead nuevo (asi lo pidio el negocio: en la
      // practica todo lo que entra es de ads), para no romper el reporte de
      // Rentabilidad de Leads / ROI que depende de este campo.
      DEFAULT_CHANNEL_DETAIL,
      (city && city.trim()) || null,
      now,
      client ? client.id : null,
      (address && address.trim()) || null,
      (email && email.trim()) || null,
      // gclid: el parámetro que Google pone en la URL cuando alguien llega
      // desde un anuncio -- nada en el CRM lo captura todavía (llegaría de
      // una futura landing page/webhook); si viene, queda guardado para
      // poder reportar la venta cerrada como conversión a Google Ads (ver
      // reportGoogleAdsConversion más abajo).
      (gclid && gclid.trim()) || null
    );

  const created = await db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);

  // Crear/deduplicar el contacto + oportunidad en Odoo (si esta configurado).
  const odooResult = await syncLeadToOdoo(created.id);

  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(created.id);
  broadcast('leads_changed', { reason: 'created', id: lead.id, client_name: lead.client_name, advisor_name: advisor.name });
  const payload = await serialize(lead);
  if (odooResult.error) {
    payload.odoo_warning = `El lead se guardó, pero no se pudo sincronizar con Odoo: ${odooResult.error}`;
  } else if (odooResult.partner_created === false) {
    payload.odoo_note = 'Contacto ya existente en Odoo — se reutilizó (sin duplicar).';
  }
  res.status(201).json(payload);
});

// Corregir los datos basicos de un lead ya registrado (nombre, telefono,
// documento, producto, canal de entrada, origen/ads, referencia de venta,
// ciudad, notas). No toca estado del embudo, asesor ni monto -- eso ya tiene
// sus propios endpoints (assign, reassign, contact, quote, close, amount).
// Un asesor puede corregir esto sobre sus propios leads mientras sigan
// activos (ver canEditLead); reasignar y dar de alta siguen siendo solo de
// coordinador/admin.
const CHANNEL_DETAILS = ['Google Ads', 'Orgánico', 'Referido', 'Otro'];

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canEditLead(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para editar este lead' });

  const { client_name, phone, document, product, notes, city, source, channel_detail, sale_reference, address, email } = req.body || {};
  if (client_name !== undefined && !client_name.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  if (phone !== undefined && !phone.trim()) return res.status(400).json({ error: 'El teléfono no puede quedar vacío' });
  if (channel_detail !== undefined && channel_detail && !CHANNEL_DETAILS.includes(channel_detail)) {
    return res.status(400).json({ error: 'Origen inválido' });
  }

  await db
    .prepare(
      `UPDATE leads SET client_name = ?, phone = ?, document = ?, product = ?, notes = ?, city = ?, source = ?, channel_detail = ?, sale_reference = ?, address = ?, email = ? WHERE id = ?`
    )
    .run(
      client_name !== undefined ? client_name.trim() : lead.client_name,
      phone !== undefined ? phone.trim() : lead.phone,
      document !== undefined ? (document.trim() || null) : lead.document,
      product !== undefined ? (product.trim() || null) : lead.product,
      notes !== undefined ? (notes.trim() || null) : lead.notes,
      city !== undefined ? (city.trim() || null) : lead.city,
      source !== undefined ? (source.trim() || DEFAULT_SOURCE) : lead.source,
      channel_detail !== undefined ? (channel_detail || DEFAULT_CHANNEL_DETAIL) : lead.channel_detail,
      sale_reference !== undefined ? (sale_reference.trim() || null) : lead.sale_reference,
      address !== undefined ? (address.trim() || null) : lead.address,
      email !== undefined ? (email.trim() || null) : lead.email,
      id
    );

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (notes !== undefined || city !== undefined) await pushOdooDetails(updated);
  broadcast('leads_changed', { reason: 'edited', id });
  res.json(await serialize(updated));
});

router.post('/:id/assign', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const { advisor_id } = req.body || {};
  const advisor = await db.prepare('SELECT * FROM advisors WHERE id = ?').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Asesor invalido' });

  await db.prepare("UPDATE leads SET assigned_advisor_id = ?, status = 'asignado' WHERE id = ?").run(advisor.id, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  // Si el lead ya está en Odoo, mover la oportunidad al vendedor + equipo del
  // nuevo asesor; si aún no está (fallo previo, integración recién activada),
  // crearla ahora ya con el asesor correcto.
  if (updated.odoo_lead_id) await pushOdooOwner(updated, advisor);
  else await syncLeadToOdoo(id);

  broadcast('leads_changed', { reason: 'assigned', id });
  res.json(await serialize(await db.prepare('SELECT * FROM leads WHERE id = ?').get(id)));
});

router.patch('/:id/contact', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (lead.status !== 'asignado') {
    return res.status(409).json({ error: 'Solo se puede marcar como contactado un lead en estado "asignado"' });
  }

  let now;
  try {
    now = parseBackdatedInput((req.body || {}).at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (now < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });
  await db.prepare("UPDATE leads SET status = 'contactado', contacted_at = ? WHERE id = ?").run(now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  await pushOdooStage(updated, 'contacted');
  broadcast('leads_changed', { reason: 'contacted', id });
  res.json(await serialize(updated));
});

// "Aun en contacto": pospone 24h la alerta de la Sala 24h por falta de
// cotizacion, sin tocar el estado del embudo. No es un cierre del reloj (eso
// solo pasa al cotizar) sino un snooze -- si en 24h desde este ack todavia no
// hay cotizacion, sla_status vuelve a marcar 'riesgo'/'vencido' para que el
// lead no quede escondido indefinidamente solo porque alguien lo reconocio
// una vez.
router.patch('/:id/contact-ack', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (lead.status !== 'contactado') {
    return res.status(409).json({ error: 'Solo aplica a un lead en estado "contactado" pendiente de cotización' });
  }

  const now = nowUtc();
  await db.prepare('UPDATE leads SET contact_ack_at = ? WHERE id = ?').run(now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'contact_ack', id });
  res.json(await serialize(updated));
});

router.patch('/:id/quote', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (!['asignado', 'contactado'].includes(lead.status)) {
    return res.status(409).json({ error: 'Solo se puede cotizar un lead en estado "asignado" o "contactado"' });
  }

  let now;
  try {
    now = parseBackdatedInput((req.body || {}).at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (now < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });
  await db
    .prepare("UPDATE leads SET status = 'cotizado', quoted_at = ?, contacted_at = COALESCE(contacted_at, ?) WHERE id = ?")
    .run(now, now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  await pushOdooStage(updated, 'quoted');
  broadcast('leads_changed', { reason: 'quoted', id });
  res.json(await serialize(updated));
});

// ---------------------------------------------------------------------------
//  Cotizacion real en Odoo: lineas de producto, IVA, total y PDF.
//  A diferencia de /:id/quote (que solo mueve el estado del embudo), esto
//  arma un sale.order en Odoo. Guarda en el CRM la referencia (S0...) y el
//  monto total (con IVA), y deja el lead en "cotizado".
//  body: { lines: [{ product_id?, product_name?, qty, price_unit? }],
//          validity_days?, note?, mark_sent? }
// ---------------------------------------------------------------------------
router.post('/:id/quotation', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (!odoo.isEnabled()) return res.status(409).json({ error: 'La integración con Odoo no está configurada' });

  const { lines, validity_days, note, mark_sent } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un producto a la cotización' });
  }

  // Asegurar contacto + oportunidad en Odoo (crea si aún no existen).
  if (!lead.odoo_lead_id) {
    const sync = await syncLeadToOdoo(id);
    if (!sync.synced) {
      return res.status(502).json({ error: `No se pudo crear la oportunidad en Odoo: ${sync.error || 'desconocido'}` });
    }
  }
  const withOdoo = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);

  let order;
  try {
    order = await odoo.createQuotation({
      partner_id: withOdoo.odoo_partner_id,
      opportunity_id: withOdoo.odoo_lead_id,
      lines,
      validity_days: Number(validity_days) || 8,
      note: note || null,
    });
    if (mark_sent) order = await odoo.markQuotationSent(order.id);
  } catch (err) {
    return res.status(502).json({ error: `Odoo: ${err.message}` });
  }

  const now = nowUtc();
  await db
    .prepare(
      `UPDATE leads SET
         odoo_order_id = ?,
         sale_reference = ?,
         amount = ?,
         status = CASE WHEN status IN ('asignado', 'contactado') THEN 'cotizado' ELSE status END,
         quoted_at = COALESCE(quoted_at, ?),
         contacted_at = COALESCE(contacted_at, ?)
       WHERE id = ?`
    )
    // amount_untaxed (sin IVA): el reporte de ventas del CRM se lleva sin impuestos.
    .run(order.id, order.name, order.amount_untaxed, now, now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  await pushOdooStage(updated, 'quoted');
  broadcast('leads_changed', { reason: 'quoted', id });
  res.json({ lead: await serialize(updated), quotation: order });
});

// Estado actual de la cotización/pedido en Odoo (líneas, subtotales, estado).
// Lo usa el CRM para mostrar "Ver cotización" y precargar el monto al cerrar.
router.get('/:id/quotation', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (!odoo.isEnabled()) return res.status(409).json({ error: 'La integración con Odoo no está configurada' });
  if (!lead.odoo_order_id) return res.status(409).json({ error: 'Este lead no tiene cotización en Odoo' });
  try {
    const order = await odoo.readOrder(lead.odoo_order_id);
    res.json({ quotation: order });
  } catch (err) {
    res.status(502).json({ error: `Odoo: ${err.message}` });
  }
});

// Marcar la cotización como enviada al cliente (state 'sent').
router.post('/:id/quotation/send', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (!odoo.isEnabled()) return res.status(409).json({ error: 'La integración con Odoo no está configurada' });
  if (!lead.odoo_order_id) return res.status(409).json({ error: 'Este lead no tiene cotización en Odoo' });
  try {
    const order = await odoo.markQuotationSent(lead.odoo_order_id);
    res.json({ quotation: order });
  } catch (err) {
    res.status(502).json({ error: `Odoo: ${err.message}` });
  }
});

// Reescribir las líneas de una cotización en borrador (editar desde el CRM).
// body: { lines: [{ product_id?, product_name?, qty, price_unit? }] }
router.put('/:id/quotation', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (!odoo.isEnabled()) return res.status(409).json({ error: 'La integración con Odoo no está configurada' });
  if (!lead.odoo_order_id) return res.status(409).json({ error: 'Este lead no tiene cotización en Odoo' });
  const { lines } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un producto a la cotización' });
  }
  let order;
  try {
    order = await odoo.updateQuotationLines(lead.odoo_order_id, lines);
  } catch (err) {
    return res.status(502).json({ error: `Odoo: ${err.message}` });
  }
  await db
    // amount_untaxed (sin IVA): el reporte de ventas del CRM se lleva sin impuestos.
    .prepare('UPDATE leads SET sale_reference = ?, amount = ? WHERE id = ?')
    .run(order.name, order.amount_untaxed, id);
  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'quoted', id });
  res.json({ lead: await serialize(updated), quotation: order });
});

// PDF de la cotización (generado por Odoo, formato Odoo).
router.get('/:id/quotation/pdf', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'Sin permiso' });
  if (!lead.odoo_order_id) return res.status(409).json({ error: 'Este lead no tiene cotización en Odoo' });
  try {
    const pdf = await odoo.quotationPdf(lead.odoo_order_id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${lead.sale_reference || 'cotizacion'}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(502).json({ error: `Odoo: ${err.message}` });
  }
});

// ===========================================================================
//  Cotizaciones nativas de Nova (pestaña "Cotizar") -- SIN Odoo de por medio.
//  Aparte del flujo de arriba (Odoo, ver server/odoo.js): esta guarda todo en
//  las tablas propias quotations/quotation_lines (ver db.js y
//  server/nativeQuotes.js). Un lead puede llegar a tener cotizaciones de los
//  dos tipos a la vez si se usó primero un flujo y luego el otro -- no se
//  mezclan ni se pisan entre sí.
// ===========================================================================
router.get('/:id/quotations', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const rows = await db.prepare('SELECT id FROM quotations WHERE lead_id = ? ORDER BY created_at DESC').all(id);
  const quotations = await Promise.all(rows.map((r) => nativeQuotes.readQuotation(r.id)));
  res.json({ quotations });
});

router.post('/:id/quotations', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });

  const { lines, validity_days, note, service_slug, service_fields } = req.body || {};
  const cleanLines = Array.isArray(lines) ? lines.filter((l) => l && l.product_name && Number(l.qty) > 0) : [];
  if (!cleanLines.length) return res.status(400).json({ error: 'Agrega al menos un producto a la cotización' });

  let cleanServiceFields = null;
  if (service_slug) {
    const check = velaraServices.validateServiceFields(service_slug, service_fields);
    if (!check.ok) return res.status(400).json({ error: check.error });
    cleanServiceFields = Object.keys(check.fields).length ? JSON.stringify(check.fields) : null;
  }

  const days = Number(validity_days) > 0 ? Number(validity_days) : 8;
  const validityDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  const info = await db
    .prepare('INSERT INTO quotations (lead_id, validity_days, validity_date, note, created_by, service_slug, service_fields) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, days, validityDate, (note && note.trim()) || null, req.user.id || null, service_slug || null, cleanServiceFields);
  const quotationId = info.lastInsertRowid;
  await db.prepare("UPDATE quotations SET number = printf('COT-%04d', id) WHERE id = ?").run(quotationId);
  await nativeQuotes.writeLines(quotationId, cleanLines);

  const now = nowUtc();
  await db
    .prepare(
      `UPDATE leads SET
         status = CASE WHEN status IN ('asignado', 'contactado') THEN 'cotizado' ELSE status END,
         quoted_at = COALESCE(quoted_at, ?),
         contacted_at = COALESCE(contacted_at, ?)
       WHERE id = ?`
    )
    .run(now, now, id);

  const quotation = await nativeQuotes.readQuotation(quotationId);
  broadcast('leads_changed', { reason: 'quoted', id });
  res.status(201).json({ quotation });
});

// Registrar que se le dio seguimiento a una cotizacion enviada (se le
// insistio al cliente). Reinicia el reloj de "leads en riesgo de enfriarse"
// sin cambiar el estado del embudo.
router.post('/:id/followup', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (lead.status !== 'cotizado') {
    return res.status(409).json({ error: 'Solo se puede registrar seguimiento a un lead en estado "cotizado"' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare('UPDATE leads SET last_followup_at = ?, followup_count = followup_count + 1 WHERE id = ?').run(now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'followup', id });
  res.json(await serialize(updated));
});

router.post('/:id/reassign', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canReassignLead(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para reasignar este lead' });
  const { to_advisor_id, reason, at } = req.body || {};
  const toAdvisor = await db.prepare('SELECT * FROM advisors WHERE id = ?').get(Number(to_advisor_id));
  if (!toAdvisor) return res.status(400).json({ error: 'Asesor destino invalido' });

  let when;
  try {
    when = parseBackdatedInput(at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (when < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });

  const fromAdvisorId = lead.assigned_advisor_id;
  const tx = db.transaction(async () => {
    // No se toca status/contacted_at/quoted_at: una reasignacion es solo un
    // cambio de dueño del lead, el progreso del embudo (contactado/cotizado)
    // ya alcanzado se conserva para el nuevo asesor.
    await db
      .prepare('UPDATE leads SET assigned_advisor_id = ?, reassigned_count = reassigned_count + 1 WHERE id = ?')
      .run(toAdvisor.id, id);
    await db
      .prepare('INSERT INTO reassignments (lead_id, from_advisor_id, to_advisor_id, reason, penalty_points, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, fromAdvisorId, toAdvisor.id, reason || 'Reasignacion manual', 5, when);
  });
  await tx();

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (updated.odoo_lead_id) await pushOdooOwner(updated, toAdvisor);
  else await syncLeadToOdoo(id);

  broadcast('leads_changed', { reason: 'reassigned', id });
  broadcast('advisors_changed', { reason: 'penalty', id: fromAdvisorId });
  res.json(await serialize(updated));
});

router.post('/:id/close', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const { result, amount, at, sale_reference } = req.body || {};
  if (!['ganado', 'perdido'].includes(result)) return res.status(400).json({ error: 'result debe ser ganado|perdido' });
  if (lead.status.startsWith('cerrado')) {
    return res.status(409).json({ error: 'Este lead ya esta cerrado' });
  }

  let now;
  try {
    now = parseBackdatedInput(at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (now < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });
  await db
    // sale_reference es opcional aqui (ej. desde Venta Rapida): si no viene,
    // se deja el que ya tuviera el lead en vez de borrarlo con null -- este
    // mismo endpoint tambien lo usa el cierre normal desde Ventas, que nunca
    // manda este campo.
    // channel_detail se fuerza a 'Google Ads' al ganar: leads_visible (ver
    // db.js) solo muestra ese canal en Ventas Cerradas/Dashboard/Informe, asi
    // que sin esto una venta real se "perdia" de esas pantallas si el lead
    // que se cerro (a veces uno historico reciclado, con otro canal o
    // ninguno) no traia ya ese canal -- la venta quedaba guardada pero
    // invisible, sin ningun aviso de por que.
    .prepare(
      "UPDATE leads SET status = ?, closed_at = ?, amount = ?, sale_reference = COALESCE(?, sale_reference), channel_detail = CASE WHEN ? = 'ganado' THEN 'Google Ads' ELSE channel_detail END WHERE id = ?"
    )
    .run(
      result === 'ganado' ? 'cerrado_ganado' : 'cerrado_perdido',
      now,
      result === 'ganado' ? Number(amount) || 0 : 0,
      result === 'ganado' && sale_reference && sale_reference.trim() ? sale_reference.trim() : null,
      result,
      id
    );

  let closedLead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);

  // Sincronizar con Odoo: una venta ganada CONFIRMA la cotización -> pasa a
  // Pedido de venta (state 'sale'); una perdida marca la oportunidad como
  // perdida. Best-effort -- el cierre en el CRM ya quedó guardado; si Odoo
  // falla, se avisa con odoo_warning y no se revierte nada.
  let odooWarning = null;
  if (odoo.isEnabled()) {
    try {
      if (result === 'ganado') {
        if (closedLead.odoo_order_id) {
          // Solo confirmar el pedido en Odoo (borrador -> Pedido de venta).
          // El monto que se reporta en el CRM es el que tecleó el asesor (sin
          // IVA) -- NO se sobrescribe con el total del pedido en Odoo, que
          // incluye impuestos.
          await odoo.confirmOrder(closedLead.odoo_order_id);
        }
        await pushOdooStage(closedLead, 'won');
      } else if (closedLead.odoo_lead_id) {
        // Perdido: mover a la etapa de "declinado" si está configurada
        // (ODOO_STAGE_LOST); si no, archivar la oportunidad (action_set_lost).
        const moved = await odoo.moveOpportunityStage(closedLead.odoo_lead_id, 'lost');
        if (!moved.moved) {
          await odoo.callKw('crm.lead', 'action_set_lost', [[closedLead.odoo_lead_id]]).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`[odoo] lead ${id}: no se pudo confirmar el pedido al cerrar:`, err.message);
      odooWarning = `La venta se cerró en el CRM, pero no se pudo confirmar el pedido en Odoo: ${err.message}`;
    }
  }

  // Reportar la venta ganada como conversión offline a Google Ads --
  // best-effort, igual que Odoo arriba: el cierre en el CRM ya quedó
  // guardado; si falla (o el lead no tiene gclid), no se revierte nada,
  // solo se avisa. Solo se intenta una vez por lead (google_ads_conversion_sent_at).
  let googleAdsWarning = null;
  if (result === 'ganado' && closedLead.gclid && !closedLead.google_ads_conversion_sent_at && googleAds.canReportConversions()) {
    try {
      await googleAds.uploadClickConversion({
        gclid: closedLead.gclid,
        // Google Ads exige el offset UTC explícito, no un nombre de zona
        // ("America/Bogota"); Colombia es UTC-05:00 todo el año (sin horario
        // de verano), y `now` ya viene en UTC (mismo formato que el resto
        // del CRM guarda), por eso no hace falta convertir la hora.
        conversionDateTime: `${now}+00:00`,
        conversionValue: closedLead.amount || 0,
      });
      await db.prepare('UPDATE leads SET google_ads_conversion_sent_at = ? WHERE id = ?').run(nowUtc(), id);
    } catch (err) {
      console.error(`[google-ads] lead ${id}: no se pudo reportar la conversión:`, err.message);
      googleAdsWarning = `La venta se cerró, pero no se pudo reportar la conversión a Google Ads: ${err.message}`;
    }
  }

  broadcast('leads_changed', { reason: 'closed', id });
  if (result === 'ganado') {
    broadcast('sale_closed', {
      lead_id: id,
      client_name: closedLead.client_name,
      product: closedLead.product,
      advisor_id: closedLead.assigned_advisor_id,
    });
  }
  const payload = await serialize(closedLead);
  if (odooWarning) payload.odoo_warning = odooWarning;
  if (googleAdsWarning) payload.google_ads_warning = googleAdsWarning;
  res.json(payload);
});

// --- Abonos (pagos parciales) -------------------------------------------
// Se registran contra un pedido/lead especifico (asi se sabe a que venta
// corresponde cada pago); la ficha del cliente (ver routes/clients.js) los
// agrega de todos sus pedidos para mostrar el saldo pendiente.

router.get('/:id/payments', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const payments = await db.prepare('SELECT * FROM payments WHERE lead_id = ? ORDER BY paid_at DESC').all(id);
  res.json(payments);
});

router.post('/:id/payments', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const { amount, notes, method, account_id, work_order_id } = req.body || {};
  const amountNum = Number(amount);
  if (!amountNum || amountNum <= 0) return res.status(400).json({ error: 'amount debe ser mayor a 0' });

  let paidAt;
  try {
    paidAt = parseBackdatedInput((req.body || {}).paid_at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Cuenta donde entró la plata (Finanzas, ver server/routes/cash.js); si
  // no llega, se elige por el medio de pago. Trabajo opcional.
  const cleanMethod = ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'otro'].includes(method) ? method : null;
  let acc;
  try {
    acc = await erp.resolveAccount(account_id, cleanMethod);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const wo = work_order_id ? await db.prepare('SELECT id FROM work_orders WHERE id = ?').get(Number(work_order_id)) : null;
  const info = await db
    .prepare('INSERT INTO payments (lead_id, amount, paid_at, notes, registered_by, method, account_id, work_order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, amountNum, paidAt, (notes && notes.trim()) || null, req.user.id || null, acc.method, acc.account_id, wo ? wo.id : null);

  const payment = await db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid);
  broadcast('leads_changed', { reason: 'payment_registered', id });
  res.status(201).json(payment);
});

// Editar el monto de una venta ya cerrada (ej. corregir un error de
// digitacion o un ajuste acordado con el cliente). Restringido a
// coordinador/admin igual que el resto de acciones administrativas de este
// archivo -- es un dato financiero ya cerrado, no una accion operativa del
// dia a dia del asesor.
router.patch('/:id/amount', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (lead.status !== 'cerrado_ganado') return res.status(409).json({ error: 'Solo se puede editar el monto de una venta cerrada' });
  const amountNum = Number((req.body || {}).amount);
  if (!Number.isFinite(amountNum) || amountNum < 0) return res.status(400).json({ error: 'amount debe ser un número válido' });
  await db.prepare('UPDATE leads SET amount = ? WHERE id = ?').run(amountNum, id);
  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'amount_updated', id });
  res.json(await serialize(updated));
});

// Editar la fecha/hora de REGISTRO del lead (ej. un lead que se metio al
// sistema hoy pero en realidad entro -y se vendio- hace varios dias: sin
// esto, /closed-at rechaza la fecha real de la venta por "anterior al
// registro" y no hay forma de corregir la causa real, que es que el
// registro mismo quedo con la fecha equivocada). Se valida que la nueva
// fecha no quede DESPUES de ningun hito que el lead ya tenga (contactado/
// cotizado/cerrado) -- si no, ese hito pasaria "antes de existir el lead".
// Mismo permiso que editar los datos basicos (canEditLead): un asesor puede
// corregir la fecha de registro de su propio lead mientras siga activo.
router.patch('/:id/created-at', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canEditLead(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para editar este lead' });

  let createdAt;
  try {
    createdAt = parseBackdatedInput((req.body || {}).at);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!createdAt) return res.status(400).json({ error: 'at es requerido' });
  for (const [field, label] of [
    ['contacted_at', 'de contactado'],
    ['quoted_at', 'de cotizado'],
    ['closed_at', 'de cierre'],
  ]) {
    if (lead[field] && createdAt > lead[field]) {
      return res.status(400).json({ error: `La fecha de registro no puede ser posterior a la fecha ${label}` });
    }
  }

  await db.prepare('UPDATE leads SET created_at = ? WHERE id = ?').run(createdAt, id);
  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'created_at_updated', id });
  res.json(await serialize(updated));
});

// Editar la fecha/hora de cierre de una venta ya cerrada (ej. se registro
// hoy una venta que en realidad se cerro la semana pasada). Mismo criterio
// que /amount: dato financiero/de reporte ya cerrado, restringido a
// coordinador/admin, no una accion operativa del dia a dia del asesor.
router.patch('/:id/closed-at', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (lead.status !== 'cerrado_ganado') return res.status(409).json({ error: 'Solo se puede editar la fecha de una venta cerrada' });

  let closedAt;
  try {
    closedAt = parseBackdatedInput((req.body || {}).at);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!closedAt) return res.status(400).json({ error: 'at es requerido' });
  if (closedAt < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });

  await db.prepare('UPDATE leads SET closed_at = ? WHERE id = ?').run(closedAt, id);
  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'closed_at_updated', id });
  res.json(await serialize(updated));
});

// Editar/eliminar un abono puntual. Mismo criterio de permiso que /amount:
// tocar un pago ya registrado es administrativo, no algo que un asesor haga
// sobre la marcha (para eso ya esta POST /:id/payments).
router.patch('/:id/payments/:paymentId', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const paymentId = Number(req.params.paymentId);
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND lead_id = ?').get(paymentId, id);
  if (!payment) return res.status(404).json({ error: 'Abono no encontrado' });
  const { amount, notes } = req.body || {};
  const amountNum = amount !== undefined ? Number(amount) : payment.amount;
  if (!amountNum || amountNum <= 0) return res.status(400).json({ error: 'amount debe ser mayor a 0' });
  await db.prepare('UPDATE payments SET amount = ?, notes = ? WHERE id = ?').run(
    amountNum,
    notes !== undefined ? (notes.trim() || null) : payment.notes,
    paymentId
  );
  const updated = await db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  broadcast('leads_changed', { reason: 'payment_updated', id });
  res.json(updated);
});

router.delete('/:id/payments/:paymentId', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const paymentId = Number(req.params.paymentId);
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND lead_id = ?').get(paymentId, id);
  if (!payment) return res.status(404).json({ error: 'Abono no encontrado' });
  await db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
  broadcast('leads_changed', { reason: 'payment_deleted', id });
  res.json({ ok: true });
});

module.exports = router;
