let openModalCount = 0;

// Nada de ventanas con fondo oscuro (estilo Odoo): el contenido se abre en
// un panel flotante pegado a la derecha, con la pantalla de detrás visible
// y sin atenuar (como la ficha de contacto de Shakuro). variant 'center' =
// tarjeta chica centrada, para confirmaciones de una línea.
export function openModal({ title, render, wide = false, variant = 'panel' }) {
  const modalId = `nova-modal-title-${++openModalCount}`;
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = `fixed inset-0 z-[90] ${variant === 'center' ? 'flex items-center justify-center p-4' : ''}`;
  // role="dialog"/aria-modal: sin esto un lector de pantalla sigue anunciando
  // el resto de la pagina detras del modal como si fuera navegable.
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', modalId);

  const box = document.createElement('div');
  box.className =
    variant === 'center'
      ? 'nova-pop-in bg-surface rounded-2xl shadow-[var(--shadow-pop)] w-full max-w-sm max-h-[90vh] overflow-y-auto'
      : `nova-panel-in absolute top-2 right-2 bottom-2 w-[calc(100%-1rem)] ${wide ? 'sm:w-[640px]' : 'sm:w-[440px]'} bg-surface rounded-2xl shadow-[var(--shadow-pop)] flex flex-col overflow-hidden`;
  box.innerHTML = `
    <div class="flex items-center justify-between gap-3 pl-5 pr-3 h-14 border-b border-outline-variant shrink-0">
      <h3 id="${modalId}" class="text-[14px] font-semibold text-on-surface truncate">${title}</h3>
      <button id="nova-modal-close" type="button" aria-label="Cerrar" class="btn btn-icon">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div id="nova-modal-body" class="p-5 ${variant === 'center' ? '' : 'flex-1 overflow-y-auto'}"></div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function close() {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    // Devuelve el foco a lo que lo tenia antes de abrir -- si no, un usuario
    // de teclado "pierde el lugar" cada vez que cierra un modal.
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  box.querySelector('#nova-modal-close').addEventListener('click', close);

  const body = box.querySelector('#nova-modal-body');
  render(body, { close });

  // Foco inicial dentro del modal: el primer campo/boton enfocable DEL
  // CONTENIDO (no el boton "cerrar", que sale primero en el DOM pero casi
  // nunca es lo que el usuario quiere tocar primero); si el contenido no
  // tiene nada enfocable, cae al boton cerrar y despues a la caja misma.
  const focusable =
    body.querySelector('input, select, textarea, button:not([disabled]), [href]') || box.querySelector('#nova-modal-close');
  if (focusable) focusable.focus();
  else {
    box.setAttribute('tabindex', '-1');
    box.focus();
  }

  return close;
}

export function confirmModal({ title, message, confirmLabel = 'Confirmar', danger = false, requirePhrase = null }) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
      close();
    };

    const close = openModal({
      title,
      variant: 'center',
      render: (body, { close: closeModal }) => {
        body.innerHTML = `
          <p class="text-body-md font-body-md text-on-surface-variant mb-5">${message}</p>
          ${requirePhrase ? `
            <label for="nova-confirm-input" class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">
              Escribe <span class="text-error">${requirePhrase}</span> para confirmar
            </label>
            <input id="nova-confirm-input" type="text" autocomplete="off" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none" />
          ` : ''}
          <div class="flex justify-end gap-2">
            <button id="nova-confirm-cancel" type="button" class="btn btn-secondary">Cancelar</button>
            <button id="nova-confirm-ok" type="button" class="btn ${danger ? 'btn-destructive' : 'btn-primary'}">${confirmLabel}</button>
          </div>
        `;
        body.querySelector('#nova-confirm-cancel').addEventListener('click', () => finish(false));
        const okBtn = body.querySelector('#nova-confirm-ok');
        okBtn.addEventListener('click', () => {
          if (requirePhrase) {
            const val = body.querySelector('#nova-confirm-input').value.trim();
            if (val !== requirePhrase) return;
          }
          finish(true);
        });
        // cerrar con la X o clic afuera tambien cuenta como cancelar
        void closeModal;
        overlayCloseHook(body, () => finish(false));
      },
    });
  });
}

// Cuando el usuario cierra el modal con la X o clic afuera, debe resolver como "false".
function overlayCloseHook(bodyEl, onExternalClose) {
  const overlay = bodyEl.closest('.fixed');
  if (!overlay) return;
  const closeBtn = overlay.querySelector('#nova-modal-close');
  closeBtn?.addEventListener('click', onExternalClose, { once: true });
  overlay.addEventListener(
    'click',
    (e) => {
      if (e.target === overlay) onExternalClose();
    },
    { once: true }
  );
}
