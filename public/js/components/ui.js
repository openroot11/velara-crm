import { escapeHtml } from '../utils.js';

// Piezas de interfaz compartidas entre vistas (tarjetas de cifra, pestañas,
// rango de fechas con atajos, chips). Antes cada vista (Finanzas,
// Facturación...) tenía su propia copia casi idéntica; aquí quedan una sola
// vez para que se vean y se comporten igual en toda la app.
//
// Regla de color del dueño: el naranja de marca (primary) es solo para el
// logo y el botón de acción principal. Pestaña activa, atajo elegido, etc.
// van en neutros (on-surface / outline).

// ---- Tarjeta de cifra (KPI) -------------------------------------------------
// tone: '' | 'good' | 'bad' | 'warn'
export function statCard(label, value, hint = '', tone = '') {
  const color = tone === 'bad' ? 'text-error' : tone === 'good' ? 'text-status-good' : tone === 'warn' ? 'text-tertiary' : 'text-on-surface';
  return `
    <div class="border border-outline-variant rounded-xl px-4 py-3.5 bg-surface min-w-0">
      <p class="text-[12.5px] text-on-surface-variant mb-1 truncate">${label}</p>
      <p class="text-[20px] leading-[28px] font-medium tracking-[-0.02em] ${color} break-words">${value}</p>
      ${hint ? `<p class="text-[11.5px] text-outline mt-0.5">${hint}</p>` : ''}
    </div>`;
}

// ---- Pestañas -----------------------------------------------------------------
// tabs: [{ key, label, icon? }]. Los botones llevan data-tab="key" (la vista
// engancha sus propios clics); paintTabBar marca la activa.
export function tabBarHtml(tabs, active = '') {
  return `
    <div class="flex border-b border-outline-variant mb-gutter overflow-x-auto overflow-y-hidden" role="tablist">
      ${tabs
        .map(
          (t) => `<button type="button" data-tab="${t.key}" role="tab" aria-selected="${t.key === active}" class="${tabCls(t.key === active)}">${
            t.icon ? `<span class="material-symbols-outlined text-[18px]" aria-hidden="true">${t.icon}</span>` : ''
          }${t.label}</button>`
        )
        .join('')}
    </div>`;
}

// Pestañas como "Default / Only important" de Shakuro: texto de 13px, la
// activa en negro con subrayado fino.
const TAB_BASE = 'px-1 mr-4 py-2.5 -mb-px border-b-[1.5px] text-[13px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors';
function tabCls(on) {
  return `${TAB_BASE} ${on ? 'border-on-surface text-on-surface' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`;
}

export function paintTabBar(root, active) {
  root.querySelectorAll('[role="tablist"] [data-tab]').forEach((b) => {
    const on = b.dataset.tab === active;
    b.className = tabCls(on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// ---- Rango de fechas con atajos ------------------------------------------------
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DATE_PRESETS = {
  hoy: ['Hoy', () => {
    const t = isoDate(new Date());
    return [t, t];
  }],
  mes: ['Este mes', () => {
    const d = new Date();
    return [isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), isoDate(d)];
  }],
  mes_pasado: ['Mes pasado', () => {
    const d = new Date();
    return [isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), isoDate(new Date(d.getFullYear(), d.getMonth(), 0))];
  }],
  trimestre: ['Últimos 3 meses', () => {
    const d = new Date();
    return [isoDate(new Date(d.getFullYear(), d.getMonth() - 2, 1)), isoDate(d)];
  }],
  anio: ['Este año', () => {
    const d = new Date();
    return [isoDate(new Date(d.getFullYear(), 0, 1)), isoDate(d)];
  }],
};

// Pinta "Desde / Hasta" + botones de atajo dentro de `el` y avisa con
// onChange(from, to) cada vez que cambia. El atajo que coincide con el
// rango actual queda marcado (neutro, no naranja).
export function mountDateRange(el, { idPrefix, from, to, presets, onChange }) {
  const fieldCls = 'h-8 px-2.5 bg-surface border border-outline-variant rounded-lg text-[13px] outline-none focus:border-outline';
  const labelCls = 'block text-[12px] text-on-surface-variant mb-1';
  const ON = 'border-transparent bg-surface-container-high text-on-surface font-medium';
  const OFF = 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface';
  el.innerHTML = `
    <div><label for="${idPrefix}-from" class="${labelCls}">Desde</label><input id="${idPrefix}-from" type="date" value="${from}" class="${fieldCls}" /></div>
    <div><label for="${idPrefix}-to" class="${labelCls}">Hasta</label><input id="${idPrefix}-to" type="date" value="${to}" class="${fieldCls}" /></div>
    <div class="flex gap-1.5 flex-wrap" role="group" aria-label="Atajos de fecha">
      ${presets.map((k) => `<button type="button" data-preset="${k}">${DATE_PRESETS[k][0]}</button>`).join('')}
    </div>`;
  const fromEl = el.querySelector(`#${idPrefix}-from`);
  const toEl = el.querySelector(`#${idPrefix}-to`);
  // Marca el atajo que coincide con el rango actual sin volver a pintar los
  // campos (re-pintar mientras alguien escribe una fecha le quitaría el foco).
  function markPreset() {
    el.querySelectorAll('[data-preset]').forEach((b) => {
      const [pf, pt] = DATE_PRESETS[b.dataset.preset][1]();
      const on = pf === from && pt === to;
      b.className = `h-8 px-3 border rounded-lg text-[13px] transition-colors ${on ? ON : OFF}`;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  fromEl.addEventListener('change', (e) => {
    from = e.target.value;
    markPreset();
    onChange(from, to);
  });
  toEl.addEventListener('change', (e) => {
    to = e.target.value;
    markPreset();
    onChange(from, to);
  });
  el.querySelectorAll('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      [from, to] = DATE_PRESETS[b.dataset.preset][1]();
      fromEl.value = from;
      toEl.value = to;
      markPreset();
      onChange(from, to);
    })
  );
  markPreset();
}

// ---- Chip ------------------------------------------------------------------------
export function chip(text, cls) {
  // Etiqueta de estado como "Active / New / VIP": esquinas de 6px, peso medio.
  return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11.5px] font-medium whitespace-nowrap ${cls}">${escapeHtml(text)}</span>`;
}

// ---- Barra horizontal de proporción (listas "en qué se fue la plata") --------------
// Neutra a propósito: es un dato, no una acción.
export function ratioBar(pct, cls = 'bg-on-surface-variant') {
  return `<div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}
