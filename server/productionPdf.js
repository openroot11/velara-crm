// Documentos de Producción (sección 22 de la especificación), generados de
// los datos de la OP para que nadie vuelva a escribirlos en Word:
//   orden       -> Orden de Producción (documento oficial, con firmas)
//   ficha       -> Ficha de producción (técnica: características, specs,
//                  materiales y diseño vigente)
//   fabricacion -> Documento de fabricación (para el piso: tareas con
//                  casillas para marcar a mano)
//   acta        -> Acta de entrega y certificado de garantía
// Misma identidad visual que el PDF de cotización (routes/quotations.js).

const path = require('path');
const fs = require('fs');
const { getSetting } = require('./db');
const brand = require('./pdfBrand');

const UPLOAD_ROOT = path.join(__dirname, 'data', 'uploads');
// Colores, tipografía y márgenes de la marca (ver pdfBrand.js).
const { C, F } = brand;
const INK = C.ink;
const SMOKE = C.smoke;
const LINE = C.line;
const ACCENT = C.red;
const { L, R, W, BOTTOM } = brand.PAGE;

const PRIORITY_LABEL = { baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
const TASK_LABEL = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada', bloqueada: 'Bloqueada' };
const REQ_LABEL = { pendiente: 'Pendiente', solicitado: 'Solicitado', disponible: 'Disponible', bloqueado: 'Bloqueado' };

const DEFAULT_WARRANTY_TERMS =
  'La garantía cubre defectos de costura, despegues y fallas en cierres atribuibles al trabajo del taller.\n' +
  'No cubre daños por mal uso, cortes, quemaduras, humedad prolongada, productos químicos ni desgaste normal.\n' +
  'Para hacerla efectiva, presente esta acta (o el número de la orden) y traiga el vehículo o la pieza al taller.';

function dmy(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
// Fecha/hora UTC de la base -> fecha local de Colombia.
function dmyLocal(utc) {
  if (!utc) return '—';
  const d = new Date(new Date(`${String(utc).replace(' ', 'T')}Z`).getTime() - 5 * 3600000);
  return dmy(d.toISOString());
}
function qty(n) {
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

async function companySettings() {
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

// Encabezado de la papelería VELARA (logo, datos de la empresa, título con
// filete rojo) + folio a la derecha: la primera fila de `meta` es el N.º y
// el resto van como filas etiqueta/valor. También deja listo el pie de
// marca en cada página (brand.setup).
function header(doc, cfg, title, subtitle, meta) {
  brand.setup(doc, cfg);
  brand.drawLetterhead(doc, cfg);
  const titleBottom = brand.drawTitle(doc, title, 168, subtitle);
  const [[, number], ...rows] = meta;
  const metaBottom = brand.drawDocMeta(doc, 362, 132, number, rows);
  return Math.max(titleBottom + 28, metaBottom + 14);
}

// Salto de página si no cabe `need` puntos más.
function ensure(doc, y, need) {
  if (y + need <= BOTTOM) return y;
  doc.addPage();
  return 50;
}

function heading(doc, y, text) {
  y = ensure(doc, y, 40);
  doc.font(F.semibold).fontSize(7.5).fillColor(INK).text(text.toUpperCase(), L, y, { width: W, characterSpacing: 1.1 });
  doc.moveTo(L, y + 13).lineTo(R, y + 13).lineWidth(0.5).strokeColor(LINE).stroke();
  return y + 21;
}

// Filas etiqueta/valor en dos columnas.
function fieldGrid(doc, y, rows) {
  const colW = (W - 20) / 2;
  const clean = rows.filter(([, v]) => v !== undefined);
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.slice(i, i + 2);
    doc.font(F.semibold).fontSize(9);
    const h = Math.max(...pair.map(([, v]) => doc.heightOfString(String(v || '—'), { width: colW })));
    y = ensure(doc, y, h + 22);
    pair.forEach(([label, value], j) => {
      const x = L + j * (colW + 20);
      doc.font(F.regular).fontSize(7.5).fillColor(SMOKE).text(label, x, y, { width: colW });
      doc.font(F.semibold).fontSize(9).fillColor(INK).text(String(value || '—'), x, y + 10, { width: colW });
    });
    y += 10 + h + 8;
  }
  return y;
}

function specsList(doc, y, specs) {
  if (!specs.length) {
    doc.font(F.regular).fontSize(9).fillColor(SMOKE).text('Sin registrar.', L, y);
    return y + 16;
  }
  for (const s of specs) {
    doc.font(F.regular).fontSize(9);
    const h = doc.heightOfString(s.value || '—', { width: W - 160 });
    y = ensure(doc, y, h + 8);
    doc.font(F.regular).fontSize(8.5).fillColor(SMOKE).text(s.label, L, y, { width: 150 });
    doc.font(F.regular).fontSize(9).fillColor(INK).text(s.value || '—', L + 160, y, { width: W - 160 });
    y += h + 6;
  }
  return y + 4;
}

function paragraph(doc, y, text) {
  const t = text && String(text).trim() ? String(text) : 'Ninguna.';
  doc.font(F.regular).fontSize(9);
  const h = doc.heightOfString(t, { width: W });
  y = ensure(doc, y, h + 8);
  doc.fillColor(INK).text(t, L, y, { width: W });
  return y + h + 10;
}

function table(doc, y, cols, rows) {
  const drawHead = (yy) => {
    doc.rect(L, yy, W, 18).fillColor(C.graphite).fill();
    let x = L + 4;
    for (const c of cols) {
      doc.font(F.semibold).fontSize(7).fillColor('#FFFFFF').text(c.label, x, yy + 6, { width: c.w - 8, align: c.align || 'left', characterSpacing: 0.8 });
      x += c.w;
    }
    return yy + 22;
  };
  y = ensure(doc, y, 40);
  y = drawHead(y);
  if (!rows.length) {
    doc.font(F.regular).fontSize(9).fillColor(SMOKE).text('Sin registros.', L + 4, y + 2);
    return y + 20;
  }
  for (const r of rows) {
    doc.font(F.regular).fontSize(8.5);
    const h = Math.max(12, ...cols.map((c, i) => doc.heightOfString(String(r[i] ?? ''), { width: c.w - 8 })));
    if (y + h + 6 > BOTTOM) {
      doc.addPage();
      y = drawHead(50);
    }
    let x = L + 4;
    cols.forEach((c, i) => {
      doc.font(c.bold ? F.semibold : F.regular).fontSize(8.5).fillColor(INK).text(String(r[i] ?? ''), x, y + 2, { width: c.w - 8, align: c.align || 'left' });
      x += c.w;
    });
    y += h + 6;
    doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
  }
  return y + 6;
}

function signatures(doc, y, labels, images = []) {
  y = ensure(doc, Math.max(y + 30, y), 90);
  const n = labels.length;
  const gap = 40;
  const sw = (W - gap * (n - 1)) / n;
  labels.forEach((label, i) => {
    const x = L + i * (sw + gap);
    if (images[i] && fs.existsSync(images[i])) {
      try {
        doc.image(images[i], x + sw / 2 - 60, y, { fit: [120, 45] });
      } catch {
        /* firma ilegible: queda la línea */
      }
    }
    doc.moveTo(x, y + 50).lineTo(x + sw, y + 50).lineWidth(0.8).strokeColor(SMOKE).stroke();
    doc.font(F.regular).fontSize(8).fillColor(SMOKE).text(label, x, y + 56, { width: sw, align: 'center' });
  });
  return y + 80;
}

function currentDesign(op) {
  return op.files.find((f) => f.kind === 'diseno' && f.is_current) || null;
}
function imagePath(file) {
  if (!file || !/^image\/(png|jpe?g)$/.test(file.mime || '')) return null;
  const abs = path.resolve(UPLOAD_ROOT, file.stored_path);
  return abs.startsWith(path.resolve(UPLOAD_ROOT)) && fs.existsSync(abs) ? abs : null;
}

// ---- documentos ------------------------------------------------------------------

function drawOrden(doc, op, cfg) {
  let y = header(doc, cfg, 'Orden de Producción', null, [
    ['OP', op.number],
    ['Pedido', op.sales_order_number],
    ['Prioridad', PRIORITY_LABEL[op.priority]],
    ['Estado', op.status_label],
  ]);
  y = heading(doc, y, 'Cliente');
  y = fieldGrid(doc, y, [
    ['Cliente', op.client_name],
    ['Contacto', op.contact || op.client_name],
    ['Teléfono', op.phone],
    ['Dirección / destino', [op.address, op.destination].filter(Boolean).join(' · ') || null],
    ['Asesor comercial', op.advisor_name],
    ['Responsable de producción', op.responsible_name],
  ]);
  y = heading(doc, y, 'Producto');
  y = fieldGrid(doc, y, [
    ['Producto', op.product_name],
    ['Código', op.product_code],
    ['Cantidad', `${qty(op.quantity)} ${op.unit}`],
    ['Fecha de recepción', dmyLocal(op.received_at)],
    ['Entrega solicitada', dmy(op.requested_date)],
    ['Entrega comprometida', dmy(op.committed_date)],
  ]);
  y = heading(doc, y, 'Características');
  y = specsList(doc, y, op.specs.filter((s) => s.section === 'producto'));
  y = heading(doc, y, 'Especificaciones técnicas');
  y = specsList(doc, y, op.specs.filter((s) => s.section === 'tecnica'));
  y = heading(doc, y, 'Materiales');
  y = table(
    doc,
    y,
    [{ label: 'MATERIAL', w: 250, bold: true }, { label: 'CÓDIGO', w: 90 }, { label: 'CANTIDAD', w: 90, align: 'right' }, { label: 'ESTADO', w: 82 }],
    op.requirements.map((r) => [r.material, r.code || '', `${qty(r.qty)} ${r.unit}`, REQ_LABEL[r.status] || r.status])
  );
  const design = currentDesign(op);
  y = heading(doc, y, 'Diseño');
  y = paragraph(doc, y, design ? `${design.group_name} · versión ${design.version} (vigente) · ${design.original_name}` : 'Sin diseño cargado.');
  y = heading(doc, y, 'Observaciones');
  y = paragraph(doc, y, op.observations);
  const approval = op.approvals[0];
  const sig = approval && approval.signature_path ? path.resolve(UPLOAD_ROOT, approval.signature_path) : null;
  signatures(doc, y, [`Asesor${approval ? ` · ${approval.signed_name}` : ''}`, `Producción${op.responsible_name ? ` · ${op.responsible_name}` : ''}`], [sig, null]);
}

function drawFicha(doc, op, cfg) {
  let y = header(doc, cfg, 'Ficha de producción', `${op.product_name} · ${qty(op.quantity)} ${op.unit}`, [
    ['OP', op.number],
    ['Cliente', op.client_name],
    ['Entrega', dmy(op.committed_date)],
  ]);
  const design = currentDesign(op);
  const img = imagePath(design);
  if (img) {
    y = heading(doc, y, `Diseño vigente · ${design.group_name} v${design.version}`);
    y = ensure(doc, y, 230);
    try {
      doc.image(img, L, y, { fit: [W, 220], align: 'center' });
      y += 228;
    } catch {
      y = paragraph(doc, y, `${design.original_name} (no se pudo mostrar la imagen)`);
    }
  } else if (design) {
    y = heading(doc, y, 'Diseño vigente');
    y = paragraph(doc, y, `${design.group_name} · versión ${design.version} · ${design.original_name}`);
  }
  y = heading(doc, y, 'Características del producto');
  y = specsList(doc, y, op.specs.filter((s) => s.section === 'producto'));
  y = heading(doc, y, 'Especificaciones técnicas');
  y = specsList(doc, y, op.specs.filter((s) => s.section === 'tecnica'));
  y = heading(doc, y, 'Materiales requeridos');
  y = table(
    doc,
    y,
    [{ label: 'MATERIAL', w: 240, bold: true }, { label: 'CÓDIGO', w: 80 }, { label: 'CANTIDAD', w: 90, align: 'right' }, { label: 'NOTA', w: 102 }],
    op.requirements.map((r) => [r.material, r.code || '', `${qty(r.qty)} ${r.unit}`, r.notes || ''])
  );
  y = heading(doc, y, 'Instrucciones / observaciones');
  paragraph(doc, y, op.observations);
}

function drawFabricacion(doc, op, cfg) {
  let y = header(doc, cfg, 'Documento de fabricación', 'Marque cada tarea al terminarla', [
    ['OP', op.number],
    ['Producto', `${op.product_name} · ${qty(op.quantity)} ${op.unit}`],
    ['Responsable', op.responsible_name],
    ['Entrega', dmy(op.committed_date)],
  ]);
  y = heading(doc, y, 'Tareas');
  // Primera columna vacía: es la casilla para marcar a mano en el taller.
  y = table(
    doc,
    y,
    [{ label: 'OK', w: 26 }, { label: 'TAREA', w: 166, bold: true }, { label: 'OPERARIO', w: 100 }, { label: 'FECHA PREVISTA', w: 80 }, { label: 'ESTADO', w: 70 }, { label: 'FIRMA', w: 70 }],
    op.tasks.map((t) => ['', t.name, t.worker_name || '', dmy(t.planned_date), TASK_LABEL[t.status] || t.status, ''])
  );
  y = heading(doc, y, 'Características a cumplir');
  y = specsList(doc, y, [...op.specs.filter((s) => s.section === 'producto'), ...op.specs.filter((s) => s.section === 'tecnica')]);
  y = heading(doc, y, 'Control de calidad (al terminar)');
  const checks = ['Producto terminado', 'Cantidad correcta', 'Medidas correctas', 'Características', 'Acabados', 'Diseño correcto'];
  for (const c of checks) {
    y = ensure(doc, y, 18);
    doc.rect(L, y, 10, 10).lineWidth(0.8).strokeColor(SMOKE).stroke();
    doc.font(F.regular).fontSize(9).fillColor(INK).text(c, L + 18, y + 1);
    y += 16;
  }
  y = heading(doc, y + 6, 'Observaciones del taller');
  for (let i = 0; i < 4; i++) {
    y = ensure(doc, y, 22);
    doc.moveTo(L, y + 16).lineTo(R, y + 16).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 22;
  }
  signatures(doc, y, ['Operario', 'Revisó']);
}

function drawActa(doc, op, cfg) {
  const delivered = op.deliveries.filter((d) => d.kind === 'entregada').slice(-1)[0];
  let y = header(doc, cfg, 'Acta de entrega', 'y certificado de garantía', [
    ['OP', op.number],
    ['Fecha de entrega', delivered ? dmy(delivered.date) : dmyLocal(op.delivered_at)],
    ['Garantía hasta', dmy(op.warranty_until)],
  ]);
  y = heading(doc, y, 'Cliente y trabajo');
  y = fieldGrid(doc, y, [
    ['Cliente', op.client_name],
    ['Teléfono', op.phone],
    ['Producto', `${op.product_name} · ${qty(op.quantity)} ${op.unit}`],
    ['Recibió', delivered ? delivered.received_by : null],
  ]);
  y = specsList(doc, y, op.specs.filter((s) => s.section === 'producto'));
  y = ensure(doc, y + 6, 80);
  doc.rect(L, y, W, 60).fillColor(C.paper).fill();
  doc.rect(L, y, 3, 60).fillColor(ACCENT).fill();
  doc.font(F.bold).fontSize(16).fillColor(INK).text(`Garantía de ${op.warranty_months} ${op.warranty_months === 1 ? 'mes' : 'meses'}`, L + 18, y + 12);
  doc.font(F.regular).fontSize(9).fillColor(SMOKE).text(`Vigente desde la entrega hasta el ${dmy(op.warranty_until)}.`, L + 18, y + 36);
  y += 78;
  y = heading(doc, y, 'Condiciones de la garantía');
  for (const line of String(cfg.terms || '').split('\n').filter((l) => l.trim())) {
    doc.font(F.regular).fontSize(8.5);
    const h = doc.heightOfString(line.trim(), { width: W - 12 });
    y = ensure(doc, y, h + 6);
    doc.circle(L + 3, y + 4.2, 1.2).fillColor(INK).fill();
    doc.fillColor(INK).text(line.trim(), L + 12, y, { width: W - 12 });
    y += h + 5;
  }
  signatures(doc, y + 20, [`Entrega · ${cfg.name}`, 'Recibe a satisfacción · Cliente']);
}

const DOCS = {
  orden: { title: 'Orden-de-produccion', draw: drawOrden },
  ficha: { title: 'Ficha-de-produccion', draw: drawFicha },
  fabricacion: { title: 'Documento-de-fabricacion', draw: drawFabricacion },
  acta: { title: 'Acta-de-entrega', draw: drawActa },
};

module.exports = { DOCS, companySettings };
