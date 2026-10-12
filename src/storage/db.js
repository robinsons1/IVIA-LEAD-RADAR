const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const LOG_FILE = path.join(OUTPUT_DIR, 'scrape.log');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Escritura atómica para evitar corrupción si el proceso se interrumpe (Ctrl+C / apagado)
 */
function atomicWriteJson(filePath, data) {
  ensureDirs();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Registro dual en consola y archivo output/scrape.log
 */
function logMessage(level, message, onEvent = null) {
  ensureDirs();
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level.toUpperCase()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (_) {}
  if (typeof onEvent === 'function') {
    onEvent({ type: 'log', level, message, timestamp });
  }
}

/**
 * Normaliza números telefónicos en Colombia y detecta si son líneas móviles aptas para WhatsApp
 */
function normalizeColombianPhone(rawPhone) {
  if (!rawPhone) {
    return { raw: '', clean: '', e164: '', isWhatsappMobile: false, phoneType: 'none' };
  }
  const digits = String(rawPhone).replace(/\D/g, '');
  let localDigits = digits;

  if (localDigits.startsWith('57') && localDigits.length >= 12) {
    localDigits = localDigits.slice(2);
  }

  // Celulares en Colombia: 10 dígitos y empiezan por 3 (300 - 359)
  const isMobile = localDigits.length === 10 && /^3[0-5]\d{8}$/.test(localDigits);
  // Fijos en Colombia con indicativo 60X (10 dígitos) o 7 dígitos locales
  const isLandline =
    (localDigits.length === 10 && /^60[1-8]\d{7}$/.test(localDigits)) ||
    localDigits.length === 7;

  let e164 = '';
  if (isMobile || (localDigits.length === 10 && localDigits.startsWith('60'))) {
    e164 = `57${localDigits}`;
  } else if (digits.length >= 10) {
    e164 = digits.startsWith('57') ? digits : `57${digits}`;
  }

  return {
    raw: String(rawPhone).trim(),
    clean: localDigits,
    e164,
    isWhatsappMobile: isMobile,
    phoneType: isMobile ? 'mobile' : isLandline ? 'landline' : digits ? 'other' : 'none'
  };
}

function generateLeadKey(lead) {
  const normName = (lead.name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  const normPhone = (lead.phoneClean || '').slice(-7);
  if (lead.mapsUrl && lead.mapsUrl.includes('/maps/place/')) {
    const placeMatch = lead.mapsUrl.match(/!1s([^!]+)/);
    if (placeMatch) return `place_${placeMatch[1]}`;
  }
  return `key_${normName}_${normPhone || (lead.address || '').slice(0, 12).replace(/\W/g, '')}`;
}

function loadLeads() {
  ensureDirs();
  if (!fs.existsSync(LEADS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEADS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error cargando leads.json:', err.message);
    return [];
  }
}

function saveLeads(leads) {
  atomicWriteJson(LEADS_FILE, leads);
}

/**
 * Inserta o actualiza un prospecto preservando su estado CRM y notas si ya existía
 */
function upsertLead(leadData) {
  const leads = loadLeads();
  const key = generateLeadKey(leadData);
  const existingIdx = leads.findIndex(
    (l) => l.dedupKey === key || (l.id && l.id === leadData.id)
  );

  const now = new Date().toISOString();

  if (existingIdx >= 0) {
    const existing = leads[existingIdx];
    const updated = {
      ...existing,
      ...leadData,
      id: existing.id,
      dedupKey: key,
      crmStatus: existing.crmStatus || 'nuevo',
      notes: existing.notes || '',
      lastContactedAt: existing.lastContactedAt || null,
      createdAt: existing.createdAt || now,
      updatedAt: now
    };
    leads[existingIdx] = updated;
    saveLeads(leads);
    return { lead: updated, isNew: false };
  } else {
    const newLead = {
      id: crypto.randomUUID(),
      dedupKey: key,
      crmStatus: 'nuevo',
      notes: '',
      lastContactedAt: null,
      createdAt: now,
      updatedAt: now,
      ...leadData
    };
    leads.unshift(newLead);
    saveLeads(leads);
    return { lead: newLead, isNew: true };
  }
}

function updateLeadCrm(id, updates) {
  const leads = loadLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;

  const allowed = {};
  if (typeof updates.crmStatus === 'string') allowed.crmStatus = updates.crmStatus;
  if (typeof updates.notes === 'string') allowed.notes = updates.notes;
  if (updates.lastContactedAt !== undefined) allowed.lastContactedAt = updates.lastContactedAt;
  if (typeof updates.customPitch === 'string') allowed.customPitch = updates.customPitch;

  leads[idx] = {
    ...leads[idx],
    ...allowed,
    updatedAt: new Date().toISOString()
  };
  saveLeads(leads);
  return leads[idx];
}

function deleteLead(id) {
  const leads = loadLeads();
  const filtered = leads.filter((l) => l.id !== id);
  if (filtered.length === leads.length) return false;
  saveLeads(filtered);
  return true;
}

function clearLeads() {
  saveLeads([]);
}

function loadProgress() {
  ensureDirs();
  if (!fs.existsSync(PROGRESS_FILE)) {
    return {
      query: '',
      location: '',
      completedUrls: [],
      lastIndex: 0,
      status: 'idle',
      updatedAt: null
    };
  }
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch (_) {
    return { query: '', location: '', completedUrls: [], lastIndex: 0, status: 'idle' };
  }
}

function saveProgress(progress) {
  atomicWriteJson(PROGRESS_FILE, {
    ...progress,
    updatedAt: new Date().toISOString()
  });
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  OUTPUT_DIR,
  LEADS_FILE,
  PROGRESS_FILE,
  LOG_FILE,
  ensureDirs,
  logMessage,
  normalizeColombianPhone,
  loadLeads,
  saveLeads,
  upsertLead,
  updateLeadCrm,
  deleteLead,
  clearLeads,
  loadProgress,
  saveProgress
};
