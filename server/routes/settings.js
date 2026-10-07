const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');

const router = express.Router();

const PUBLIC_KEYS = [
  'auto_backup_weekly',
  'last_backup_at',
  'monthly_sales_target',
  // Datos de la empresa para el PDF de cotización (pestaña "Cotizar", motor
  // nativo -- ver server/nativeQuotes.js). Editables aquí para no tener que
  // tocar código cada vez que cambien un dato de facturación. Sus valores
  // por defecto se siembran en db.js -> init() (ensureDefaultSetting).
  'quote_company_name',
  'quote_company_nit',
  'quote_company_address',
  'quote_company_phone',
  'quote_company_email',
  'quote_company_web',
  'quote_payment_details',
  'quote_terms',
];

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const row of rows) {
    if (PUBLIC_KEYS.includes(row.key)) out[row.key] = row.value;
  }
  res.json(out);
});

router.put('/', async (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction(async () => {
    for (const key of PUBLIC_KEYS) {
      if (key === 'last_backup_at') continue; // solo lectura, lo gestiona el backend
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        await upsert.run(key, String(body[key]));
      }
    }
  });
  await tx();
  broadcast('settings_changed', {});
  res.json({ ok: true });
});

module.exports = router;
