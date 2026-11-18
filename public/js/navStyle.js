// Estilo del menú dentro de cada aplicación (Configuración › Ajustes ›
// Apariencia): 'top' = barra arriba con los menús de la aplicación, como
// Odoo (predeterminado); 'side' = el menú lateral de siempre. Se recuerda en
// este navegador, igual que el tema claro/oscuro.

const KEY = 'velara_nav_style';
export const NAV_STYLE_EVENT = 'velara:navstyle';

export function getNavStyle() {
  try {
    return localStorage.getItem(KEY) === 'side' ? 'side' : 'top';
  } catch {
    return 'top';
  }
}

export function setNavStyle(style) {
  try {
    localStorage.setItem(KEY, style === 'side' ? 'side' : 'top');
  } catch {
    /* sin almacenamiento: dura solo esta visita */
  }
  window.dispatchEvent(new Event(NAV_STYLE_EVENT));
}
