// Identidad visual de VELARA para todos los PDF del CRM (cotización,
// factura, documentos de producción). Sigue la papelería oficial del
// diseñador (Velara/VELARA_IDENTIDAD_VISUAL/02_PAPELERIA y el manual de
// marca): logo con eslogan arriba a la izquierda, datos de la empresa a la
// derecha, título en mayúsculas con filete rojo corto, encabezado de tabla
// en grafito, total en bloque rojo, y al pie los datos de contacto más las
// franjas de marca a 47,4° saliendo de la esquina inferior derecha.
//
// El logo se dibuja como vector (los <path> del SVG oficial), no como
// imagen, así sale nítido a cualquier tamaño. Tipografía: Inter, la
// secundaria del manual (archivos en server/assets/fonts, licencia OFL).

const path = require('path');
const fs = require('fs');

const ASSETS = path.join(__dirname, 'assets');

// Paleta del manual de marca (sección 03 · Color y tipografía).
const C = {
  ink: '#0B0B0B', // negro carbón
  graphite: '#252525', // grafito -- encabezados de tabla
  smoke: '#5E6064', // texto secundario (plata oscurecida para leerse en papel)
  silver: '#A7A9AC', // plata metálico
  silverLight: '#CFCFD1',
  line: '#D9D7D0', // filetes de campos y filas
  paper: '#F2F0EA', // blanco roto
  red: '#D71920', // rojo deportivo
};

const F = {
  regular: 'Inter',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
};

// Página carta con márgenes de la plantilla (45 pt a cada lado).
const PAGE = { L: 45, R: 567, W: 522, BOTTOM: 746 };

// ---- logo vectorial -----------------------------------------------------------
const logoCache = {};
function loadSvgLogo(name) {
  if (logoCache[name]) return logoCache[name];
  const svg = fs.readFileSync(path.join(ASSETS, 'brand', `${name}.svg`), 'utf8');
  const [, vbW, vbH] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const paths = [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((m) => ({ fill: m[1], d: m[2] }));
  logoCache[name] = { w: Number(vbW), h: Number(vbH), paths };
  return logoCache[name];
}

// Dibuja el logo (con eslogan por defecto) con su esquina superior izquierda
// en (x, y) y el ancho dado. Devuelve la altura que ocupó.
function drawLogo(doc, x, y, width, { slogan = true } = {}) {
  const logo = loadSvgLogo(slogan ? 'logo-eslogan-positivo' : 'logo-positivo');
  const s = width / logo.w;
  doc.save();
  doc.translate(x, y).scale(s);
  for (const p of logo.paths) doc.path(p.d).fill(p.fill);
  doc.restore();
  return logo.h * s;
}

// ---- tipografía y pie automático -------------------------------------------
// Registra Inter y deja el pie de marca dibujado en la primera página y en
// cada página nueva que se agregue después.
function setup(doc, cfg) {
  doc.registerFont(F.regular, path.join(ASSETS, 'fonts', 'Inter-Regular.ttf'));
  doc.registerFont(F.medium, path.join(ASSETS, 'fonts', 'Inter-Medium.ttf'));
  doc.registerFont(F.semibold, path.join(ASSETS, 'fonts', 'Inter-SemiBold.ttf'));
  doc.registerFont(F.bold, path.join(ASSETS, 'fonts', 'Inter-Bold.ttf'));
  doc.font(F.regular);
  drawFooter(doc, cfg);
  doc.on('pageAdded', () => drawFooter(doc, cfg));
}

// Franjas de marca (plata, plata clara, roja) a 47,4°, cortadas por el borde
// de la hoja -- "siempre salen del borde, nunca flotan".
function drawStripes(doc) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const h = 40;
  const top = pageH - h;
  const run = h / Math.tan((47.4 * Math.PI) / 180);
  const stripes = [
    { x: pageW - 115, w: 29, color: C.silver },
    { x: pageW - 76.4, w: 29, color: C.silverLight },
    { x: pageW - 37.8, w: 14.4, color: C.red },
  ];
  doc.save();
  doc.rect(0, 0, pageW, pageH).clip();
  for (const s of stripes) {
    doc
      .polygon([s.x, top], [s.x + s.w, top], [s.x + s.w + run, pageH], [s.x + run, pageH])
      .fill(s.color);
  }
  doc.restore();
}

function contactParts(cfg) {
  return [cfg.web, formatPhone(cfg.phone), cityOf(cfg.address)].filter(Boolean);
}

function drawFooter(doc, cfg) {
  // El pie va por debajo del margen inferior: sin esto pdfkit agregaría una
  // página nueva al escribirlo (y el pie de esa página otra, sin fin).
  doc.page.margins.bottom = 0;
  const y = doc.page.height - 30;
  doc.font(F.regular).fontSize(7.5).fillColor(C.smoke);
  doc.text(contactParts(cfg).join('   |   '), PAGE.L, y, { width: 380, lineBreak: false, characterSpacing: 0.2 });
  drawStripes(doc);
  // Margen real para el contenido: deja escribir hasta PAGE.BOTTOM sin que
  // pdfkit salte de página antes de tiempo, y sin pisar el pie.
  doc.page.margins.bottom = 32;
  doc.fillColor(C.ink);
}

// ---- encabezado ----------------------------------------------------------------
// Logo a la izquierda, bloque de la empresa alineado a la derecha.
// Devuelve la Y donde termina el encabezado.
function drawLetterhead(doc, cfg) {
  drawLogo(doc, PAGE.L, 40, 158);
  let y = 41;
  doc.font(F.semibold).fontSize(8.5).fillColor(C.ink);
  doc.text(String(cfg.name || 'Velara Taller S.A.S.').toUpperCase(), PAGE.L + 200, y, { width: PAGE.W - 200, align: 'right', characterSpacing: 0.6 });
  y += 13;
  const lines = [
    cfg.nit ? `NIT ${cfg.nit}` : null,
    cfg.address || null,
    [formatPhone(cfg.phone), cfg.email].filter(Boolean).join(' · ') || null,
    cfg.web || null,
  ].filter(Boolean);
  doc.font(F.regular).fontSize(7.5).fillColor(C.smoke);
  for (const line of lines) {
    doc.text(line, PAGE.L + 200, y, { width: PAGE.W - 200, align: 'right' });
    y += 10.5;
  }
  return Math.max(y, 100);
}

// Título grande en mayúsculas + subtítulo opcional + filete rojo corto.
// Devuelve la Y bajo el filete.
function drawTitle(doc, title, y, subtitle) {
  // Siempre en una línea: los títulos largos ("Documento de fabricación")
  // bajan de tamaño hasta caber al lado del bloque de N.º.
  const text = title.toUpperCase();
  const maxW = 305;
  let size = 26;
  doc.font(F.bold);
  while (size > 15 && doc.fontSize(size).widthOfString(text) > maxW) size -= 1;
  const top = y + (26 - size) * 0.8;
  doc.fontSize(size).fillColor(C.ink).text(text, PAGE.L, top, { lineBreak: false });
  let ruleY = top + size * 1.3;
  if (subtitle) {
    doc.font(F.medium).fontSize(7.5).fillColor(C.smoke).text(fitText(doc, subtitle.toUpperCase(), maxW, 1.4), PAGE.L, ruleY - 3, { lineBreak: false, characterSpacing: 1.4 });
    ruleY += 14;
  }
  doc.rect(PAGE.L, ruleY, 35, 2.6).fill(C.red);
  return ruleY + 2.6;
}

// Bloque de datos del documento (derecha): "N.º" grande con línea roja o
// gris, y filas etiqueta/valor sobre un filete fino.
function drawDocMeta(doc, x, y, number, rows, { redLine = false } = {}) {
  const w = PAGE.R - x;
  doc.font(F.bold).fontSize(11).fillColor(C.ink).text('N.º', x, y, { lineBreak: false });
  doc.font(F.semibold).fontSize(10.5).text(number || '—', x + 27, y + 0.5, { width: w - 27, lineBreak: false });
  doc
    .moveTo(x + 23, y + 14)
    .lineTo(PAGE.R, y + 14)
    .lineWidth(redLine ? 0.8 : 0.6)
    .strokeColor(redLine ? C.red : C.ink)
    .stroke();
  let ry = y + 27;
  const valueX = x + 97;
  for (const [label, value] of rows) {
    doc.font(F.regular).fontSize(8).fillColor(C.smoke).text(label, x, ry, { width: 95, lineBreak: false });
    doc.font(F.medium).fontSize(8.5).fillColor(C.ink);
    const v = fitText(doc, String(value || '—'), PAGE.R - valueX);
    doc.text(v, PAGE.R - doc.widthOfString(v), ry - 0.5, { lineBreak: false });
    doc.moveTo(valueX, ry + 11).lineTo(PAGE.R, ry + 11).lineWidth(0.5).strokeColor(C.line).stroke();
    ry += 19;
  }
  return ry;
}

// Recorta el texto con "…" para que quepa en una línea del ancho dado (con
// la fuente y el tamaño que ya tenga puestos el documento).
function fitText(doc, text, width, characterSpacing = 0) {
  const w = (t) => doc.widthOfString(t, { characterSpacing });
  if (w(text) <= width) return text;
  let t = text;
  while (t.length > 1 && w(t + '…') > width) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

// Encabezado de sección en versalitas (DATOS DEL CLIENTE, CONDICIONES...).
function sectionHeading(doc, text, x, y, width = 250) {
  doc.font(F.semibold).fontSize(7.5).fillColor(C.ink).text(text.toUpperCase(), x, y, { width, characterSpacing: 1.1, lineBreak: false });
  return y + 17;
}

// Fila etiqueta / valor con filete debajo del valor (estilo formulario de la
// plantilla). El valor puede ocupar varias líneas. Devuelve la Y siguiente.
function fieldRow(doc, x, y, labelW, totalW, label, value) {
  const vx = x + labelW;
  const vw = totalW - labelW;
  const text = value == null || value === '' ? '—' : String(value);
  doc.font(F.regular).fontSize(8).fillColor(C.smoke).text(label, x, y, { width: labelW - 6 });
  const labelH = doc.heightOfString(label, { width: labelW - 6 });
  doc.font(F.medium).fontSize(8.5).fillColor(C.ink);
  const h = doc.heightOfString(text, { width: vw });
  doc.text(text, vx, y - 0.5, { width: vw });
  const bottom = y + Math.max(h, labelH, 10) + 2;
  doc.moveTo(vx, bottom).lineTo(x + totalW, bottom).lineWidth(0.5).strokeColor(C.line).stroke();
  return bottom + 7;
}

// Tabla con encabezado grafito. `cols` = [{ key, label, x, w, align }].
// `rows` = objetos con el texto ya formateado por columna; una columna puede
// traer { text, sub } para un renglón secundario más chico. Corta página
// cuando no cabe y repite el encabezado.
function drawTable(doc, y, cols, rows, { minRows = 0 } = {}) {
  const header = () => {
    doc.rect(PAGE.L, y, PAGE.W, 19).fill(C.graphite);
    doc.font(F.semibold).fontSize(7).fillColor('#FFFFFF');
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), c.x, y + 6.5, { width: c.w, align: c.align || 'left', characterSpacing: 0.8, lineBreak: false });
    }
    y += 19;
  };
  header();
  const all = rows.slice();
  while (all.length < minRows) all.push(null);
  all.forEach((row, i) => {
    let rowH = 18.5;
    if (row) {
      for (const c of cols) {
        const cell = row[c.key];
        if (cell == null) continue;
        const main = typeof cell === 'object' ? cell.text : cell;
        const sub = typeof cell === 'object' ? cell.sub : null;
        let h = doc.font(c.bold ? F.semibold : F.regular).fontSize(8.5).heightOfString(String(main || ''), { width: c.w });
        if (sub) h += doc.font(F.regular).fontSize(7.5).heightOfString(String(sub), { width: c.w }) + 2;
        rowH = Math.max(rowH, h + 10);
      }
    }
    if (y + rowH > PAGE.BOTTOM) {
      doc.addPage();
      y = 50;
      header();
    }
    if (row) {
      for (const c of cols) {
        const cell = row[c.key];
        if (cell == null) continue;
        const main = typeof cell === 'object' ? cell.text : cell;
        const sub = typeof cell === 'object' ? cell.sub : null;
        const subColor = typeof cell === 'object' && cell.subColor ? cell.subColor : C.smoke;
        doc.font(c.bold ? F.semibold : F.regular).fontSize(8.5).fillColor(c.muted ? C.smoke : C.ink);
        const mh = doc.heightOfString(String(main || ''), { width: c.w });
        doc.text(String(main || ''), c.x, y + 5.5, { width: c.w, align: c.align || 'left' });
        if (sub) doc.font(F.regular).fontSize(7.5).fillColor(subColor).text(String(sub), c.x, y + 5.5 + mh + 2, { width: c.w, align: c.align || 'left' });
      }
    } else {
      // Fila vacía numerada, como la plantilla impresa.
      doc.font(F.regular).fontSize(8.5).fillColor(C.silver).text(String(i + 1), cols[0].x, y + 5.5, { width: cols[0].w, align: cols[0].align || 'left' });
    }
    y += rowH;
    doc.moveTo(PAGE.L, y).lineTo(PAGE.R, y).lineWidth(0.5).strokeColor(C.line).stroke();
  });
  return y;
}

// Totales a la derecha: filas con filete y la última en bloque rojo.
// `rows` = [[label, value], ...]; la última es el total.
function drawTotals(doc, y, rows) {
  const x = PAGE.L + 302;
  const w = PAGE.R - x;
  rows.forEach(([label, value], i) => {
    const last = i === rows.length - 1;
    if (last) {
      doc.rect(x, y, w, 22).fill(C.red);
      doc.font(F.bold).fontSize(10).fillColor('#FFFFFF');
      doc.text(label, x + 7, y + 6.5, { width: w / 2, lineBreak: false });
      doc.text(value, x + w / 2, y + 6.5, { width: w / 2 - 7, align: 'right', lineBreak: false });
      y += 22;
    } else {
      doc.font(F.regular).fontSize(8.5).fillColor(C.ink);
      doc.text(label, x + 7, y + 5, { width: w / 2, lineBreak: false });
      doc.text(value, x + w / 2, y + 5, { width: w / 2 - 7, align: 'right', lineBreak: false });
      y += 19;
      doc.moveTo(x, y).lineTo(PAGE.R, y).lineWidth(0.5).strokeColor(C.line).stroke();
    }
  });
  return y;
}

// Lista con viñetas (condiciones comerciales, notas).
function bulletList(doc, x, y, width, lines) {
  doc.font(F.regular).fontSize(8).fillColor(C.ink);
  for (const line of lines) {
    const h = doc.heightOfString(line, { width: width - 11 });
    if (y + h > PAGE.BOTTOM) {
      doc.addPage();
      y = 50;
      doc.font(F.regular).fontSize(8).fillColor(C.ink);
    }
    doc.circle(x + 2, y + 4.2, 1.1).fill(C.ink);
    doc.fillColor(C.ink).text(line, x + 11, y, { width: width - 11 });
    y += h + 3.5;
  }
  return y;
}

// Línea de cierre: "Gracias por confiar en VELARA." + eslogan.
function thanksLine(doc, y) {
  doc.font(F.semibold).fontSize(9).fillColor(C.ink).text('Gracias por confiar en VELARA. ', PAGE.L, y, { continued: true });
  doc.font(F.regular).fillColor(C.smoke).text('Soluciones a medida para su vehículo, su negocio y sus proyectos.');
  return y + 14;
}

// Corta página si lo que sigue (alto h) no cabe. Devuelve la Y a usar.
function ensureSpace(doc, y, h) {
  if (y + h > PAGE.BOTTOM) {
    doc.addPage();
    return 50;
  }
  return y;
}

// "3003666093" -> "+57 300 366 6093"; deja tal cual lo que ya trae formato.
function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits;
  if (local.length === 10) return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  return String(phone).trim();
}

// "Calle 56 # 12C-02, Local 3, Barranquilla, Atlántico" -> "Barranquilla, Colombia".
function cityOf(address) {
  return /barranquilla/i.test(String(address || '')) ? 'Barranquilla, Colombia' : '';
}

module.exports = {
  C,
  F,
  PAGE,
  setup,
  drawLogo,
  drawLetterhead,
  drawTitle,
  drawDocMeta,
  sectionHeading,
  fieldRow,
  drawTable,
  drawTotals,
  bulletList,
  thanksLine,
  ensureSpace,
  formatPhone,
};
