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
 * Formatea una fecha en YYYY-MM-DD usando la hora LOCAL (evita desfase UTC nocturno en Colombia)
 */
function toLocalDateString(dateInput = new Date(), addDays = 0) {
  const base = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(base.getTime())) return null;
  if (addDays) {
    base.setDate(base.getDate() + Number(addDays));
  }
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Cadencia 0 - 3 - 7 - 15:
 * tras toque 1 -> +3d (día 3)
 * tras toque 2 -> +4d (día 7)
 * tras toque 3 -> +8d (día 15)
 * tras toque 4+ -> null (cierre)
 */
function getDefaultFollowUpDays(followUpCount) {
  const count = Number(followUpCount) || 0;
  if (count <= 1) return 3;
  if (count === 2) return 4;
  if (count === 3) return 8;
  return null;
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
 * Detecta si una nueva auditoría cambió la condición digital o el puntaje de un prospecto existente
 */
function computeAuditChange(existing, incoming, source = 'scrape') {
  if (!existing || !incoming) return null;

  const prevScore = Number(existing.score) || 0;
  const newScore = Number(incoming.score) || 0;
  const scoreDelta = newScore - prevScore;

  const prevOpportunity = existing.primaryOpportunity || '';
  const newOpportunity = incoming.primaryOpportunity || '';
  const prevLabel = existing.primaryLabel || prevOpportunity || 'Sin diagnóstico';
  const newLabel = incoming.primaryLabel || newOpportunity || 'Sin diagnóstico';

  const prevAudit = existing.audit || {};
  const newAudit = incoming.audit || {};

  const reasons = [];
  let worsenedSignals = 0;
  let improvedSignals = 0;

  const isWebType = (t) => t === 'CUSTOM_DOMAIN' || t === 'FREE_BUILDER';
  if (isWebType(prevAudit.urlType) && isWebType(newAudit.urlType)) {
    if (prevAudit.reachable && !newAudit.reachable) {
      reasons.push('Web pasó a Caída');
      worsenedSignals++;
    } else if (!prevAudit.reachable && newAudit.reachable) {
      reasons.push('Web volvió a cargar');
      improvedSignals++;
    }

    if (prevAudit.hasValidSsl && !newAudit.hasValidSsl && newAudit.reachable) {
      reasons.push('Perdió certificado SSL');
      worsenedSignals++;
    } else if (!prevAudit.hasValidSsl && newAudit.hasValidSsl && newAudit.reachable) {
      reasons.push('Activó certificado SSL');
      improvedSignals++;
    }
  }

  if (prevAudit.urlType && prevAudit.urlType !== 'NO_WEBSITE' && newAudit.urlType === 'NO_WEBSITE') {
    reasons.push('Se quedó sin sitio web');
    worsenedSignals++;
  } else if (prevAudit.urlType === 'NO_WEBSITE' && newAudit.urlType && newAudit.urlType !== 'NO_WEBSITE') {
    reasons.push('Agregó sitio web');
    improvedSignals++;
  }

  if (!existing.isWhatsappMobile && incoming.isWhatsappMobile) {
    reasons.push('Ahora tiene WhatsApp móvil');
  }

  if (prevOpportunity && newOpportunity && prevOpportunity !== newOpportunity && reasons.length === 0) {
    reasons.push(`Diagnóstico: ${prevLabel} → ${newLabel}`);
  }

  if (scoreDelta === 0 && reasons.length === 0 && prevOpportunity === newOpportunity) {
    return null;
  }

  let kind = 'changed';
  if (worsenedSignals > 0 || scoreDelta > 0) {
    kind = 'worsened';
  } else if (improvedSignals > 0 || scoreDelta < 0) {
    kind = 'improved';
  }

  const scorePart =
    scoreDelta !== 0
      ? `Score ${prevScore} → ${newScore} (${scoreDelta > 0 ? '+' : ''}${scoreDelta})`
      : `Score ${newScore}`;
  const reasonPart = reasons.slice(0, 2).join(' · ');
  const summary = reasonPart ? `${scorePart} · ${reasonPart}` : scorePart;

  return {
    date: new Date().toISOString(),
    source,
    prevScore,
    newScore,
    scoreDelta,
    prevOpportunity,
    newOpportunity,
    prevLabel,
    newLabel,
    kind,
    reasons,
    summary
  };
}

/**
 * Inserta o actualiza un prospecto preservando su estado CRM y notas si ya existía
 */
function upsertLead(leadData, options = {}) {
  const leads = loadLeads();
  const key = generateLeadKey(leadData);
  const existingIdx = leads.findIndex(
    (l) => l.dedupKey === key || (l.id && l.id === leadData.id)
  );

  const now = new Date().toISOString();

  if (existingIdx >= 0) {
    const existing = leads[existingIdx];
    const auditChange = computeAuditChange(existing, leadData, options.source || 'scrape');
    const prevHistory = Array.isArray(existing.auditHistory) ? [...existing.auditHistory] : [];
    const auditHistory = auditChange ? [...prevHistory, auditChange].slice(-15) : prevHistory;
    const hasUnreadAuditChange = auditChange
      ? options.markUnread !== false
      : Boolean(existing.hasUnreadAuditChange);

    const updated = {
      ...existing,
      ...leadData,
      id: existing.id,
      dedupKey: key,
      crmStatus: existing.crmStatus || 'nuevo',
      notes: existing.notes || '',
      firstContactedAt: existing.firstContactedAt || existing.lastContactedAt || null,
      lastContactedAt: existing.lastContactedAt || null,
      followUpCount: typeof existing.followUpCount === 'number' ? existing.followUpCount : 0,
      nextFollowUpAt: existing.nextFollowUpAt !== undefined ? existing.nextFollowUpAt : null,
      contactHistory: Array.isArray(existing.contactHistory) ? existing.contactHistory : [],
      customPitch: existing.customPitch,
      auditHistory,
      lastAuditChange: auditChange || existing.lastAuditChange || null,
      hasUnreadAuditChange,
      auditedAt: leadData.auditedAt || now,
      createdAt: existing.createdAt || now,
      updatedAt: now
    };
    leads[existingIdx] = updated;
    saveLeads(leads);
    return { lead: updated, isNew: false, auditChange };
  } else {
    const newLead = {
      id: crypto.randomUUID(),
      dedupKey: key,
      crmStatus: 'nuevo',
      notes: '',
      firstContactedAt: null,
      lastContactedAt: null,
      followUpCount: 0,
      nextFollowUpAt: null,
      contactHistory: [],
      auditHistory: [],
      lastAuditChange: null,
      hasUnreadAuditChange: false,
      auditedAt: now,
      createdAt: now,
      updatedAt: now,
      ...leadData
    };
    leads.unshift(newLead);
    saveLeads(leads);
    return { lead: newLead, isNew: true, auditChange: null };
  }
}

function updateLeadCrm(id, updates) {
  const leads = loadLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;

  const existing = leads[idx];
  const nowIso = new Date().toISOString();
  const allowed = {};

  if (typeof updates.crmStatus === 'string') allowed.crmStatus = updates.crmStatus;
  if (typeof updates.notes === 'string') allowed.notes = updates.notes;
  if (updates.firstContactedAt !== undefined) allowed.firstContactedAt = updates.firstContactedAt;
  if (updates.lastContactedAt !== undefined) allowed.lastContactedAt = updates.lastContactedAt;
  if (typeof updates.followUpCount === 'number') allowed.followUpCount = updates.followUpCount;
  if (updates.nextFollowUpAt !== undefined) allowed.nextFollowUpAt = updates.nextFollowUpAt;
  if (Array.isArray(updates.contactHistory)) allowed.contactHistory = updates.contactHistory;
  if (typeof updates.customPitch === 'string') allowed.customPitch = updates.customPitch;
  if (typeof updates.hasUnreadAuditChange === 'boolean') {
    allowed.hasUnreadAuditChange = updates.hasUnreadAuditChange;
  }

  const editableBusinessFields = ['name', 'category', 'city', 'address', 'phone', 'website', 'mapsUrl'];
  let businessInfoChanged = false;
  for (const field of editableBusinessFields) {
    if (typeof updates[field] === 'string') {
      const trimmed = updates[field].trim();
      if (trimmed !== (existing[field] || '')) {
        businessInfoChanged = true;
      }
      allowed[field] = trimmed;
    }
  }

  if (updates.recordContact && typeof updates.recordContact === 'object') {
    const rc = updates.recordContact;
    const prevCount = typeof existing.followUpCount === 'number' ? existing.followUpCount : 0;
    const stageNum = Number(rc.stage) || prevCount + 1;
    const newCount = Math.max(prevCount + 1, stageNum);
    const history = Array.isArray(existing.contactHistory) ? [...existing.contactHistory] : [];

    history.push({
      date: nowIso,
      stage: stageNum,
      channel: rc.channel || 'whatsapp',
      preview: String(rc.message || '').trim().slice(0, 140)
    });

    allowed.firstContactedAt = existing.firstContactedAt || existing.lastContactedAt || nowIso;
    allowed.lastContactedAt = nowIso;
    allowed.followUpCount = newCount;
    allowed.contactHistory = history.slice(-20);

    const currentStatus = allowed.crmStatus || existing.crmStatus || 'nuevo';
    if (currentStatus === 'nuevo') {
      allowed.crmStatus = 'contactado';
    }

    if (rc.nextFollowUpAt !== undefined) {
      allowed.nextFollowUpAt = rc.nextFollowUpAt || null;
    } else if (typeof rc.nextFollowUpDays === 'number' && rc.nextFollowUpDays > 0) {
      allowed.nextFollowUpAt = toLocalDateString(new Date(), rc.nextFollowUpDays);
    } else if (updates.nextFollowUpAt === undefined) {
      const autoDays = getDefaultFollowUpDays(newCount);
      allowed.nextFollowUpAt = autoDays ? toLocalDateString(new Date(), autoDays) : null;
    }
  } else if (typeof updates.crmStatus === 'string') {
    if (updates.crmStatus === 'contactado' && !existing.lastContactedAt) {
      allowed.firstContactedAt = existing.firstContactedAt || nowIso;
      allowed.lastContactedAt = nowIso;
      allowed.followUpCount = Math.max(1, existing.followUpCount || 0);
      if (updates.nextFollowUpAt === undefined && !existing.nextFollowUpAt) {
        allowed.nextFollowUpAt = toLocalDateString(new Date(), 3);
      }
    } else if (
      (updates.crmStatus === 'cliente' || updates.crmStatus === 'descartado') &&
      updates.nextFollowUpAt === undefined
    ) {
      allowed.nextFollowUpAt = null;
    }
  }

  let updatedLead = {
    ...existing,
    ...allowed,
    updatedAt: nowIso
  };

  if (businessInfoChanged) {
    let mergedAudit = existing.audit ? { ...existing.audit } : null;
    if (typeof allowed.website === 'string' && allowed.website !== (existing.website || '')) {
      if (!allowed.website) {
        mergedAudit = {
          ...(mergedAudit || {}),
          urlType: 'NO_WEBSITE',
          normalizedUrl: '',
          hostname: '',
          reachable: false,
          hasValidSsl: false
        };
      } else {
        const { classifyWebsiteUrl } = require('../scraper/websiteAuditor');
        const classified = classifyWebsiteUrl(allowed.website);
        mergedAudit = {
          ...(mergedAudit || {}),
          urlType: classified.type,
          normalizedUrl: classified.normalizedUrl,
          hostname: classified.hostname
        };
      }
    }

    const { scoreAndBuildPitch } = require('../scraper/leadScorer');
    const scored = scoreAndBuildPitch(updatedLead, mergedAudit);
    updatedLead = {
      ...updatedLead,
      ...scored,
      audit: mergedAudit,
      crmStatus: updatedLead.crmStatus || 'nuevo',
      notes: updatedLead.notes || '',
      firstContactedAt: updatedLead.firstContactedAt || null,
      lastContactedAt: updatedLead.lastContactedAt || null,
      followUpCount: typeof updatedLead.followUpCount === 'number' ? updatedLead.followUpCount : 0,
      nextFollowUpAt: updatedLead.nextFollowUpAt !== undefined ? updatedLead.nextFollowUpAt : null,
      contactHistory: Array.isArray(updatedLead.contactHistory) ? updatedLead.contactHistory : [],
      customPitch: updatedLead.customPitch,
      auditHistory: Array.isArray(existing.auditHistory) ? existing.auditHistory : [],
      lastAuditChange: existing.lastAuditChange || null,
      hasUnreadAuditChange:
        typeof allowed.hasUnreadAuditChange === 'boolean'
          ? allowed.hasUnreadAuditChange
          : Boolean(existing.hasUnreadAuditChange)
    };
  }

  leads[idx] = updatedLead;
  saveLeads(leads);
  return leads[idx];
}

function updateLeadFull(id, freshLeadData, options = {}) {
  const leads = loadLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;

  const existing = leads[idx];
  const nowIso = new Date().toISOString();
  const auditChange = computeAuditChange(existing, freshLeadData, options.source || 'reaudit');
  const prevHistory = Array.isArray(existing.auditHistory) ? [...existing.auditHistory] : [];
  const auditHistory = auditChange ? [...prevHistory, auditChange].slice(-15) : prevHistory;
  const hasUnreadAuditChange = auditChange
    ? options.markUnread === true
    : Boolean(existing.hasUnreadAuditChange);

  leads[idx] = {
    ...existing,
    ...freshLeadData,
    id: existing.id,
    dedupKey: existing.dedupKey,
    crmStatus: existing.crmStatus || 'nuevo',
    notes: existing.notes || '',
    firstContactedAt: existing.firstContactedAt || existing.lastContactedAt || null,
    lastContactedAt: existing.lastContactedAt || null,
    followUpCount: typeof existing.followUpCount === 'number' ? existing.followUpCount : 0,
    nextFollowUpAt: existing.nextFollowUpAt !== undefined ? existing.nextFollowUpAt : null,
    contactHistory: Array.isArray(existing.contactHistory) ? existing.contactHistory : [],
    customPitch: existing.customPitch,
    auditHistory,
    lastAuditChange: auditChange || existing.lastAuditChange || null,
    hasUnreadAuditChange,
    createdAt: existing.createdAt || nowIso,
    auditedAt: nowIso,
    updatedAt: nowIso
  };

  saveLeads(leads);
  return leads[idx];
}

function cleanStoredAudit(audit, freeBuilderDomains) {
  if (!audit || typeof audit !== 'object') return audit;
  const cleaned = { ...audit };

  const ignorePatterns = [
    /ejemplo\.com/i,
    /ejemplo\./i,
    /sample\./i,
    /yourdomain/i,
    /suempresa/i,
    /tunegocio/i,
    /noreply@/i,
    /no-reply@/i,
    /u003[ce]/i,
    /^u00[0-9a-f]{2}/i
  ];
  const filterEmails = (arr) =>
    Array.isArray(arr)
      ? arr.filter((e) => e && !ignorePatterns.some((re) => re.test(String(e))))
      : [];

  cleaned.allEmails = filterEmails(cleaned.allEmails);
  cleaned.genericEmails = filterEmails(cleaned.genericEmails);
  cleaned.corporateEmails = filterEmails(cleaned.corporateEmails);

  if (cleaned.hostname && Array.isArray(freeBuilderDomains)) {
    const h = String(cleaned.hostname).toLowerCase();
    const isFree = freeBuilderDomains.some((d) => h === d || h.endsWith('.' + d));
    if (isFree) {
      cleaned.urlType = 'FREE_BUILDER';
      cleaned.hasMxRecords = false;
      cleaned.mxProvider = 'Subdominio gratuito';
    }
  }

  return cleaned;
}

/**
 * Recalcula score, mensajes y campos de seguimiento sobre los leads actuales sin perder datos CRM
 */
function rescoreAndMigrateLeads(options = {}) {
  const leads = loadLeads();
  if (leads.length === 0) return { total: 0, migrated: 0, leads };

  if (options.onlyIfNeeded) {
    const needsMigration = leads.some(
      (l) =>
        !l.cleanName ||
        typeof l.followUpCount !== 'number' ||
        !l.pitches?.cadence ||
        !l.pitches?.replies
    );
    if (!needsMigration) {
      return { total: leads.length, migrated: 0, leads };
    }
  }

  const { scoreAndBuildPitch } = require('../scraper/leadScorer');
  const { FREE_BUILDER_DOMAINS } = require('../scraper/websiteAuditor');

  const updatedLeads = leads.map((lead) => {
    const cleanedAudit = cleanStoredAudit(lead.audit, FREE_BUILDER_DOMAINS);
    const scored = scoreAndBuildPitch(lead, cleanedAudit);

    const status = lead.crmStatus || 'nuevo';
    const isContacted = status !== 'nuevo';
    const refTimestamp = lead.lastContactedAt || (isContacted ? lead.updatedAt || lead.createdAt : null);

    const firstContactedAt =
      lead.firstContactedAt || (isContacted ? refTimestamp : null);

    const followUpCount =
      typeof lead.followUpCount === 'number'
        ? lead.followUpCount
        : isContacted && refTimestamp
        ? 1
        : 0;

    let contactHistory = Array.isArray(lead.contactHistory) ? [...lead.contactHistory] : [];
    if (contactHistory.length === 0 && isContacted && refTimestamp) {
      contactHistory = [
        {
          date: refTimestamp,
          stage: 1,
          channel: 'whatsapp',
          preview: String(lead.customPitch || lead.pitches?.whatsappDirect || '')
            .trim()
            .slice(0, 140)
        }
      ];
    }

    let nextFollowUpAt = lead.nextFollowUpAt;
    if (nextFollowUpAt === undefined) {
      if (['contactado', 'interesado', 'propuesta'].includes(status) && refTimestamp) {
        nextFollowUpAt = toLocalDateString(new Date(refTimestamp), 3);
      } else {
        nextFollowUpAt = null;
      }
    }

    return {
      ...lead,
      ...scored,
      audit: cleanedAudit,
      crmStatus: status,
      notes: lead.notes || '',
      firstContactedAt,
      lastContactedAt: lead.lastContactedAt || (isContacted ? refTimestamp : null),
      followUpCount,
      nextFollowUpAt,
      contactHistory,
      auditHistory: Array.isArray(lead.auditHistory) ? lead.auditHistory : [],
      lastAuditChange: lead.lastAuditChange || null,
      hasUnreadAuditChange: Boolean(lead.hasUnreadAuditChange),
      auditedAt: lead.auditedAt || lead.updatedAt || lead.createdAt || new Date().toISOString()
    };
  });

  saveLeads(updatedLeads);
  return { total: updatedLeads.length, migrated: updatedLeads.length, leads: updatedLeads };
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
  toLocalDateString,
  getDefaultFollowUpDays,
  loadLeads,
  saveLeads,
  computeAuditChange,
  upsertLead,
  updateLeadCrm,
  updateLeadFull,
  rescoreAndMigrateLeads,
  deleteLead,
  clearLeads,
  loadProgress,
  saveProgress
};
