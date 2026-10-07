// PDF de un trabajo (routes/jobs.js), con la papelería de VELARA
// (pdfBrand.js):
//   orden -> Orden de trabajo: qué hay que hacer, para cuándo y quién (para
//            el taller y para el cliente al recibir el vehículo o la pieza).
//   acta  -> Acta de entrega y certificado de garantía.

const { getSetting } = require('./db');
const brand = require('./pdfBrand');
const velaraServices = require('./velaraServices');

const { C, F, PAGE } = brand;

const DEFAULT_WARRANTY_TERMS =
  'La garantía cubre defectos de costura, despegues y fallas en cierres atribuibles al trabajo del taller.\n' +
  'No cubre daños por mal uso, cortes, quemaduras, humedad prolongada, productos químicos ni desgaste normal.\n' +
  'Para hacerla efectiva, presente esta acta (o el número del trabajo) y traiga el vehículo o la pieza al taller.';

async function settings() {
  const [name, nit, address, phone, email, web, terms] = await Promise.all([
    getSetting('quote_company_name', 'Velara Taller S.A.S.'),
    getSetting('quote_company_nit', ''),
    getSetting('quote_company_address', ''),
    getSetting('quote_company_phone', ''),
    getSetting('quote_company_email', ''),
    getSetting('quote_company_web', ''),
    getSetting('warranty_terms', DEFAULT_WARRANTY_TERMS),
  ]);
  return { name, nit, address, phone, email, web, terms };
}

function dmy(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '—';
}
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

// Encabezado común: membrete, título con filete y N.º con sus filas.
function header(doc, cfg, title, subtitle, number, rows) {
  brand.setup(doc, cfg);
  brand.drawLetterhead(doc, cfg);
  const titleBottom = brand.drawTitle(doc, title, 168, subtitle);
  const metaBottom = brand.drawDocMeta(doc, 362, 132, number, rows);
  return Math.max(titleBottom + 28, metaBottom + 14);
}

// Cliente (izq.) y trabajo (der.) en dos columnas, como la cotización.
function twoColumns(doc, y, job, rightRows) {
  const leftW = 247;
  const rightX = 349;
  const rightW = PAGE.R - rightX;
  let y1 = brand.sectionHeading(doc, 'Cliente', PAGE.L, y);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Nombre', job.client_name);
  y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Teléfono', brand.formatPhone(job.phone) || job.phone);
  if (job.address) y1 = brand.fieldRow(doc, PAGE.L, y1, 92, leftW, 'Dirección', job.address);
  let y2 = brand.sectionHeading(doc, 'Trabajo', rightX, y, rightW);
  for (const [label, value] of rightRows) y2 = brand.fieldRow(doc, rightX, y2, 92, rightW, label, value);
  const bottom = Math.max(y1, y2);
  doc.moveTo(320, y).lineTo(320, bottom - 7).lineWidth(0.6).strokeColor(C.line).stroke();
  return bottom + 8;
}

function serviceRows(job) {
  const service = job.service_slug ? velaraServices.findService(job.service_slug) : null;
  const rows = [['Servicio', job.service_title || '—']];
  if (service && job.service_fields) {
    const f = job.service_fields;
    const vehicle = ['marca', 'modelo', 'anio'].map((k) => f[k]).filter(Boolean).join(' / ');
    if (vehicle) rows.push(['Marca / modelo / año', vehicle]);
    for (const field of service.fields) {
      if (['marca', 'modelo', 'anio'].includes(field.key)) continue;
      if (f[field.key]) rows.push([field.label, f[field.key]]);
    }
  }
  return rows;
}

function paragraph(doc, y, title, body) {
  if (!body) return y;
  y = brand.ensureSpace(doc, y, 40);
  y = brand.sectionHeading(doc, title, PAGE.L, y);
  doc.font(F.regular).fontSize(8.5).fillColor(C.ink).text(body, PAGE.L, y, { width: PAGE.W });
  return y + doc.heightOfString(body, { width: PAGE.W }) + 16;
}

function signatures(doc, y, labels) {
  y = brand.ensureSpace(doc, y + 30, 50);
  const w = 235;
  labels.forEach(([label, sub], i) => {
    const x = i === 0 ? PAGE.L : PAGE.R - w;
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(1).strokeColor(C.ink).stroke();
    doc.font(F.semibold).fontSize(7.5).fillColor(C.ink).text(label.toUpperCase(), x, y + 8, { width: w, characterSpacing: 1.1 });
    if (sub) doc.font(F.regular).fontSize(8).fillColor(C.smoke).text(sub, x, y + 20, { width: w });
  });
  return y + 40;
}

function drawOrden(doc, job, cfg) {
  let y = header(doc, cfg, 'Orden de trabajo', null, job.number, [
    ['Fecha', dmy(job.created_at)],
    ['Entrega prometida', dmy(job.promised_date)],
    ['Operario', job.worker_name || ''],
  ]);
  y = twoColumns(doc, y, job, serviceRows(job));
  y = paragraph(doc, y, 'Qué se va a hacer', job.description);

  if (job.materials.length) {
    y = brand.ensureSpace(doc, y, 60);
    y = brand.sectionHeading(doc, 'Material usado', PAGE.L, y);
    const totals = new Map();
    for (const m of job.materials) totals.set(m.name, { unit: m.unit, qty: (totals.get(m.name)?.qty || 0) - Number(m.qty) });
    const cols = [
      { key: 'name', label: 'Material', x: PAGE.L + 8, w: 360, bold: true },
      { key: 'qty', label: 'Cantidad', x: PAGE.L + 380, w: 135, align: 'right' },
    ];
    const rows = [...totals].filter(([, v]) => v.qty > 0).map(([name, v]) => ({ name, qty: `${Number(v.qty.toFixed(3))} ${v.unit}` }));
    y = brand.drawTable(doc, y, cols, rows) + 16;
  }

  y = paragraph(doc, y, 'Observaciones', job.notes);
  y = brand.ensureSpace(doc, y, 30);
  doc.font(F.regular).fontSize(8.5).fillColor(C.ink).text(`Valor del trabajo: `, PAGE.L, y, { continued: true }).font(F.semibold).text(money(job.amount_total));
  signatures(doc, y + 10, [
    ['Recibe el trabajo', cfg.name],
    ['Cliente', 'Nombre, C.C. y fecha'],
  ]);
}

function drawActa(doc, job, cfg) {
  let y = header(doc, cfg, 'Acta de entrega', 'y certificado de garantía', job.number, [
    ['Fecha de entrega', dmy(job.delivered_at)],
    ['Garantía hasta', dmy(job.warranty_until)],
    ['Recibió', job.received_by || ''],
  ]);
  y = twoColumns(doc, y, job, serviceRows(job));
  y = paragraph(doc, y, 'Trabajo entregado', job.description);

  y = brand.ensureSpace(doc, y, 80);
  doc.rect(PAGE.L, y, PAGE.W, 60).fill(C.paper);
  doc.rect(PAGE.L, y, 3, 60).fill(C.red);
  const months = Number(job.warranty_months) || 0;
  doc.font(F.bold).fontSize(16).fillColor(C.ink).text(months ? `Garantía de ${months} ${months === 1 ? 'mes' : 'meses'}` : 'Sin garantía', PAGE.L + 18, y + 13, { lineBreak: false });
  doc.font(F.regular).fontSize(8.5).fillColor(C.smoke).text(months ? `Vigente desde la entrega hasta el ${dmy(job.warranty_until)}.` : 'Este trabajo no tiene garantía.', PAGE.L + 18, y + 37, { lineBreak: false });
  y += 78;

  const terms = String(cfg.terms || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (terms.length && months) {
    y = brand.ensureSpace(doc, y, 50);
    y = brand.sectionHeading(doc, 'Condiciones de la garantía', PAGE.L, y);
    y = brand.bulletList(doc, PAGE.L, y, PAGE.W, terms);
  }
  y = brand.ensureSpace(doc, y + 14, 20);
  y = brand.thanksLine(doc, y);
  signatures(doc, y + 6, [
    ['Entrega', cfg.name],
    ['Recibe a satisfacción', job.received_by || 'Nombre, C.C. y fecha'],
  ]);
}

const DOCS = {
  orden: { title: 'Orden de trabajo', file: 'Orden-de-trabajo', draw: drawOrden },
  acta: { title: 'Acta de entrega', file: 'Acta-de-entrega', draw: drawActa },
};

module.exports = { DOCS, settings };
