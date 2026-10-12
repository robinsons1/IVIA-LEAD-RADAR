const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  loadLeads,
  upsertLead,
  updateLeadCrm,
  deleteLead,
  clearLeads,
  loadProgress
} = require('./storage/db');
const {
  runLeadPipeline,
  getJobStatus,
  requestStopJob
} = require('./scraper/mapsScraper');
const { auditBusinessWebsite } = require('./scraper/websiteAuditor');
const { scoreAndBuildPitch } = require('./scraper/leadScorer');
const { exportLeadsToCsv, exportLeadsToExcel } = require('./export/exporter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Clientes SSE conectados para recibir progreso en tiempo real
const sseClients = new Set();

function broadcastEvent(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

function computeStats(leads) {
  return {
    total: leads.length,
    highPriority: leads.filter((l) => l.priority === 'ALTA').length,
    noWebsite: leads.filter((l) => l.primaryOpportunity === 'NO_WEBSITE').length,
    socialOnly: leads.filter((l) => l.primaryOpportunity === 'SOCIAL_ONLY').length,
    brokenOrInsecure: leads.filter(
      (l) =>
        l.primaryOpportunity === 'BROKEN_WEB' ||
        l.primaryOpportunity === 'NO_SSL' ||
        (l.audit && l.audit.urlType === 'CUSTOM_DOMAIN' && (!l.audit.reachable || !l.audit.hasValidSsl))
    ).length,
    genericEmail: leads.filter(
      (l) =>
        l.primaryOpportunity === 'GENERIC_EMAIL' ||
        (l.audit?.genericEmails && l.audit.genericEmails.length > 0)
    ).length,
    withWhatsappMobile: leads.filter((l) => l.isWhatsappMobile).length,
    contacted: leads.filter((l) => l.crmStatus && l.crmStatus !== 'nuevo').length
  };
}

// Stream SSE en tiempo real
app.get('/api/scrape/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(
    `data: ${JSON.stringify({
      type: 'init',
      job: getJobStatus(),
      progress: loadProgress()
    })}\n\n`
  );

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Obtener todos los prospectos y métricas
app.get('/api/leads', (req, res) => {
  const leads = loadLeads();
  res.json({
    leads,
    stats: computeStats(leads),
    job: getJobStatus(),
    progress: loadProgress()
  });
});

// Iniciar extracción en Google Maps + Auditoría IVIA
app.post('/api/scrape/start', (req, res) => {
  const status = getJobStatus();
  if (status.running) {
    return res.status(409).json({
      error: 'Ya hay una búsqueda en curso. Detén la actual antes de iniciar otra.'
    });
  }

  const {
    query = 'Odontólogos',
    location = 'Chapinero, Bogotá',
    maxResults = 20,
    auditWebsites = true,
    headless = true,
    resume = false
  } = req.body || {};

  // Lanzar en segundo plano y transmitir eventos por SSE
  runLeadPipeline(
    { query, location, maxResults, auditWebsites, headless, resume },
    (event) => broadcastEvent(event)
  ).catch((err) => {
    broadcastEvent({
      type: 'log',
      level: 'error',
      message: `Error en la búsqueda: ${err.message}`,
      timestamp: new Date().toISOString()
    });
  });

  res.json({
    ok: true,
    message: `Búsqueda iniciada: "${query} en ${location}"`,
    job: getJobStatus()
  });
});

// Detener extracción activa
app.post('/api/scrape/stop', (req, res) => {
  const stopped = requestStopJob();
  res.json({
    ok: stopped,
    message: stopped
      ? 'Deteniendo búsqueda y guardando progreso...'
      : 'No hay ninguna búsqueda en curso.'
  });
});

// Auditoría rápida individual de cualquier negocio o sitio web manual
app.post('/api/audit-single', async (req, res) => {
  try {
    const {
      name = 'Empresa Prospecto',
      category = 'Empresa',
      city = 'Bogotá',
      phone = '',
      website = ''
    } = req.body || {};

    const audit = await auditBusinessWebsite(website);
    const rawLead = {
      name: name.trim() || website || 'Empresa Auditada',
      category: category.trim() || 'Servicios',
      searchQuery: 'Auditoría Manual',
      city: city.trim() || 'Colombia',
      address: city.trim() || 'Colombia',
      phone: phone.trim(),
      website: website.trim(),
      rating: 4.5,
      reviewsCount: 10,
      mapsUrl: ''
    };

    const scored = scoreAndBuildPitch(rawLead, audit);
    const { lead } = upsertLead({ ...rawLead, ...scored, audit });
    broadcastEvent({ type: 'lead', lead, isNew: true, job: getJobStatus() });

    res.json({ ok: true, lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar estado CRM, notas o mensaje personalizado de un prospecto
app.patch('/api/leads/:id', (req, res) => {
  const updated = updateLeadCrm(req.params.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: 'Prospecto no encontrado' });
  }
  res.json({ ok: true, lead: updated });
});

// Eliminar un prospecto
app.delete('/api/leads/:id', (req, res) => {
  const deleted = deleteLead(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Prospecto no encontrado' });
  }
  res.json({ ok: true });
});

// Limpiar todos los prospectos
app.delete('/api/leads', (req, res) => {
  clearLeads();
  res.json({ ok: true });
});

// Descargar Excel (.xlsx)
app.get('/api/export/xlsx', async (req, res) => {
  try {
    const leads = loadLeads();
    const filePath = await exportLeadsToExcel(leads);
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Descargar CSV (.csv)
app.get('/api/export/csv', (req, res) => {
  try {
    const leads = loadLeads();
    const filePath = exportLeadsToCsv(leads);
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' 🚀 IVIA LEAD RADAR — DASHBOARD & MOTOR DE PROSPECCIÓN ACTIVO');
    console.log(` 🌐 Abre en tu navegador: http://localhost:${PORT}`);
    console.log('══════════════════════════════════════════════════════════════\n');
  });
}

module.exports = app;
