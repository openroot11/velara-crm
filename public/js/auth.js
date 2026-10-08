// Se carga ANTES que app.js. Verifica si hay sesion iniciada; si no, muestra
// una pantalla de login/creacion de la primera cuenta que cubre toda la
// interfaz y solo cuando el login es exitoso arranca el resto de la
// aplicacion (import('./app.js')). Cuentas individuales por usuario, cada
// una con un rol (admin/coordinador/asesor) que el backend hace cumplir.

function renderOverlay(firstRun, onSuccess) {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.className = 'fixed inset-0 z-[200] bg-shell flex items-center justify-center p-4 overflow-hidden';
  overlay.innerHTML = `
    <div class="relative w-full max-w-sm bg-surface rounded-2xl border border-outline-variant shadow-[var(--shadow-window)] p-8">
      <div class="flex flex-col items-center mb-7">
        <img src="/img/brand/logo-eslogan-positivo.svg" alt="Velara · Soluciones a medida" class="w-[170px] h-auto dark:hidden" />
        <img src="/img/brand/logo-eslogan-negativo.svg" alt="Velara · Soluciones a medida" class="w-[170px] h-auto hidden dark:block" />
        <p class="text-body-sm font-body-sm text-on-surface-variant text-center mt-5">
          ${firstRun ? 'Crea la primera cuenta de administrador para iniciar el control de ventas.' : 'Ingresa con tu usuario para acceder al sistema.'}
        </p>
      </div>
      <form id="auth-form" class="space-y-4">
        <div>
          <label class="block text-[12.5px] text-on-surface-variant mb-1.5">Usuario</label>
          <input id="auth-username" type="text" required autocomplete="username"
            class="w-full h-10 px-3 bg-surface border border-outline-variant rounded-lg text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
        </div>
        <div>
          <label class="block text-[12.5px] text-on-surface-variant mb-1.5">
            ${firstRun ? 'Nueva contraseña' : 'Contraseña'}
          </label>
          <input id="auth-password" type="password" required minlength="4" autocomplete="${firstRun ? 'new-password' : 'current-password'}"
            class="w-full h-10 px-3 bg-surface border border-outline-variant rounded-lg text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
        </div>
        ${firstRun ? `
        <div>
          <label class="block text-[12.5px] text-on-surface-variant mb-1.5">Confirmar contraseña</label>
          <input id="auth-password-confirm" type="password" required minlength="4" autocomplete="new-password"
            class="w-full h-10 px-3 bg-surface border border-outline-variant rounded-lg text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
        </div>` : ''}
        <p id="auth-error" class="text-body-sm font-body-sm text-error hidden"></p>
        <button type="submit" class="btn btn-primary w-full h-10">
          ${firstRun ? 'Crear cuenta e ingresar' : 'Ingresar'}
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#auth-form');
  const errorEl = overlay.querySelector('#auth-error');
  const submitBtn = form.querySelector('button[type="submit"]');
  const usernameInput = overlay.querySelector('#auth-username');

  usernameInput.focus();

  async function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const username = overlay.querySelector('#auth-username').value.trim();
    const password = overlay.querySelector('#auth-password').value;
    if (!username) {
      return showError('El usuario es requerido');
    }
    if (!password) {
      return showError('La contraseña es requerida');
    }
    if (firstRun) {
      const confirm = overlay.querySelector('#auth-password-confirm').value;
      if (password !== confirm) {
        return showError('Las contraseñas no coinciden');
      }
      if (password.length < 4) {
        return showError('La contraseña debe tener al menos 4 caracteres');
      }
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = firstRun ? 'Creando cuenta...' : 'Ingresando...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'No se pudo iniciar sesión');
        return;
      }
      currentUser = data.user || null;
      overlay.remove();
      onSuccess();
    } catch {
      showError('No se pudo conectar con el servidor');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      submitBtn.textContent = originalText;
    }
  });
}

let booted = false;
export function bootApp() {
  if (booted) return;
  booted = true;
  import('./app.js');
}

let currentUser = null;
export function getCurrentUser() {
  return currentUser;
}

// Expuesto para que api.js pueda forzar la vuelta a la pantalla de login
// cuando cualquier peticion responda 401 (p.ej. la sesion expiro), y para
// que el sidebar pueda ofrecer "Cerrar sesión".
export function showLoginOverlay() {
  if (document.getElementById('auth-overlay')) return;
  booted = false;
  currentUser = null;
  renderOverlay(false, () => {
    booted = true;
    location.reload();
  });
}
window.__novaShowLogin = showLoginOverlay;

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* si falla igual se limpia el estado local y se muestra el login */
  }
  currentUser = null;
  location.reload();
}
window.__novaLogout = logout;

async function init() {
  let session = { authenticated: false, firstRun: true, user: null };
  try {
    const res = await fetch('/api/auth/session');
    session = await res.json();
  } catch {
    /* si el servidor no responde, se muestra login igual y fallara al enviar */
  }

  if (session.authenticated) {
    currentUser = session.user;
    bootApp();
    return;
  }

  renderOverlay(!!session.firstRun, bootApp);
}

init();
