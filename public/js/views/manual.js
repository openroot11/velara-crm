// Ventas › Manual de atención: muestra public/manual-atencion.html (el
// manual de atención al cliente de VELARA: flujograma, respuestas rápidas,
// información básica y uso del CRM) dentro del CRM, para tenerlo a mano
// mientras se atiende. Es un HTML aparte para poder abrirlo también solo,
// en otra pestaña (botón de abajo).

export async function mount(container) {
  container.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
      <p class="text-body-sm text-on-surface-variant">Flujograma, respuestas rápidas para WhatsApp e información de cada servicio. Las respuestas que edite se guardan en este navegador.</p>
      <a href="/manual-atencion.html" target="_blank" rel="noopener" class="btn btn-secondary inline-flex"><span class="material-symbols-outlined">open_in_new</span>Abrir en otra pestaña</a>
    </div>
    <iframe src="/manual-atencion.html" title="Manual de atención al cliente" class="w-full rounded-xl border border-outline-variant bg-surface" style="height: calc(100vh - 170px); min-height: 520px;"></iframe>
  `;
}
