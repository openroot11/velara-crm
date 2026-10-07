import { confirmFactoryReset } from '../components/leadActions.js';
import { openModal } from '../components/modal.js';
import { escapeHtml } from '../utils.js';

const ROLES = [
  { value: 'admin', label: 'Dueño / Admin' },
  { value: 'coordinador', label: 'Coordinador' },
  { value: 'asesor', label: 'Asesor' },
  { value: 'produccion', label: 'Producción (jefe de taller)' },
];
const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

function toggleHtml(id, checked, title, desc) {
  return `
    <div class="flex items-center justify-between p-4 bg-surface-container rounded-lg border border-outline-variant">
      <div class="pr-4">
        <h4 class="text-body-md font-body-md font-semibold text-on-surface">${title}</h4>
        <p class="text-body-sm font-body-sm text-on-surface-variant">${desc}</p>
      </div>
      <label class="relative inline-flex items-center cursor-pointer shrink-0">
        <input id="${id}" type="checkbox" class="sr-only peer" ${checked ? 'checked' : ''} />
        <div class="w-11 h-6 bg-outline-variant peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-outline peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface-container-lowest after:border-outline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-inverse-surface"></div>
      </label>
    </div>
  `;
}

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="max-w-4xl mx-auto">
      <header class="mb-8">
        <h2 class="text-headline-lg font-headline-lg text-on-surface mb-2">Configuración y Exportación</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Administra las exportaciones de datos y opciones críticas del sistema CRM.</p>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">
        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1">
          <div class="flex items-center gap-3 mb-6 border-b border-outline-variant pb-3">
            <span class="material-symbols-outlined text-on-surface text-2xl">download</span>
            <h3 class="text-headline-md font-headline-md text-on-surface">Exportar Datos</h3>
          </div>
          <div class="space-y-6">
            <div class="flex items-start justify-between group">
              <div class="flex-1 pr-4">
                <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-1">Exportar a Excel</h4>
                <p class="text-body-sm font-body-sm text-on-surface-variant">Descarga leads, ventas, asesores y SLA en formato .xlsx.</p>
              </div>
              <button id="export-xlsx" class="flex-shrink-0 bg-surface-container hover:bg-surface-container-high text-on-surface px-4 py-2 rounded-lg text-label-bold font-label-bold border border-outline-variant transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">table_view</span> XLSX
              </button>
            </div>
            <div class="flex items-start justify-between group">
              <div class="flex-1 pr-4">
                <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-1">Backup de Sistema (JSON)</h4>
                <p class="text-body-sm font-body-sm text-on-surface-variant">Genera un volcado completo de la base de datos actual en formato JSON.</p>
              </div>
              <button id="export-json" class="flex-shrink-0 bg-surface-container hover:bg-surface-container-high text-on-surface px-4 py-2 rounded-lg text-label-bold font-label-bold border border-outline-variant transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">data_object</span> JSON
              </button>
            </div>
            <p id="last-backup-label" class="text-body-sm font-body-sm text-on-surface-variant"></p>
          </div>
        </section>

        <section class="bg-error-container/10 border border-error/20 rounded-xl p-gutter col-span-1 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-3 mb-6 border-b border-error/20 pb-3">
              <span class="material-symbols-outlined text-error text-2xl">warning</span>
              <h3 class="text-headline-md font-headline-md text-error">Zona Peligrosa</h3>
            </div>
            <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-2">Restaurar de Fábrica</h4>
            <p class="text-body-sm font-body-sm text-on-surface-variant">Esta acción eliminará <strong class="text-error">todos</strong> los datos de ventas, historiales de SLA, configuraciones de asesores y métricas. El sistema volverá a su estado inicial. Esta acción no se puede deshacer.</p>
          </div>
          <button id="factory-reset-btn" class="mt-6 w-full bg-error text-on-error hover:bg-error/90 px-4 py-3 rounded-lg text-label-bold font-label-bold transition-colors flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-sm">delete_forever</span> RESTAURAR SISTEMA
          </button>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center gap-3 mb-6 border-b border-outline-variant pb-3">
            <span class="material-symbols-outlined text-on-surface-variant text-2xl">tune</span>
            <h3 class="text-headline-md font-headline-md text-on-surface">Ajustes Generales</h3>
          </div>
          <div id="toggles" class="grid grid-cols-1 md:grid-cols-2 gap-6"></div>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center justify-between flex-wrap gap-3 mb-6 border-b border-outline-variant pb-3">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-on-surface-variant text-2xl">sell</span>
              <h3 class="text-headline-md font-headline-md text-on-surface">Lista de precios (Cotizar)</h3>
            </div>
            <button id="add-product-btn" class="btn btn-primary">
              <span class="material-symbols-outlined text-[18px]">add</span> Nuevo producto
            </button>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant -mt-3 mb-4">Catálogo propio del CRM (no viene de Odoo) que alimenta el buscador de productos de la pestaña "Cotizar".</p>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[480px]">
              <thead>
                <tr class="bg-surface-container-low border-b border-outline-variant">
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Producto</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Precio</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Estado</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody id="products-tbody" class="divide-y divide-outline-variant"></tbody>
            </table>
          </div>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center gap-3 mb-6 border-b border-outline-variant pb-3">
            <span class="material-symbols-outlined text-on-surface-variant text-2xl">storefront</span>
            <h3 class="text-headline-md font-headline-md text-on-surface">Datos de la empresa (cotizaciones)</h3>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant -mt-3 mb-4">Lo que sale impreso en el PDF de la pestaña "Cotizar": encabezado, datos de pago y políticas al pie.</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Razón social</label>
              <input id="qs-company-name" type="text" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">NIT</label>
              <input id="qs-company-nit" type="text" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Ciudad / dirección</label>
              <input id="qs-company-address" type="text" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Teléfono</label>
              <input id="qs-company-phone" type="text" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Correo</label>
              <input id="qs-company-email" type="text" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Sitio web</label>
              <input id="qs-company-web" type="text" placeholder="velara.com.co" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
            </div>
            <div class="md:col-span-2">
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Datos de pago (una línea por dato)</label>
              <textarea id="qs-company-payment" rows="3" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20"></textarea>
            </div>
            <div class="md:col-span-2">
              <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Políticas y condiciones (una por línea)</label>
              <textarea id="qs-company-terms" rows="5" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20"></textarea>
            </div>
          </div>
          <div class="flex justify-end">
            <button id="qs-company-save" class="btn btn-primary">Guardar datos de la empresa</button>
          </div>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center justify-between flex-wrap gap-3 mb-6 border-b border-outline-variant pb-3">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-on-surface-variant text-2xl">hub</span>
              <h3 class="text-headline-md font-headline-md text-on-surface">Conexión con Odoo</h3>
            </div>
            <div class="flex gap-2 flex-wrap">
              <button id="odoo-sync-btn" class="btn btn-secondary">
                <span class="material-symbols-outlined text-sm">sync</span> Sincronizar estados
              </button>
              <button id="odoo-test-btn" class="btn btn-secondary">
                <span class="material-symbols-outlined text-sm">wifi_tethering</span> Probar conexión
              </button>
            </div>
          </div>
          <div id="odoo-status" class="text-body-sm font-body-sm text-on-surface-variant">Cargando…</div>
          <p class="text-[11px] text-on-surface-variant mt-3">La conexión se configura en <code class="bg-surface-container px-1 rounded">server/.env</code> (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD). Las cotizaciones y los pedidos de venta se crean en esta instancia de Odoo.</p>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center justify-between flex-wrap gap-3 mb-6 border-b border-outline-variant pb-3">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-on-surface-variant text-2xl">ads_click</span>
              <h3 class="text-headline-md font-headline-md text-on-surface">Conexión con Google Ads</h3>
            </div>
            <button id="ga-sync-btn" class="btn btn-secondary">
              <span class="material-symbols-outlined text-sm">sync</span> Sincronizar ahora
            </button>
          </div>
          <div id="ga-status" class="text-body-sm font-body-sm text-on-surface-variant">Cargando…</div>
          <p class="text-[11px] text-on-surface-variant mt-3">La conexión se configura en <code class="bg-surface-container px-1 rounded">server/.env</code> (ver <code class="bg-surface-container px-1 rounded">docs/GOOGLE_ADS_SETUP.md</code>). Trae el gasto por campaña cada ~6h y rellena la inversión de Estadísticas → Rentabilidad de Leads sola (una corrección hecha a mano en un mes nunca se pisa).</p>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center justify-between flex-wrap gap-3 mb-6 border-b border-outline-variant pb-3">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-on-surface-variant text-2xl">manage_accounts</span>
              <h3 class="text-headline-md font-headline-md text-on-surface">Usuarios y Roles</h3>
            </div>
            <button id="add-user-btn" class="btn btn-primary">
              <span class="material-symbols-outlined text-[18px]">person_add</span> Nuevo usuario
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr class="bg-surface-container-low border-b border-outline-variant">
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Usuario</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Rol</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor vinculado</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Estado</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody id="users-tbody" class="divide-y divide-outline-variant"></tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;

  container.querySelector('#export-xlsx').addEventListener('click', () => download('/api/export/xlsx'));
  container.querySelector('#export-json').addEventListener('click', () => download('/api/export/json'));

  container.querySelector('#factory-reset-btn').addEventListener('click', async () => {
    const ok = await confirmFactoryReset(ctx);
    if (!ok) return;
    try {
      await ctx.api.post('/api/system/factory-reset', { confirm: 'RESTAURAR' });
      ctx.toast('Sistema restaurado a valores de fábrica', 'success');
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  const togglesEl = container.querySelector('#toggles');
  const lastBackupLabel = container.querySelector('#last-backup-label');

  async function load() {
    let settings;
    try {
      settings = await ctx.api.get('/api/settings');
    } catch {
      ctx.toast('No se pudo cargar la configuración', 'error');
      return;
    }
    togglesEl.innerHTML = toggleHtml(
      'toggle-backup',
      settings.auto_backup_weekly === 'true',
      'Auto-Backup Semanal',
      'Generar backup JSON automáticamente cada domingo.'
    );

    lastBackupLabel.textContent = settings.last_backup_at
      ? `Último backup automático: ${settings.last_backup_at.replace('T', ' ').slice(0, 16)} UTC`
      : 'Aún no se ha generado un backup automático.';

    togglesEl.querySelector('#toggle-backup').addEventListener('change', (e) => {
      ctx.api.put('/api/settings', { auto_backup_weekly: e.target.checked }).catch((err) => ctx.toast(err.message, 'error'));
    });

    container.querySelector('#qs-company-name').value = settings.quote_company_name || '';
    container.querySelector('#qs-company-nit').value = settings.quote_company_nit || '';
    container.querySelector('#qs-company-address').value = settings.quote_company_address || '';
    container.querySelector('#qs-company-phone').value = settings.quote_company_phone || '';
    container.querySelector('#qs-company-email').value = settings.quote_company_email || '';
    container.querySelector('#qs-company-web').value = settings.quote_company_web || '';
    container.querySelector('#qs-company-payment').value = settings.quote_payment_details || '';
    container.querySelector('#qs-company-terms').value = settings.quote_terms || '';
  }

  container.querySelector('#qs-company-save').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await ctx.api.put('/api/settings', {
        quote_company_name: container.querySelector('#qs-company-name').value.trim(),
        quote_company_nit: container.querySelector('#qs-company-nit').value.trim(),
        quote_company_address: container.querySelector('#qs-company-address').value.trim(),
        quote_company_phone: container.querySelector('#qs-company-phone').value.trim(),
        quote_company_email: container.querySelector('#qs-company-email').value.trim(),
        quote_company_web: container.querySelector('#qs-company-web').value.trim(),
        quote_payment_details: container.querySelector('#qs-company-payment').value,
        quote_terms: container.querySelector('#qs-company-terms').value,
      });
      ctx.toast('Datos de la empresa actualizados', 'success');
    } catch (err) {
      ctx.toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
    }
  });

  // --- Conexión con Odoo (solo lectura) ------------------------------
  const odooStatusEl = container.querySelector('#odoo-status');
  const odooTestBtn = container.querySelector('#odoo-test-btn');

  function odooRow(label, value) {
    return `<div class="flex gap-2"><span class="w-28 shrink-0 text-on-surface-variant">${label}</span><span class="font-semibold text-on-surface break-all">${escapeHtml(value || '—')}</span></div>`;
  }

  async function loadOdoo() {
    odooStatusEl.innerHTML = 'Consultando…';
    let s;
    try {
      s = await ctx.api.get('/api/odoo/status');
    } catch (err) {
      odooStatusEl.innerHTML = `<span class="text-error font-semibold">No se pudo consultar el estado (${escapeHtml(err.message)})</span>`;
      return;
    }
    if (!s.enabled) {
      odooStatusEl.innerHTML = `<span class="inline-flex items-center gap-1 text-on-surface-variant"><span class="w-2 h-2 rounded-full bg-outline-variant"></span>Sin configurar</span> — la integración con Odoo está apagada; el CRM funciona igual, pero sin cotizaciones ni pedidos de venta.`;
      return;
    }
    if (s.ok === false) {
      odooStatusEl.innerHTML = `<span class="inline-flex items-center gap-1 text-error font-semibold"><span class="w-2 h-2 rounded-full bg-error"></span>Configurado, pero no responde</span><p class="mt-1 text-error">${escapeHtml(s.error || 'error desconocido')}</p>`;
      return;
    }
    odooStatusEl.innerHTML = `
      <div class="inline-flex items-center gap-1.5 mb-3 text-secondary font-semibold"><span class="w-2 h-2 rounded-full bg-secondary"></span>Conectado</div>
      <div class="space-y-1">
        ${odooRow('Servidor', s.url)}
        ${odooRow('Base de datos', s.db)}
        ${odooRow('Empresa', s.company)}
        ${odooRow('Usuario', `${s.user || ''}${s.login ? ` (${s.login})` : ''}`)}
      </div>
      <div id="odoo-stages" class="mt-3"></div>
      <p class="mt-3 text-[11px] text-on-surface-variant">El CRM revisa Odoo cada ~30&nbsp;s y <strong>refleja</strong> el estado del lead (Asignado, Contactado, Cotizado) en cualquier dirección, igual que quede la tarjeta en Odoo, y lo cierra si queda Perdido. Si el asesor arma la cotización directo en Odoo, se enlaza sola al lead (referencia, monto y estado Cotizado) y aparece en Cotizaciones. Un lead ya cerrado en el CRM no se reabre desde Odoo; "Ganado" siempre se cierra desde el CRM.</p>`;
    loadOdooStages();
  }

  async function loadOdooStages() {
    const el = container.querySelector('#odoo-stages');
    if (!el) return;
    let d;
    try {
      d = await ctx.api.get('/api/odoo/stages');
    } catch {
      return;
    }
    const chip = (mapsTo) =>
      mapsTo
        ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container">→ ${escapeHtml(mapsTo)}</span>`
        : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">sin uso en el CRM</span>`;
    el.innerHTML = `
      ${
        d.mapping_ok
          ? ''
          : `<p class="mb-2 text-[11px] text-error font-semibold flex items-start gap-1"><span class="material-symbols-outlined text-[13px]">warning</span>El CRM no reconoce las etapas "${escapeHtml(d.expected.contacted)}" / "${escapeHtml(d.expected.quoted)}" en este Odoo. Ajusta ODOO_STAGE_* en server/.env.</p>`
      }
      <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">Etapas del pipeline de Odoo</p>
      <div class="flex flex-wrap gap-1.5">
        ${d.stages
          .map(
            (st) =>
              `<span class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-outline-variant">${escapeHtml(st.name)}${st.is_won ? ' 🏆' : ''} ${chip(st.maps_to)}</span>`
          )
          .join('')}
      </div>`;
  }

  odooTestBtn.addEventListener('click', async () => {
    odooTestBtn.disabled = true;
    await loadOdoo();
    odooTestBtn.disabled = false;
    ctx.toast('Estado de Odoo actualizado', 'success');
  });

  container.querySelector('#odoo-sync-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await ctx.api.post('/api/odoo/sync');
      ctx.toast(
        r.error
          ? `Odoo: ${r.error}`
          : r.updated
          ? `${r.updated} lead(s) actualizados desde Odoo`
          : 'Ya estaba todo sincronizado',
        r.error ? 'error' : 'success'
      );
    } catch (err) {
      ctx.toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
    }
  });

  // --- Conexión con Google Ads (solo lectura) --------------------------
  const gaStatusEl = container.querySelector('#ga-status');
  const gaSyncBtn = container.querySelector('#ga-sync-btn');

  function gaRow(label, value) {
    return `<div class="flex gap-2"><span class="w-28 shrink-0 text-on-surface-variant">${label}</span><span class="font-semibold text-on-surface break-all">${escapeHtml(value || '—')}</span></div>`;
  }

  async function loadGoogleAds() {
    gaStatusEl.innerHTML = 'Consultando…';
    let s;
    try {
      s = await ctx.api.get('/api/google-ads/status');
    } catch (err) {
      gaStatusEl.innerHTML = `<span class="text-error font-semibold">No se pudo consultar el estado (${escapeHtml(err.message)})</span>`;
      return;
    }
    if (!s.enabled) {
      gaStatusEl.innerHTML = `<span class="inline-flex items-center gap-1 text-on-surface-variant"><span class="w-2 h-2 rounded-full bg-outline-variant"></span>Sin configurar</span> — la integración con Google Ads está apagada; la inversión se sigue registrando a mano en Estadísticas.`;
      return;
    }
    if (s.ok === false) {
      gaStatusEl.innerHTML = `<span class="inline-flex items-center gap-1 text-error font-semibold"><span class="w-2 h-2 rounded-full bg-error"></span>Configurado, pero no responde</span><p class="mt-1 text-error">${escapeHtml(s.error || 'error desconocido')}</p>`;
      return;
    }
    gaStatusEl.innerHTML = `
      <div class="inline-flex items-center gap-1.5 mb-3 text-secondary font-semibold"><span class="w-2 h-2 rounded-full bg-secondary"></span>Conectado</div>
      <div class="space-y-1">
        ${gaRow('Cuenta', `${s.name || ''} (${s.customer_id})`)}
        ${gaRow('Moneda', s.currency)}
        ${gaRow('Últ. sincronización', s.last_sync_at ? s.last_sync_at.replace('T', ' ').slice(0, 19) + ' UTC' : 'aún no corrió')}
      </div>
      ${
        s.last_sync_error
          ? `<p class="mt-2 text-[11px] text-error">Último error de sincronización: ${escapeHtml(s.last_sync_error)}</p>`
          : ''
      }
      ${
        s.can_report_conversions
          ? ''
          : `<p class="mt-2 text-[11px] text-on-surface-variant">Reportar ventas cerradas como conversión está apagado (falta GOOGLE_ADS_CONVERSION_ACTION_ID).</p>`
      }
    `;
  }

  gaSyncBtn.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await ctx.api.post('/api/google-ads/sync');
      ctx.toast(
        r.error ? `Google Ads: ${r.error}` : `Sincronizado: ${r.rows} fila(s), ${r.months_updated} mes(es) de inversión actualizados`,
        r.error ? 'error' : 'success'
      );
      await loadGoogleAds();
    } catch (err) {
      ctx.toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
    }
  });

  // --- Usuarios y Roles -----------------------------------------------
  const usersTbody = container.querySelector('#users-tbody');
  let advisorsCache = [];

  function userRowHtml(u) {
    const roleOptions = ROLES.map(
      (r) => `<option value="${r.value}" ${r.value === u.role ? 'selected' : ''}>${r.label}</option>`
    ).join('');
    const advisorOptions =
      '<option value="">— Sin vincular —</option>' +
      advisorsCache.map((a) => `<option value="${a.id}" ${a.id === u.advisor_id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
    return `
      <tr>
        <td class="p-table-cell-padding font-semibold text-on-surface">
          <input data-user="${u.id}" data-original="${escapeHtml(u.username)}" value="${escapeHtml(u.username)}" class="user-username-input w-full bg-transparent border border-transparent hover:border-outline-variant focus:border-outline rounded-md px-1.5 py-1 outline-none focus:ring-2 focus:ring-outline/20" />
        </td>
        <td class="p-table-cell-padding">
          <select data-user="${u.id}" class="user-role-select p-1.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
            ${roleOptions}
          </select>
        </td>
        <td class="p-table-cell-padding">
          <select data-user="${u.id}" class="user-advisor-select p-1.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
            ${advisorOptions}
          </select>
        </td>
        <td class="p-table-cell-padding">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${u.active ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}">
            ${u.active ? 'Activo' : 'Desactivado'}
          </span>
        </td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end flex-wrap gap-2">
            <button data-action="reset" data-id="${u.id}" data-username="${escapeHtml(u.username)}" class="px-3 py-1 border border-outline-variant rounded text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-low transition-colors">Restablecer clave</button>
            <button data-action="toggle" data-id="${u.id}" data-active="${u.active ? '1' : '0'}" class="px-3 py-1 border border-outline-variant rounded text-body-sm font-label-bold ${u.active ? 'text-error hover:bg-error-container/20' : 'text-secondary hover:bg-secondary-container/20'} transition-colors">${u.active ? 'Desactivar' : 'Reactivar'}</button>
          </div>
        </td>
      </tr>
    `;
  }

  async function loadUsers() {
    try {
      const [users, advisors] = await Promise.all([ctx.api.get('/api/users'), ctx.api.get('/api/advisors')]);
      advisorsCache = advisors.filter((a) => !a.is_group);
      usersTbody.innerHTML = users.length
        ? users.map(userRowHtml).join('')
        : `<tr><td colspan="5" class="p-table-cell-padding py-6 text-center text-body-sm text-on-surface-variant">Sin usuarios registrados.</td></tr>`;
    } catch (err) {
      ctx.toast(err.message || 'No se pudo cargar la lista de usuarios', 'error');
    }
  }

  usersTbody.addEventListener('change', async (e) => {
    const usernameInput = e.target.closest('.user-username-input');
    const roleSelect = e.target.closest('.user-role-select');
    const advisorSelect = e.target.closest('.user-advisor-select');
    if (usernameInput) {
      const newVal = usernameInput.value.trim();
      if (!newVal || newVal === usernameInput.dataset.original) {
        usernameInput.value = usernameInput.dataset.original;
        return;
      }
      try {
        await ctx.api.patch(`/api/users/${usernameInput.dataset.user}`, { username: newVal });
        ctx.toast('Nombre de usuario actualizado', 'success');
        loadUsers();
      } catch (err) {
        ctx.toast(err.message, 'error');
        loadUsers();
      }
    }
    if (roleSelect) {
      try {
        await ctx.api.patch(`/api/users/${roleSelect.dataset.user}`, { role: roleSelect.value });
        ctx.toast('Rol actualizado', 'success');
        loadUsers();
      } catch (err) {
        ctx.toast(err.message, 'error');
        loadUsers();
      }
    }
    if (advisorSelect) {
      try {
        await ctx.api.patch(`/api/users/${advisorSelect.dataset.user}`, { advisor_id: advisorSelect.value || null });
        ctx.toast('Asesor vinculado actualizado', 'success');
      } catch (err) {
        ctx.toast(err.message, 'error');
        loadUsers();
      }
    }
  });

  usersTbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle') {
      const active = btn.dataset.active === '1';
      try {
        await ctx.api.patch(`/api/users/${btn.dataset.id}`, { active: !active });
        ctx.toast(active ? 'Usuario desactivado' : 'Usuario reactivado', 'success');
        loadUsers();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    }
    if (btn.dataset.action === 'reset') {
      openModal({
        title: `Restablecer clave · ${btn.dataset.username}`,
        render: (body, { close }) => {
          body.innerHTML = `
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nueva contraseña</label>
            <input id="reset-password" type="password" minlength="4" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
            <div class="flex justify-end gap-2">
              <button id="reset-cancel" class="btn btn-secondary">Cancelar</button>
              <button id="reset-ok" class="btn btn-primary">Guardar</button>
            </div>
          `;
          body.querySelector('#reset-cancel').addEventListener('click', close);
          body.querySelector('#reset-ok').addEventListener('click', async () => {
            const password = body.querySelector('#reset-password').value;
            if (!password || password.length < 4) {
              ctx.toast('La contraseña debe tener al menos 4 caracteres', 'error');
              return;
            }
            try {
              await ctx.api.post(`/api/users/${btn.dataset.id}/reset-password`, { password });
              ctx.toast('Contraseña actualizada', 'success');
              close();
            } catch (err) {
              ctx.toast(err.message, 'error');
            }
          });
        },
      });
    }
  });

  container.querySelector('#add-user-btn').addEventListener('click', () => {
    openModal({
      title: 'Nuevo usuario',
      render: (body, { close }) => {
        body.innerHTML = `
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Usuario *</label>
          <input id="new-username" type="text" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Contraseña *</label>
          <input id="new-password" type="password" minlength="4" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Rol *</label>
          <select id="new-role" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
            ${ROLES.map((r) => `<option value="${r.value}">${r.label}</option>`).join('')}
          </select>
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Asesor vinculado (opcional)</label>
          <select id="new-advisor" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
            <option value="">— Sin vincular —</option>
            ${advisorsCache.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
          </select>
          <div class="flex justify-end gap-2">
            <button id="new-cancel" class="btn btn-secondary">Cancelar</button>
            <button id="new-ok" class="btn btn-primary">Crear</button>
          </div>
        `;
        body.querySelector('#new-cancel').addEventListener('click', close);
        body.querySelector('#new-ok').addEventListener('click', async () => {
          const username = body.querySelector('#new-username').value.trim();
          const password = body.querySelector('#new-password').value;
          const role = body.querySelector('#new-role').value;
          const advisor_id = body.querySelector('#new-advisor').value || null;
          if (!username || !password) {
            ctx.toast('Usuario y contraseña son obligatorios', 'error');
            return;
          }
          try {
            await ctx.api.post('/api/users', { username, password, role, advisor_id });
            ctx.toast('Usuario creado', 'success');
            close();
            loadUsers();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  });

  // --- Lista de precios (Cotizar) --------------------------------------
  const productsTbody = container.querySelector('#products-tbody');
  let productsCache = [];

  function productRowHtml(p) {
    return `
      <tr class="${p.active ? '' : 'opacity-60'}">
        <td class="p-table-cell-padding font-semibold text-on-surface">
          <input data-product="${p.id}" data-field="name" data-original="${escapeHtml(p.name)}" value="${escapeHtml(p.name)}" class="product-field-input w-full bg-transparent border border-transparent hover:border-outline-variant focus:border-outline rounded-md px-1.5 py-1 outline-none focus:ring-2 focus:ring-outline/20" />
        </td>
        <td class="p-table-cell-padding">
          <input data-product="${p.id}" data-field="price" data-original="${p.price}" type="number" min="0" step="1000" value="${p.price}" class="product-field-input w-32 bg-transparent border border-transparent hover:border-outline-variant focus:border-outline rounded-md px-1.5 py-1 outline-none focus:ring-2 focus:ring-outline/20" />
        </td>
        <td class="p-table-cell-padding">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${p.active ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}">
            ${p.active ? 'Activo' : 'Descontinuado'}
          </span>
        </td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end gap-2">
            <button data-action="edit-description" data-id="${p.id}" title="${p.description ? 'Editar descripción' : 'Agregar descripción'}" class="p-1.5 rounded border border-outline-variant ${p.description ? 'text-secondary' : 'text-on-surface-variant'} hover:bg-surface-container-low transition-colors">
              <span class="material-symbols-outlined text-[16px]">${p.description ? 'description' : 'note_add'}</span>
            </button>
            <button data-action="toggle-product" data-id="${p.id}" data-active="${p.active ? '1' : '0'}" class="px-3 py-1 border border-outline-variant rounded text-body-sm font-label-bold ${p.active ? 'text-error hover:bg-error-container/20' : 'text-secondary hover:bg-secondary-container/20'} transition-colors">${p.active ? 'Descontinuar' : 'Reactivar'}</button>
          </div>
        </td>
      </tr>
    `;
  }

  async function loadProducts() {
    try {
      productsCache = await ctx.api.get('/api/products?all=1');
      productsTbody.innerHTML = productsCache.length
        ? productsCache.map(productRowHtml).join('')
        : `<tr><td colspan="4" class="p-table-cell-padding py-6 text-center text-body-sm text-on-surface-variant">Sin productos en la lista de precios.</td></tr>`;
    } catch (err) {
      ctx.toast(err.message || 'No se pudo cargar la lista de precios', 'error');
    }
  }

  function openProductDescriptionModal(product) {
    openModal({
      title: `Descripción · ${product.name}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-[11px] text-on-surface-variant mb-2">Se copia como valor por defecto a la línea cuando se elige este producto en una cotización -- el asesor la puede editar o borrar ahí sin afectar esta ficha.</p>
          <textarea id="pd-desc" rows="4" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">${escapeHtml(product.description || '')}</textarea>
          <div class="flex justify-end gap-2">
            <button id="pd-cancel" class="btn btn-secondary">Cancelar</button>
            <button id="pd-ok" class="btn btn-primary">Guardar</button>
          </div>
        `;
        body.querySelector('#pd-cancel').addEventListener('click', close);
        body.querySelector('#pd-ok').addEventListener('click', async () => {
          try {
            await ctx.api.patch(`/api/products/${product.id}`, { description: body.querySelector('#pd-desc').value });
            ctx.toast('Descripción actualizada', 'success');
            close();
            loadProducts();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  productsTbody.addEventListener('change', async (e) => {
    const input = e.target.closest('.product-field-input');
    if (!input) return;
    const field = input.dataset.field;
    const newVal = field === 'price' ? String(Number(input.value) || 0) : input.value.trim();
    if (field === 'name' && !newVal) {
      input.value = input.dataset.original;
      return;
    }
    if (newVal === input.dataset.original) return;
    try {
      await ctx.api.patch(`/api/products/${input.dataset.product}`, { [field]: field === 'price' ? Number(newVal) : newVal });
      ctx.toast('Producto actualizado', 'success');
      loadProducts();
    } catch (err) {
      ctx.toast(err.message, 'error');
      loadProducts();
    }
  });

  productsTbody.addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('button[data-action="toggle-product"]');
    if (toggleBtn) {
      const active = toggleBtn.dataset.active === '1';
      try {
        await ctx.api.patch(`/api/products/${toggleBtn.dataset.id}`, { active: !active });
        ctx.toast(active ? 'Producto descontinuado' : 'Producto reactivado', 'success');
        loadProducts();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
      return;
    }
    const descBtn = e.target.closest('button[data-action="edit-description"]');
    if (descBtn) {
      const product = productsCache.find((p) => p.id === Number(descBtn.dataset.id));
      if (product) openProductDescriptionModal(product);
    }
  });

  container.querySelector('#add-product-btn').addEventListener('click', () => {
    openModal({
      title: 'Nuevo producto',
      render: (body, { close }) => {
        body.innerHTML = `
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nombre *</label>
          <input id="new-product-name" type="text" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Precio (COP)</label>
          <input id="new-product-price" type="number" min="0" step="1000" value="0" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Descripción (opcional)</label>
          <textarea id="new-product-desc" rows="2" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20"></textarea>
          <div class="flex justify-end gap-2">
            <button id="new-product-cancel" class="btn btn-secondary">Cancelar</button>
            <button id="new-product-ok" class="btn btn-primary">Crear</button>
          </div>
        `;
        body.querySelector('#new-product-cancel').addEventListener('click', close);
        body.querySelector('#new-product-ok').addEventListener('click', async () => {
          const name = body.querySelector('#new-product-name').value.trim();
          const price = Number(body.querySelector('#new-product-price').value) || 0;
          const description = body.querySelector('#new-product-desc').value.trim();
          if (!name) {
            ctx.toast('El nombre es obligatorio', 'error');
            return;
          }
          try {
            await ctx.api.post('/api/products', { name, price, description });
            ctx.toast('Producto creado', 'success');
            close();
            loadProducts();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  });

  await Promise.all([load(), loadUsers(), loadOdoo(), loadGoogleAds(), loadProducts()]);
}
