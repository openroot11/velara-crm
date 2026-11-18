const express = require('express');
const { db } = require('../db');
const sla = require('../sla');
const reporting = require('../reporting');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function monthPrefix(offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

router.get('/', async (req, res) => {
  const thisMonth = monthPrefix(0);
  const prevMonth = monthPrefix(-1);

  const allLeads = await db.prepare('SELECT * FROM leads_visible').all();
  const allAdvisors = await db.prepare('SELECT * FROM advisors WHERE is_group = false ORDER BY priority_order ASC').all();
  const advisors = allAdvisors.filter((a) => a.active);

  const wonThisMonth = allLeads.filter((l) => l.status === 'cerrado_ganado' && l.closed_at && l.closed_at.startsWith(thisMonth));
  const wonPrevMonth = allLeads.filter((l) => l.status === 'cerrado_ganado' && l.closed_at && l.closed_at.startsWith(prevMonth));
  const totalSalesMonth = wonThisMonth.reduce((sum, l) => sum + (l.amount || 0), 0);
  const totalSalesPrevMonth = wonPrevMonth.reduce((sum, l) => sum + (l.amount || 0), 0);
  const salesGrowthPct = totalSalesPrevMonth > 0
    ? Math.round(((totalSalesMonth - totalSalesPrevMonth) / totalSalesPrevMonth) * 1000) / 10
    : (totalSalesMonth > 0 ? 100 : 0);

  const leadsThisMonth = allLeads.filter((l) => l.created_at.startsWith(thisMonth));
  const contactedWithinSla = leadsThisMonth.filter((l) => {
    if (!l.contacted_at) return false;
    const hours = sla.hoursBetween(l.created_at, sla.parseUtc(l.contacted_at));
    return hours <= 2;
  });
  const slaContactRate = leadsThisMonth.length
    ? Math.round((contactedWithinSla.length / leadsThisMonth.length) * 1000) / 10
    : 100;

  const openLeads = allLeads.filter((l) => ['asignado', 'contactado', 'cotizado'].includes(l.status));
  const criticalLeads = openLeads.filter((l) => sla.slaStatus(l) === 'vencido');
  const criticalAdvisorNames = [
    ...new Set(
      criticalLeads
        .map((l) => allAdvisors.find((a) => a.id === l.assigned_advisor_id))
        .filter(Boolean)
        .map((a) => a.name)
    ),
  ];

  const salesByAdvisor = advisors.map((advisor) => {
    const won = allLeads.filter((l) => l.assigned_advisor_id === advisor.id && l.status === 'cerrado_ganado');
    const thisMonthTotal = won.filter((l) => l.closed_at && l.closed_at.startsWith(thisMonth)).reduce((s, l) => s + (l.amount || 0), 0);
    const prevMonthTotal = won.filter((l) => l.closed_at && l.closed_at.startsWith(prevMonth)).reduce((s, l) => s + (l.amount || 0), 0);
    return { advisor_id: advisor.id, name: advisor.name, this_month: thisMonthTotal, prev_month: prevMonthTotal };
  });

  const statusLabels = {
    asignado: 'Asignado',
    contactado: 'Contactado',
    cotizado: 'Cotizado',
    cerrado_ganado: 'Cerrado Ganado',
    cerrado_perdido: 'Perdido',
  };
  const distribution = {};
  for (const key of Object.keys(statusLabels)) distribution[key] = 0;
  for (const lead of allLeads) distribution[lead.status] = (distribution[lead.status] || 0) + 1;

  const targetRow = await db.prepare("SELECT value FROM settings WHERE key = 'monthly_sales_target'").get();

  res.json({
    total_sales_month: totalSalesMonth,
    total_sales_growth_pct: salesGrowthPct,
    sla_contact_rate: slaContactRate,
    sla_contact_sample: leadsThisMonth.length,
    critical_leads_count: criticalLeads.length,
    critical_leads_advisors: criticalAdvisorNames,
    sales_by_advisor: salesByAdvisor,
    lead_status_distribution: Object.entries(distribution).map(([key, count]) => ({
      status: key,
      label: statusLabels[key],
      count,
    })),
    total_leads: allLeads.length,
    monthly_trend: await reporting.computeMonthlyTrend(6),
    monthly_sales_target: targetRow ? Number(targetRow.value) : null,
  });
});

/**
 * GET /api/kpis/funnel?from=YYYY-MM-DD&to=YYYY-MM-DD&advisor_id=1
 * Comparativo asignado -> contactado -> cotizado -> vendido/perdido por
 * asesor, en un rango de fechas (por defecto el mes calendario actual), con
 * cumplimiento de SLA, tiempo promedio de cierre y ranking por monto vendido.
 */
router.get('/funnel', async (req, res) => {
  const report = await reporting.computeFunnelReport(req.query.from, req.query.to, req.query.advisor_id);
  res.json(report);
});

/**
 * GET /api/kpis/profitability?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Rentabilidad de leads por canal/origen contra la inversion de Google Ads
 * registrada en Ajustes -> Inversión Publicitaria (ver routes/marketing.js).
 */
router.get('/profitability', async (req, res) => {
  const report = await reporting.computeProfitabilityReport(req.query.from, req.query.to);
  res.json(report);
});

/**
 * GET /api/kpis/advisor/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Ficha individual de un asesor: metricas propias, comparativo con el
 * equipo, desglose por producto/canal, velocidad de respuesta, seguimiento
 * y tendencia mensual. Pensado para generar un reporte entregable por persona.
 */
router.get('/advisor/:id', async (req, res) => {
  const report = await reporting.computeAdvisorReport(req.params.id, req.query.from, req.query.to);
  if (!report) return res.status(404).json({ error: 'Asesor no encontrado' });
  res.json(report);
});

/**
 * GET /api/kpis/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Reporte de gerencia ("Reporte de Servicio al Cliente"): resultados
 * generales, embudo, rentabilidad de ads, resultados por asesor y promedios
 * por día de la semana, en un rango (por defecto el mes calendario actual).
 * Solo admin -- es el tablero propio del dueño.
 */
router.get('/monthly', requireRole('admin'), async (req, res) => {
  const report = await reporting.computeMonthlyReport(req.query.from, req.query.to);
  res.json(report);
});

/**
 * GET /api/kpis/geo?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Leads por ciudad en el rango, con el producto que mas se vende en cada
 * una -- para el mapa de Colombia del Dashboard.
 */
router.get('/geo', async (req, res) => {
  const report = await reporting.computeGeoReport(req.query.from, req.query.to);
  res.json(report);
});

/**
 * GET /api/kpis/flow?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Flujo canal -> producto -> resultado en el rango, para el diagrama
 * "Flujo de Leads" de Estadisticas (junto a Rentabilidad de Leads).
 */
router.get('/flow', async (req, res) => {
  const report = await reporting.computeChannelProductFlow(req.query.from, req.query.to);
  res.json(report);
});

/**
 * GET /api/kpis/daily-trend?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Ventas cerradas dia por dia en el rango (por defecto ultimos 30 dias),
 * para la grafica de tendencia de "Ventas Cerradas".
 */
router.get('/daily-trend', async (req, res) => {
  const report = await reporting.computeDailySalesTrend(req.query.from, req.query.to, req.query.advisor_id, req.query.channel_detail);
  res.json(report);
});

router.get('/forecast', async (req, res) => {
  const report = await reporting.computeForecast(req.query.horizon, req.query.interval);
  res.json(report);
});

// GET /api/kpis/teams -- CRM › Equipos (como los equipos de ventas de
// Odoo): un cuadro por vendedor con sus oportunidades abiertas, las que
// tienen el próximo paso vencido, sus cotizaciones activas, lo ganado en 30
// días y cuántos clientes le entraron en cada una de las últimas 5 semanas
// (lunes a domingo, hora de Colombia). Un asesor solo ve su propio cuadro.
const BOGOTA_MS = 5 * 3600 * 1000; // UTC-5 todo el año
function bogotaDate(utc) {
  return new Date(new Date(`${String(utc).replace(' ', 'T')}Z`).getTime() - BOGOTA_MS);
}
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function weekLabel(start, end) {
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()}-${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`
    : `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}-${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
}

router.get('/teams', async (req, res) => {
  const now = new Date(Date.now() - BOGOTA_MS); // "ahora" en hora de Colombia, leído como UTC
  const today = isoDay(now);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const weeks = [];
  for (let i = 4; i >= 0; i--) {
    const start = new Date(monday.getTime() - i * 7 * 86400000);
    const end = new Date(start.getTime() + 6 * 86400000);
    weeks.push({ from: isoDay(start), to: isoDay(end), label: weekLabel(start, end) });
  }

  let advisors = await db.prepare('SELECT id, name, active FROM advisors WHERE is_group = 0 ORDER BY priority_order, name').all();
  if (req.user.role === 'asesor') advisors = advisors.filter((a) => a.id === req.user.advisor_id);

  const leads = await db
    .prepare(
      `SELECT id, assigned_advisor_id, status, created_at, closed_at, amount, next_action_at
         FROM leads
        WHERE status IN ('asignado', 'contactado', 'cotizado') OR created_at >= ? OR closed_at >= datetime('now', '-30 days')`
    )
    .all(`${weeks[0].from} 00:00:00`);
  // Valor de una oportunidad abierta = su última cotización no cancelada.
  const lastQuote = new Map(
    (
      await db
        .prepare(
          `SELECT lead_id, amount_total FROM quotations
            WHERE id IN (SELECT MAX(id) FROM quotations WHERE state != 'cancel' GROUP BY lead_id)`
        )
        .all()
    ).map((q) => [q.lead_id, q.amount_total])
  );
  const activeQuotes = await db
    .prepare(
      `SELECT l.assigned_advisor_id AS advisor_id, COUNT(*) AS n, COALESCE(SUM(q.amount_total), 0) AS total
         FROM quotations q JOIN leads l ON l.id = q.lead_id
        WHERE q.state IN ('draft', 'sent', 'seguimiento', 'aprobada')
        GROUP BY l.assigned_advisor_id`
    )
    .all();
  const quotesBy = new Map(activeQuotes.map((r) => [r.advisor_id, r]));
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);

  const teams = advisors.map((a) => {
    const mine = leads.filter((l) => l.assigned_advisor_id === a.id);
    const open = mine.filter((l) => ['asignado', 'contactado', 'cotizado'].includes(l.status));
    const won = mine.filter((l) => l.status === 'cerrado_ganado' && l.closed_at && l.closed_at >= since30);
    const perWeek = weeks.map((w) => {
      return mine.filter((l) => {
        const day = isoDay(bogotaDate(l.created_at));
        return day >= w.from && day <= w.to;
      }).length;
    });
    const q = quotesBy.get(a.id);
    return {
      advisor_id: a.id,
      name: a.name,
      active: !!a.active,
      open_count: open.length,
      open_value: open.reduce((s, l) => s + (lastQuote.get(l.id) || 0), 0),
      overdue_count: open.filter((l) => l.next_action_at && l.next_action_at.slice(0, 10) < today).length,
      quotes_count: q ? q.n : 0,
      quotes_value: q ? q.total : 0,
      won_count: won.length,
      won_value: won.reduce((s, l) => s + (Number(l.amount) || 0), 0),
      weeks: perWeek,
    };
  });
  res.json({ weeks: weeks.map((w) => w.label), teams });
});

module.exports = router;
