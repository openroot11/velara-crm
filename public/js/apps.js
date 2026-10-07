// Aplicaciones de Velara (como el inicio de Odoo): cada una agrupa sus
// pantallas y tiene su propio menú lateral. Es la ÚNICA fuente de verdad de
// la navegación -- el menú, el Inicio y el título de cada pantalla salen de
// aquí. "hidden" = pantallas de la app que no van en el menú (ej. el
// detalle de una OP se abre desde el tablero).

export const APPS = [
  {
    // Ventas: un embudo por etapas en lugar de Leads/Seguimiento/
    // Cotizaciones/Ventas cerradas (pensadas para un equipo de asesores);
    // esas pantallas siguen existiendo pero salen del menú.
    key: 'comercial',
    label: 'Ventas',
    desc: 'Clientes interesados, cotizaciones y ventas',
    icon: 'storefront',
    color: '#E4572E',
    routes: [
      ['embudo', 'Embudo'],
      ['clientes', 'Clientes'],
    ],
    hidden: [
      ['ventas', 'Leads'],
      ['seguimiento', 'Seguimiento'],
      ['ventas-cerradas', 'Ventas cerradas'],
    ],
  },
  {
    // Cotizaciones: su propio apartado. "Nueva cotización" trae las
    // plantillas según lo que se fabrica (data/quoteTemplates.js); las
    // tarifas, el catálogo y las políticas se ajustan en "Plantillas y
    // tarifas". Todo queda ligado al lead y al embudo de Ventas.
    key: 'cotizaciones',
    label: 'Cotizaciones',
    desc: 'Cotizar con plantillas, listado y tarifas',
    icon: 'request_quote',
    color: '#C7420E',
    routes: [
      ['cotizar', 'Nueva cotización'],
      ['cotizaciones', 'Cotizaciones'],
      ['plantillas-cotizacion', 'Plantillas y tarifas'],
    ],
  },
  {
    // Trabajos del taller: tablero simple por etapas (reemplaza la
    // producción por pedidos/OP, que era para una fábrica -- sus pantallas
    // siguen existiendo pero ya no van en el menú).
    key: 'trabajos',
    label: 'Trabajos',
    desc: 'Lo que está en el taller, de la entrada a la entrega',
    icon: 'construction',
    color: '#2A7F8F',
    routes: [
      ['trabajos', 'Tablero'],
      ['operarios', 'Operarios'],
    ],
  },
  {
    key: 'inventario',
    label: 'Inventario',
    desc: 'Materiales y existencias',
    icon: 'inventory_2',
    color: '#8E6BBF',
    routes: [['inventario', 'Materiales']],
  },
  {
    key: 'compras',
    label: 'Compras',
    desc: 'Proveedores y órdenes de compra',
    icon: 'shopping_cart',
    color: '#3E7CB1',
    routes: [['compras', 'Órdenes de compra']],
  },
  {
    key: 'finanzas',
    label: 'Finanzas',
    desc: 'Cuentas, gastos, cobros y ganancia',
    icon: 'account_balance_wallet',
    color: '#3F9C6B',
    routes: [
      ['finanzas', 'Cuentas y movimientos'],
      ['facturacion', 'Facturación electrónica'],
    ],
  },
  {
    key: 'tableros',
    label: 'Tableros',
    desc: 'Resumen del negocio',
    icon: 'space_dashboard',
    color: '#D9922E',
    routes: [
      ['dashboard1', 'Panel de gerencia'],
      ['dashboard', 'Panel del día'],
    ],
  },
  {
    key: 'reportes',
    label: 'Reportes',
    desc: 'Informes y análisis comercial',
    icon: 'bar_chart',
    color: '#B5487A',
    routes: [
      ['informe', 'Informe diario'],
      ['estadisticas', 'Rendimiento comercial'],
      ['reporte', 'Servicio al cliente'],
    ],
  },
  {
    key: 'config',
    label: 'Configuración',
    desc: 'Equipo y ajustes',
    icon: 'settings',
    color: '#6B7280',
    routes: [
      ['asesores', 'Equipo de ventas'],
      ['ajustes', 'Ajustes'],
    ],
  },
];

// Pantallas permitidas por rol (el backend además protege cada endpoint).
// produccion = jefe de producción/taller: toda la app Producción, consulta
// de Inventario y los operarios; no ve finanzas ni el embudo comercial.
const PRODUCCION = ['trabajos', 'produccion', 'pedidos', 'programacion', 'op', 'solicitudes-material', 'garantias', 'reportes-produccion'];
export const ROUTES_BY_ROLE = {
  admin: ['inicio', 'embudo', 'dashboard1', 'dashboard', 'ventas', 'seguimiento', 'cotizaciones', 'cotizar', 'plantillas-cotizacion', ...PRODUCCION, 'inventario', 'compras', 'finanzas', 'facturacion', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'reporte', 'asesores', 'operarios', 'ajustes'],
  coordinador: ['inicio', 'embudo', 'dashboard1', 'dashboard', 'ventas', 'seguimiento', 'cotizaciones', 'cotizar', 'plantillas-cotizacion', ...PRODUCCION, 'inventario', 'compras', 'finanzas', 'facturacion', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'asesores', 'operarios'],
  produccion: ['inicio', ...PRODUCCION, 'inventario', 'operarios'],
  // Un asesor opera lo suyo: su embudo comercial y el avance en producción
  // de sus clientes (el backend le filtra las OP a las de sus leads).
  asesor: ['inicio', 'embudo', 'ventas', 'cotizaciones', 'cotizar', 'clientes', 'produccion', 'pedidos', 'op', 'garantias', 'inventario'],
};

const LABELS = { inicio: 'Inicio' };
for (const app of APPS) {
  app.firstRoute = app.routes[0][0];
  for (const [r, label] of [...app.routes, ...(app.hidden || [])]) LABELS[r] = label;
}

export function routeLabel(route) {
  return LABELS[route] || route;
}

export function appOfRoute(route) {
  return APPS.find((a) => [...a.routes, ...(a.hidden || [])].some(([r]) => r === route)) || null;
}

// Apps con al menos una pantalla permitida; la primera permitida es la de
// entrada al abrir la app.
export function visibleApps(allowedRoutes) {
  return APPS.map((a) => {
    const first = a.routes.find(([r]) => allowedRoutes.includes(r));
    return first ? { ...a, firstRoute: first[0] } : null;
  }).filter(Boolean);
}
