const express = require('express');
const { requireRole } = require('../middleware/auth');
const { broadcast } = require('../realtime');
const quoteTemplates = require('../quoteTemplates');

// Configuración de las plantillas de cotización (ver server/quoteTemplates.js).
// Leer: cualquier usuario con sesión (el asesor la necesita para calcular).
// Cambiar tarifas, catálogo o políticas: solo Coordinador o Admin.

const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ config: await quoteTemplates.getConfig() });
});

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

router.put('/', requireRole('admin', 'coordinador'), async (req, res) => {
  const { config } = req.body || {};
  if (!isPlainObject(config)) return res.status(400).json({ error: 'Configuración inválida' });
  if (config.catalogo !== undefined && !Array.isArray(config.catalogo)) {
    return res.status(400).json({ error: 'El catálogo debe ser una lista' });
  }
  for (const key of ['observaciones', 'politicasFabricacion']) {
    if (config[key] !== undefined && !(Array.isArray(config[key]) && config[key].every((s) => typeof s === 'string'))) {
      return res.status(400).json({ error: `"${key}" debe ser una lista de textos` });
    }
  }
  const saved = await quoteTemplates.saveConfig(config);
  broadcast('quote_templates_changed', {});
  res.json({ config: saved });
});

router.post('/reset', requireRole('admin', 'coordinador'), async (req, res) => {
  const saved = await quoteTemplates.resetConfig();
  broadcast('quote_templates_changed', {});
  res.json({ config: saved });
});

module.exports = router;
