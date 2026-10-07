import { escapeHtml, formatMoney } from '../utils.js';
import { openQuickSaleModal } from '../components/quickSaleModal.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function clampToToday(dateStr) {
  return dateStr > todayStr() ? todayStr() : dateStr;
}

function isFutureDate(dateStr) {
  return dateStr > todayStr();
}

function formatDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const txt = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function parseSqliteDatetime(value) {
  if (!value) return null;
  const [datePart, timePart = '00:00:00'] = value.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, second || 0);
}

function timeLabel(sqliteDatetime) {
  const d = parseSqliteDatetime(sqliteDatetime);
  if (!d) return '';
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function pad(str, len) {
  str = String(str);
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function col(value, width) {
  return pad(String(value), width);
}

function statsTableBlock(asesores, totales) {
  const lines = [];
  lines.push('```');
  lines.push(`${col('ASESOR', 9)}${col('ASIG', 6)}${col('CONT', 6)}${col('COT', 5)}${col('PEND', 5)}${col('SEG', 5)}`.trimEnd());
  asesores.forEach((a) => {
    const name = a.name.length > 8 ? a.name.slice(0, 8) : a.name;
    lines.push(
      `${col(name, 9)}${col(a.asignados, 6)}${col(a.contactados, 6)}${col(a.cotizados, 5)}${col(a.pendientes, 5)}${col(a.seguimientos, 5)}`.trimEnd()
    );
  });
  lines.push(
    `${col('TOTAL', 9)}${col(totales.asignados, 6)}${col(totales.contactados, 6)}${col(totales.cotizados, 5)}${col(totales.pendientes, 5)}${col(totales.seguimientos, 5)}`.trimEnd()
  );
  lines.push('```');
  return lines;
}

function seguimientosLines(asesores, seguimientos) {
  if (!seguimientos.length) return ['• No se registraron seguimientos hoy.'];
  const lines = [];
  asesores.forEach((a) => {
    const propios = seguimientos.filter((s) => s.advisor_id === a.advisor_id);
    propios.forEach((s) => lines.push(`• ${s.cliente} — ${a.name}`));
  });
  return lines;
}

function reasignadosLine(reasignados) {
  if (!reasignados || !reasignados.count) return ['Reasignados: 0'];
  const lines = [`Reasignados: ${reasignados.count}`];
  reasignados.detalle.forEach((r) => {
    lines.push(`• ${r.client_name}: ${r.from_advisor_name || '—'} → ${r.to_advisor_name || '—'}`);
  });
  return lines;
}

function ventasGroupedByAsesor(asesores, ventas) {
  const byName = new Map();
  ventas.forEach((v) => {
    const entry = byName.get(v.advisor_name) || { count: 0, total: 0 };
    entry.count += 1;
    entry.total += v.monto || 0;
    byName.set(v.advisor_name, entry);
  });
  const ordered = [];
  asesores.forEach((a) => {
    if (byName.has(a.name)) {
      ordered.push([a.name, byName.get(a.name)]);
      byName.delete(a.name);
    }
  });
  byName.forEach((entry, name) => ordered.push([name, entry]));
  return ordered;
}

function buildReportText(data) {
  const { fecha, asesores, ventas, seguimientos, totales, canales, reasignados } = data;
  const totalCanales = canales.whatsapp + canales.correo + canales.llamadas;

  const lines = [];
  lines.push('🧾 *INFORME DIARIO*');
  lines.push('📅 ' + formatDateDisplay(fecha));
  lines.push('');
  lines.push('─────────────────────');
  lines.push('📨 LEADS DEL DIA: ' + totalCanales);
  lines.push('─────────────────────');
  lines.push('💬 WhatsApp: ' + canales.whatsapp);
  lines.push('📧 Correo: ' + canales.correo);
  lines.push('📞 Llamadas: ' + canales.llamadas);
  lines.push('');
  lines.push('─────────────────────');
  lines.push('📊 *RESUMEN DEL DIA*');
  lines.push('─────────────────────');
  lines.push(...statsTableBlock(asesores, totales));
  lines.push(...reasignadosLine(reasignados));
  lines.push('─────────────────────');
  lines.push(`💰 *VENTAS: ${totales.ventas_count}*`);
  lines.push('─────────────────────');
  const grouped = ventasGroupedByAsesor(asesores, ventas);
  if (grouped.length === 0) {
    lines.push('• No se registraron ventas hoy.');
  } else {
    grouped.forEach(([name, entry]) => {
      lines.push(`• ${name}: ${entry.count} venta${entry.count === 1 ? '' : 's'} — ${formatMoney(entry.total)}`);
    });
  }
  lines.push('');
  lines.push(`✅ *TOTAL VENDIDO: ${formatMoney(totales.ventas_total)}*`);
  if (totales.declinados_count > 0) {
    lines.push('');
    lines.push(`❌ Declinados: ${totales.declinados_count}`);
  }
  lines.push('');
  lines.push('─────────────────────');
  lines.push(`📞 *SEGUIMIENTOS: ${totales.seguimientos}*`);
  lines.push('─────────────────────');
  lines.push(...seguimientosLines(asesores, seguimientos));

  return lines.join('\n');
}

// Version visual del mismo informe (iconos Material Symbols en vez de
// emojis) para el recuadro de pantalla y para exportar como imagen -- el
// texto de arriba (buildReportText) se sigue usando para "Copiar texto",
// pensado para pegar directo en un chat de WhatsApp.
function statChip(icon, value, label) {
  return `
    <div class="flex flex-col items-center gap-1 bg-surface rounded-lg border border-outline-variant px-3 py-3">
      <span class="material-symbols-outlined text-[20px] text-on-surface">${icon}</span>
      <span class="text-headline-sm font-headline-sm font-bold text-on-surface leading-none">${value}</span>
      <span class="text-[11px] text-on-surface-variant">${label}</span>
    </div>`;
}

function cardSectionHeader(icon, title, extra = '') {
  return `
    <div class="flex items-center gap-2 mb-2.5">
      <span class="material-symbols-outlined text-[18px] text-on-surface">${icon}</span>
      <h4 class="text-label-bold font-label-bold uppercase tracking-wider text-on-surface-variant">${title}</h4>
      ${extra ? `<span class="ml-auto text-body-sm font-bold text-on-surface">${escapeHtml(extra)}</span>` : ''}
    </div>`;
}

function reportCardHtml(data) {
  const { fecha, asesores, ventas, seguimientos, totales, canales, reasignados } = data;
  const totalCanales = canales.whatsapp + canales.correo + canales.llamadas;
  const grouped = ventasGroupedByAsesor(asesores, ventas);

  return `
    <div class="bg-surface rounded-xl overflow-hidden border border-outline-variant">
      <!-- Encabezado de marca (sale en la imagen que se manda por WhatsApp):
           negro carbón, logo oficial y franjas a 47,4° saliendo del borde. -->
      <div class="relative overflow-hidden bg-[#0B0B0B] text-[#F2F0EA] px-5 py-4 flex items-center gap-4">
        <svg class="absolute right-0 top-0 h-full w-[120px] pointer-events-none" viewBox="60 0 240 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          <polygon points="20,0 80,0 264,200 204,200" fill="#252525"/>
          <polygon points="100,0 160,0 344,200 284,200" fill="#1C1C1C"/>
          <polygon points="180,0 210,0 394,200 364,200" fill="#D71920"/>
        </svg>
        <img src="/img/brand/logo-negativo.svg" alt="Velara" class="relative w-[120px] h-auto shrink-0" />
        <div class="relative min-w-0 pl-4 border-l border-[#333]">
          <p class="text-headline-sm font-headline-sm font-extrabold leading-tight">Informe diario</p>
          <p class="text-body-sm font-body-sm text-[#A7A9AC] flex items-center gap-1 mt-0.5">
            <span class="material-symbols-outlined text-[14px]">calendar_today</span>${escapeHtml(formatDateDisplay(fecha))}
          </p>
        </div>
      </div>

      <section class="p-5 border-b border-outline-variant">
        ${cardSectionHeader('forum', 'Leads del día', String(totalCanales))}
        <div class="grid grid-cols-3 gap-2">
          ${statChip('forum', canales.whatsapp, 'WhatsApp')}
          ${statChip('mail', canales.correo, 'Correo')}
          ${statChip('call', canales.llamadas, 'Llamadas')}
        </div>
      </section>

      <section class="p-5 border-b border-outline-variant">
        ${cardSectionHeader('bar_chart', 'Resumen del día')}
        <div class="overflow-hidden rounded-lg border border-outline-variant">
          <table class="w-full text-left border-collapse text-body-sm">
            <thead>
              <tr class="bg-surface-container-low text-on-surface-variant">
                <th class="px-2.5 py-2 text-[11px] font-label-bold uppercase">Asesor</th>
                <th class="px-2 py-2 text-[11px] font-label-bold uppercase text-center">Asig</th>
                <th class="px-2 py-2 text-[11px] font-label-bold uppercase text-center">Cont</th>
                <th class="px-2 py-2 text-[11px] font-label-bold uppercase text-center">Cot</th>
                <th class="px-2 py-2 text-[11px] font-label-bold uppercase text-center">Pend</th>
                <th class="px-2 py-2 text-[11px] font-label-bold uppercase text-center">Seg</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant">
              ${asesores
                .map(
                  (a) => `
                <tr>
                  <td class="px-2.5 py-1.5 font-semibold text-on-surface">${escapeHtml(a.name)}</td>
                  <td class="px-2 py-1.5 text-center">${a.asignados}</td>
                  <td class="px-2 py-1.5 text-center">${a.contactados}</td>
                  <td class="px-2 py-1.5 text-center">${a.cotizados}</td>
                  <td class="px-2 py-1.5 text-center">${a.pendientes}</td>
                  <td class="px-2 py-1.5 text-center">${a.seguimientos}</td>
                </tr>`
                )
                .join('')}
              <tr class="font-bold bg-surface-container-low">
                <td class="px-2.5 py-1.5">Total</td>
                <td class="px-2 py-1.5 text-center">${totales.asignados}</td>
                <td class="px-2 py-1.5 text-center">${totales.contactados}</td>
                <td class="px-2 py-1.5 text-center">${totales.cotizados}</td>
                <td class="px-2 py-1.5 text-center">${totales.pendientes}</td>
                <td class="px-2 py-1.5 text-center">${totales.seguimientos}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${
          reasignados && reasignados.count
            ? `<div class="mt-2.5 flex items-center gap-1.5 text-body-sm text-on-surface-variant">
                <span class="material-symbols-outlined text-[16px]">swap_horiz</span>
                Reasignados: <b class="text-on-surface">${reasignados.count}</b>
              </div>`
            : ''
        }
      </section>

      <section class="p-5 border-b border-outline-variant">
        ${cardSectionHeader('payments', 'Ventas', String(totales.ventas_count))}
        ${
          grouped.length === 0
            ? `<p class="text-body-sm text-on-surface-variant">No se registraron ventas hoy.</p>`
            : `<div class="space-y-1.5">${grouped
                .map(
                  ([name, entry]) => `
                <div class="flex items-center justify-between bg-surface-container-low rounded-lg px-3 py-2">
                  <span class="text-body-sm font-semibold text-on-surface">${escapeHtml(name)}</span>
                  <span class="text-body-sm text-on-surface-variant">${entry.count} venta${entry.count === 1 ? '' : 's'} · <b class="text-on-surface">${formatMoney(entry.total)}</b></span>
                </div>`
                )
                .join('')}</div>`
        }
        <div class="mt-3 flex items-center justify-between bg-surface-container-low rounded-lg px-3 py-2.5">
          <span class="flex items-center gap-1.5 text-body-sm font-bold text-on-surface">
            <span class="material-symbols-outlined text-[18px]">check_circle</span>Total vendido
          </span>
          <span class="text-headline-sm font-headline-sm font-bold text-on-surface">${formatMoney(totales.ventas_total)}</span>
        </div>
        ${
          totales.declinados_count > 0
            ? `<div class="mt-2 flex items-center gap-1.5 text-body-sm text-error">
                <span class="material-symbols-outlined text-[16px]">cancel</span>Declinados: <b>${totales.declinados_count}</b>
              </div>`
            : ''
        }
      </section>

      <section class="p-5">
        ${cardSectionHeader('campaign', 'Seguimientos', String(totales.seguimientos))}
        ${
          seguimientos.length === 0
            ? `<p class="text-body-sm text-on-surface-variant">No se registraron seguimientos hoy.</p>`
            : `<div class="space-y-1.5">${seguimientos
                .map(
                  (s) => `
                <div class="flex items-center justify-between bg-surface-container-low rounded-lg px-3 py-2">
                  <span class="text-body-sm text-on-surface"><b class="font-semibold">${escapeHtml(s.cliente)}</b> <span class="text-on-surface-variant">— ${escapeHtml(s.advisor_name)}</span></span>
                  <span class="material-symbols-outlined text-[16px] text-on-surface-variant">call</span>
                </div>`
                )
                .join('')}</div>`
        }
      </section>

      <div class="px-5 py-3 bg-surface-container-low text-center text-[11px] text-on-surface-variant border-t border-outline-variant">
        Velara CRM · Velara Taller S.A.S.
      </div>
    </div>
  `;
}

export async function mount(container, ctx) {
  let currentDate = todayStr();

  container.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Informe Diario</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Datos reales del sistema, listos para enviar por WhatsApp.</p>
      </div>
      <div class="flex items-center gap-2 bg-surface border border-outline-variant rounded-lg p-1.5">
        <button id="btn-prev" class="p-1.5 rounded hover:bg-surface-container-low text-on-surface-variant" title="Día anterior">
          <span class="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
        <input id="date-input" type="date" class="text-body-sm font-body-sm border-0 focus:ring-0 outline-none bg-transparent" />
        <button id="btn-next" class="p-1.5 rounded hover:bg-surface-container-low text-on-surface-variant" title="Día siguiente">
          <span class="material-symbols-outlined text-[20px]">chevron_right</span>
        </button>
        <button id="btn-today" class="px-3 py-1.5 rounded text-label-bold font-label-bold text-on-surface hover:bg-surface-container-low">Hoy</button>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-12 gap-gutter items-start">
      <div class="xl:col-span-7 space-y-gutter">
        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Mensajes recibidos</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Todo lo que llega ese día, sin excepción — este número no lo sabe el sistema solo, se anota a mano.</p>
          <div class="flex flex-wrap items-end gap-4">
            <div class="flex-1 min-w-[140px]">
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1">💬 WhatsApp</label>
              <input id="canal-whatsapp" type="number" min="0" value="0" class="canal-input w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none" />
            </div>
            <div class="flex-1 min-w-[140px]">
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1">📧 Correo</label>
              <input id="canal-correo" type="number" min="0" value="0" class="canal-input w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none" />
            </div>
            <div class="flex-1 min-w-[140px]">
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1">📞 Llamadas</label>
              <input id="canal-llamadas" type="number" min="0" value="0" class="canal-input w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none" />
            </div>
            <div class="bg-surface-container-high text-on-surface rounded-lg px-5 py-2.5 text-center">
              <div id="canal-total" class="text-headline-md font-headline-md leading-none">0</div>
              <div class="text-label-bold font-label-bold uppercase tracking-wider mt-1">Total</div>
            </div>
          </div>
          <p id="canal-save-status" class="text-[11px] font-label-bold text-on-surface-variant mt-3">Los datos de canales se guardan automáticamente.</p>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Detalle por Asesor</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Tomados en vivo de Ventas — nadie los escribe a mano.</p>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[520px]">
              <thead>
                <tr class="bg-surface-container-low border-b border-outline-variant">
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Asignados</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Contactados</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Cotizados</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Pendientes</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Seguimientos</th>
                </tr>
              </thead>
              <tbody id="stats-tbody" class="divide-y divide-outline-variant"></tbody>
              <tfoot>
                <tr id="stats-totales-row" class="bg-surface-container-low font-bold"></tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <div class="flex items-center justify-between mb-1 gap-3 flex-wrap">
            <h3 class="text-headline-md font-headline-md text-on-surface">Ventas del día</h3>
            <button id="btn-quick-sale" class="btn btn-primary py-1.5">
              <span class="material-symbols-outlined text-[18px]">bolt</span> Registrar venta
            </button>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Se registran desde Ventas o SLA (botón "Cerrar"), o al vuelo aquí mismo con "Registrar venta".</p>
          <div id="ventas-list" class="divide-y divide-outline-variant"></div>
          <div id="ventas-empty" class="text-body-sm text-on-surface-variant py-4 text-center hidden">Sin ventas registradas este día.</div>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Declinados del día</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Leads cerrados como perdidos ese día — clientes con los que no se llegó a nada.</p>
          <div id="declinados-list" class="divide-y divide-outline-variant"></div>
          <div id="declinados-empty" class="text-body-sm text-on-surface-variant py-4 text-center hidden">Sin declinados este día.</div>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Seguimientos del día</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Cotizaciones a las que se les dio seguimiento ese día, desde la pantalla de Seguimiento.</p>
          <div id="seguimientos-list" class="divide-y divide-outline-variant"></div>
          <div id="seguimientos-empty" class="text-body-sm text-on-surface-variant py-4 text-center hidden">Sin seguimientos registrados este día.</div>
        </div>
      </div>

      <div class="xl:col-span-5">
        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6 sticky top-20">
          <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 class="text-headline-md font-headline-md text-on-surface">Informe para WhatsApp</h3>
            <div class="flex items-center gap-2">
              <button id="btn-copy" class="px-3 py-2 bg-surface-container-lowest text-on-surface border border-outline-variant rounded-md font-label-bold text-label-bold hover:bg-surface-container-low transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-[18px]">content_copy</span> Copiar texto
              </button>
              <button id="btn-download" class="btn btn-primary">
                <span class="material-symbols-outlined text-[18px]">download</span> Descargar imagen
              </button>
            </div>
          </div>
          <div id="report-card-wrap" class="bg-surface-container-low rounded-lg p-3">
            <div id="report-card"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const dateInput = container.querySelector('#date-input');
  const btnPrev = container.querySelector('#btn-prev');
  const btnNext = container.querySelector('#btn-next');
  const canalWhatsapp = container.querySelector('#canal-whatsapp');
  const canalCorreo = container.querySelector('#canal-correo');
  const canalLlamadas = container.querySelector('#canal-llamadas');
  const canalTotal = container.querySelector('#canal-total');
  const canalSaveStatus = container.querySelector('#canal-save-status');
  const statsTbody = container.querySelector('#stats-tbody');
  const statsTotalesRow = container.querySelector('#stats-totales-row');
  const ventasList = container.querySelector('#ventas-list');
  const ventasEmpty = container.querySelector('#ventas-empty');
  const declinadosList = container.querySelector('#declinados-list');
  const declinadosEmpty = container.querySelector('#declinados-empty');
  const seguimientosList = container.querySelector('#seguimientos-list');
  const seguimientosEmpty = container.querySelector('#seguimientos-empty');
  const reportCardEl = container.querySelector('#report-card');

  let currentData = null;

  function statsRowHtml(a) {
    return `
      <tr>
        <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(a.name)}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.asignados}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.contactados}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.cotizados}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.pendientes}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.seguimientos}</td>
      </tr>
    `;
  }

  function ventaRowHtml(v) {
    return `
      <div class="flex items-center justify-between py-2.5">
        <div>
          <span class="text-body-md font-semibold text-on-surface">${escapeHtml(v.advisor_name)}</span>
          ${v.cliente ? `<span class="text-body-sm text-on-surface-variant"> · ${escapeHtml(v.cliente)}</span>` : ''}
          <span class="text-body-sm text-on-surface-variant"> · ${timeLabel(v.created_at)}</span>
        </div>
        <span class="text-body-md font-bold text-secondary">${formatMoney(v.monto)}</span>
      </div>
    `;
  }

  function declinadoRowHtml(d) {
    return `
      <div class="flex items-center justify-between py-2.5">
        <div>
          <span class="text-body-md font-semibold text-on-surface">${escapeHtml(d.advisor_name)}</span>
          ${d.cliente ? `<span class="text-body-sm text-on-surface-variant"> · ${escapeHtml(d.cliente)}</span>` : ''}
        </div>
        <span class="text-body-sm text-on-surface-variant">${timeLabel(d.created_at)}</span>
      </div>
    `;
  }

  function seguimientoRowHtml(s) {
    return `
      <div class="flex items-center justify-between py-2.5">
        <div>
          <span class="text-body-md font-semibold text-on-surface">${escapeHtml(s.advisor_name)}</span>
          ${s.cliente ? `<span class="text-body-sm text-on-surface-variant"> · ${escapeHtml(s.cliente)}</span>` : ''}
          <span class="text-body-sm text-on-surface-variant"> · intento ${s.followup_count || 1}</span>
        </div>
        <span class="text-body-sm text-on-surface-variant">${timeLabel(s.created_at)}</span>
      </div>
    `;
  }

  const defaultCanalStatus = 'Los datos de canales se guardan automáticamente.';
  let canalSaveTimer = null;

  function setCanalSaveStatus(text, kind = 'info', duration = 0) {
    if (canalSaveTimer) {
      clearTimeout(canalSaveTimer);
      canalSaveTimer = null;
    }
    canalSaveStatus.textContent = text;
    canalSaveStatus.className = `text-[11px] font-label-bold mt-3 ${
      kind === 'error' ? 'text-error' : kind === 'success' ? 'text-secondary' : 'text-on-surface-variant'
    }`;
    if (duration > 0) {
      canalSaveTimer = setTimeout(() => {
        setCanalSaveStatus(defaultCanalStatus, 'info');
      }, duration);
    }
  }

  function renderCanales() {
    const c = currentData.canales;
    canalWhatsapp.value = c.whatsapp;
    canalCorreo.value = c.correo;
    canalLlamadas.value = c.llamadas;
    canalTotal.textContent = c.whatsapp + c.correo + c.llamadas;
    setCanalSaveStatus(defaultCanalStatus, 'info');
  }

  function renderTotalsRow() {
    const t = currentData.totales;
    statsTotalesRow.innerHTML = `
      <td class="p-table-cell-padding text-body-md">Total</td>
      <td class="p-table-cell-padding text-center">${t.asignados}</td>
      <td class="p-table-cell-padding text-center">${t.contactados}</td>
      <td class="p-table-cell-padding text-center">${t.cotizados}</td>
      <td class="p-table-cell-padding text-center">${t.pendientes}</td>
      <td class="p-table-cell-padding text-center">${t.seguimientos}</td>
    `;
  }

  function renderReport() {
    reportCardEl.innerHTML = reportCardHtml(currentData);
  }

  async function updateDateControls() {
    dateInput.max = todayStr();
    btnNext.disabled = isFutureDate(currentDate) || currentDate === todayStr();
  }

  async function load() {
    currentDate = clampToToday(currentDate);
    dateInput.value = currentDate;
    reportCardEl.innerHTML = `<p class="p-6 text-center text-body-sm text-on-surface-variant">Cargando informe...</p>`;
    await updateDateControls();
    let data;
    try {
      data = await ctx.api.get(`/api/informe/${currentDate}`);
    } catch (err) {
      ctx.toast('No se pudo cargar el informe de esta fecha', 'error');
      reportCardEl.innerHTML = `<p class="p-6 text-center text-body-sm text-error">Error cargando el informe. Intenta nuevamente.</p>`;
      return;
    }
    currentData = data;

    statsTbody.innerHTML = data.asesores.length
      ? data.asesores.map(statsRowHtml).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">No hay asesores activos.</td></tr>`;

    renderTotalsRow();
    renderCanales();

    ventasList.innerHTML = data.ventas.map(ventaRowHtml).join('');
    ventasEmpty.classList.toggle('hidden', data.ventas.length > 0);

    declinadosList.innerHTML = data.declinados.map(declinadoRowHtml).join('');
    declinadosEmpty.classList.toggle('hidden', data.declinados.length > 0);

    seguimientosList.innerHTML = data.seguimientos.map(seguimientoRowHtml).join('');
    seguimientosEmpty.classList.toggle('hidden', data.seguimientos.length > 0);

    renderReport();
  }

  async function persistCanales(fecha, patch) {
    try {
      setCanalSaveStatus('Guardando...', 'info');
      await ctx.api.put(`/api/informe/${fecha}/canales`, patch);
      setCanalSaveStatus('Guardado', 'success', 2500);
    } catch (err) {
      setCanalSaveStatus('Error guardando. Intenta nuevamente.', 'error');
      ctx.toast(err.message, 'error');
    }
  }

  let pendingCanalesSave = null; // { timeoutId, fecha, patch }
  function scheduleCanalesSave(patch) {
    if (pendingCanalesSave) clearTimeout(pendingCanalesSave.timeoutId);
    const fecha = currentDate;
    const timeoutId = setTimeout(() => {
      pendingCanalesSave = null;
      persistCanales(fecha, patch);
    }, 500);
    pendingCanalesSave = { timeoutId, fecha, patch };
  }

  function flushPendingCanalesSave() {
    if (!pendingCanalesSave) return;
    const { timeoutId, fecha, patch } = pendingCanalesSave;
    clearTimeout(timeoutId);
    pendingCanalesSave = null;
    persistCanales(fecha, patch);
  }

  function readCanalesValues() {
    return {
      whatsapp: Number(canalWhatsapp.value) || 0,
      correo: Number(canalCorreo.value) || 0,
      llamadas: Number(canalLlamadas.value) || 0,
    };
  }

  function onCanalInput() {
    currentData.canales = readCanalesValues();
    canalTotal.textContent = currentData.canales.whatsapp + currentData.canales.correo + currentData.canales.llamadas;
    renderReport();
    setCanalSaveStatus('Preparado para guardar...', 'info');
    scheduleCanalesSave(currentData.canales);
  }

  [canalWhatsapp, canalCorreo, canalLlamadas].forEach((input) => {
    input.addEventListener('input', onCanalInput);
    input.addEventListener('change', () => {
      if (pendingCanalesSave) clearTimeout(pendingCanalesSave.timeoutId);
      pendingCanalesSave = null;
      setCanalSaveStatus('Guardando...', 'info');
      persistCanales(currentDate, readCanalesValues());
    });
  });

  container.querySelector('#btn-quick-sale').addEventListener('click', () => {
    openQuickSaleModal(ctx, () => load());
  });

  container.querySelector('#btn-copy').addEventListener('click', () => {
    if (!currentData) return;
    const text = buildReportText(currentData);
    navigator.clipboard
      .writeText(text)
      .then(() => ctx.toast('Informe copiado, listo para pegar en WhatsApp', 'success'))
      .catch(() => ctx.toast('No se pudo copiar automáticamente, selecciona y copia el texto manualmente', 'error'));
  });

  // Exporta el recuadro (el mismo que se ve en pantalla, con los iconos de
  // Material Symbols) como PNG -- pensado para mandarlo como imagen por
  // WhatsApp en vez de -o ademas de- el texto plano de "Copiar texto".
  // document.fonts.ready evita capturar el frame en que el icono todavia no
  // termino de cargar y sale como un cuadrado vacio.
  container.querySelector('#btn-download').addEventListener('click', async () => {
    if (!currentData) return;
    if (typeof window.html2canvas !== 'function') {
      ctx.toast('No se pudo cargar el generador de imagen (revisa tu conexión)', 'error');
      return;
    }
    try {
      await document.fonts.ready;
      const canvas = await window.html2canvas(reportCardEl, { backgroundColor: null, scale: 2 });
      const link = document.createElement('a');
      link.download = `informe-nova-${currentDate}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      ctx.toast('No se pudo generar la imagen del informe', 'error');
    }
  });

  function switchDate(newDate) {
    const targetDate = clampToToday(newDate);
    flushPendingCanalesSave();
    currentDate = targetDate;
    load();
  }

  container.querySelector('#btn-prev').addEventListener('click', () => switchDate(addDays(currentDate, -1)));
  container.querySelector('#btn-next').addEventListener('click', () => switchDate(addDays(currentDate, 1)));
  container.querySelector('#btn-today').addEventListener('click', () => switchDate(todayStr()));
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    switchDate(dateInput.value);
  });

  // Los datos por asesor y las ventas son en vivo: cualquier cambio en Ventas
  // (marcar contactado/cotizado/cerrar, incluso con fecha atrasada) refresca
  // este informe solo. Si el usuario esta escribiendo un canal, se ignora el
  // refresco remoto para no interrumpirlo a mitad de tecleo.
  const offInforme = ctx.ws.on('informe_changed', () => {
    if (document.activeElement && document.activeElement.classList.contains('canal-input')) return;
    load();
  });
  const offLeads = ctx.ws.on('leads_changed', () => {
    if (document.activeElement && document.activeElement.classList.contains('canal-input')) return;
    load();
  });

  await load();

  return () => {
    flushPendingCanalesSave();
    offInforme();
    offLeads();
  };
}
