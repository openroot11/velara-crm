require('dotenv').config(); // carga server/.env (Odoo, PORT, etc.) antes de todo

const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
require('express-async-errors'); // deja que rutas async con errores/rechazos lleguen al manejador de errores de Express en vez de tumbar el proceso (Express 4 no lo hace solo)
const session = require('express-session');

const { getSetting, setSetting, init } = require('./db');
const realtime = require('./realtime');
const { scheduleWeeklyBackup } = require('./backup');
const { loadUser, requireRole, AUTH_DISABLED } = require('./middleware/auth');
const odooSync = require('./odoo-sync');
const googleAdsSync = require('./googleAdsSync');

const PORT = process.env.PORT || 4000;

function lanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

async function main() {
  // Crea el esquema (si falta) y siembra los asesores por defecto antes de
  // aceptar cualquier peticion -- con Postgres esto ya no puede pasar de
  // forma sincrona al hacer require('./db') como antes con SQLite.
  await init();

  const app = express();
  app.use(express.json());

  // Sesion en memoria (suficiente para una herramienta de LAN de 4 personas).
  // El secreto se genera una sola vez y se guarda en settings, para que
  // reiniciar el servidor (ej. al reabrir iniciar.bat) no obligue a todo el
  // equipo a volver a iniciar sesion.
  let sessionSecret = await getSetting('session_secret');
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    await setSetting('session_secret', sessionSecret);
  }

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }, // 30 dias
    })
  );

  app.use('/api/auth', require('./routes/auth'));

  // Sin sesion, antes del gate de abajo: lo usa el health check de hosting
  // (Render, etc.), que pega sin cookie y necesita un 200 para no marcar el
  // deploy como caido.
  app.get('/api/health', (req, res) => res.json({ ok: true, at: new Date().toISOString() }));

  // Todo el resto de /api/* requiere sesion iniciada; loadUser ademas deja el
  // usuario (con su rol) disponible en req.user para los gates de cada ruta.
  app.use('/api', loadUser);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api/odoo', require('./routes/odoo'));
  app.use('/api/leads', require('./routes/leads'));
  app.use('/api/advisors', require('./routes/advisors'));
  app.use('/api/clients', require('./routes/clients'));
  // Cotizaciones nativas de Nova (pestaña "Cotizar") -- sin Odoo de por
  // medio, ver server/nativeQuotes.js.
  app.use('/api/products', require('./routes/products'));
  app.use('/api/quotations', require('./routes/quotations'));
  app.use('/api/quote-templates', require('./routes/quoteTemplates'));
  // Producción: pedidos, órdenes de producción, tareas, archivos, bloqueos,
  // control, aprobaciones, documentos y garantías (ver server/production.js).
  app.use('/api/production', require('./routes/production'));
  // ERP: operarios, inventario de materiales, compras y caja (apps aparte;
  // Producción no toca inventario).
  // Trabajos del taller (tablero simple por etapas, ver routes/jobs.js).
  app.use('/api/jobs', require('./routes/jobs'));
  app.use('/api/workers', require('./routes/workers'));
  app.use('/api/materials', require('./routes/materials'));
  app.use('/api/purchases', require('./routes/purchases'));
  app.use('/api/cash', require('./routes/cash'));
  app.use('/api/invoices', require('./routes/invoices'));
  app.use('/api/kpis', requireRole('admin', 'coordinador'), require('./routes/kpis'));
  app.use('/api/marketing', requireRole('admin', 'coordinador'), require('./routes/marketing'));
  app.use('/api/google-ads', requireRole('admin', 'coordinador'), require('./routes/googleAds'));
  app.use('/api/reports', requireRole('admin', 'coordinador'), require('./routes/reports'));
  app.use('/api/settings', requireRole('admin'), require('./routes/settings'));
  app.use('/api/export', requireRole('admin'), require('./routes/exports'));
  app.use('/api/system', requireRole('admin'), require('./routes/system'));
  app.use('/api/informe', requireRole('admin', 'coordinador'), require('./routes/informe'));
  app.use('/api/users', requireRole('admin'), require('./routes/users'));

  // Manejador de errores al final: cualquier error lanzado o promesa
  // rechazada dentro de una ruta (async o no) cae aqui en vez de tumbar el
  // proceso -- necesario ahora que casi todas las rutas son async.
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
  });

  const server = http.createServer(app);
  realtime.attach(server);
  scheduleWeeklyBackup();
  odooSync.start(); // copia el estado del embudo de Odoo -> CRM cada ~30s
  googleAdsSync.start(); // trae el gasto/campañas de Google Ads -> ad_spend cada ~6h

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('=========================================');
    console.log('  Nova CRM - servidor iniciado');
    console.log('=========================================');
    console.log(`  En esta PC:      http://localhost:${PORT}`);
    for (const ip of lanAddresses()) {
      console.log(`  Otros equipos:   http://${ip}:${PORT}`);
    }
    console.log('=========================================');
    if (AUTH_DISABLED) {
      console.log('  ATENCION: NOVA_DISABLE_AUTH=true — el login esta');
      console.log('  DESACTIVADO. Cualquiera con la URL entra como admin,');
      console.log('  sin usuario ni contraseña. Solo para desarrollo/demo.');
      console.log('=========================================');
    }
    console.log('');
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
