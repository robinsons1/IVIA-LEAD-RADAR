let allLeads = [];
let activeFilter = 'ALL';
let currentModalLead = null;
let currentStage = 1;
let userEditedFollowUpDate = false;

const els = {
  scrapeForm: document.getElementById('scrape-form'),
  inputQuery: document.getElementById('input-query'),
  inputLocation: document.getElementById('input-location'),
  inputLimit: document.getElementById('input-limit'),
  inputAudit: document.getElementById('input-audit'),
  inputHeadless: document.getElementById('input-headless'),
  btnStart: document.getElementById('btn-start-scrape'),
  btnStop: document.getElementById('btn-stop-scrape'),
  statusDot: document.getElementById('engine-status-dot'),
  statusText: document.getElementById('engine-status-text'),
  consoleLogs: document.getElementById('console-logs'),
  consoleLabel: document.getElementById('console-progress-label'),
  progressBar: document.getElementById('scrape-progress-bar'),
  btnToggleConsole: document.getElementById('btn-toggle-console'),
  leadsTbody: document.getElementById('leads-tbody'),
  resultsCounter: document.getElementById('results-counter'),
  filterSearch: document.getElementById('filter-search'),
  filterCrm: document.getElementById('filter-crm'),
  filterSort: document.getElementById('filter-sort'),
  btnClearAll: document.getElementById('btn-clear-all'),
  // Stats
  statTotal: document.getElementById('stat-total'),
  statDueFollowUp: document.getElementById('stat-due-followup'),
  badgeDueFollowUp: document.getElementById('badge-due-followup'),
  kpiCardDue: document.getElementById('kpi-card-due'),
  statNoWeb: document.getElementById('stat-no-website'),
  statSocial: document.getElementById('stat-social-only'),
  statBroken: document.getElementById('stat-broken'),
  statGmail: document.getElementById('stat-generic-email'),
  statWhatsapp: document.getElementById('stat-whatsapp'),
  // Modal Pitch / Detalle / Edición
  pitchModal: document.getElementById('pitch-modal'),
  modalPitchBody: document.getElementById('modal-pitch-body'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnToggleEditLead: document.getElementById('btn-toggle-edit-lead'),
  btnReauditLead: document.getElementById('btn-reaudit-lead'),
  modalLeadName: document.getElementById('modal-lead-name'),
  modalLeadCategory: document.getElementById('modal-lead-category'),
  modalLeadSub: document.getElementById('modal-lead-sub'),
  modalLeadInfoCard: document.getElementById('modal-lead-info-card'),
  modalEditLeadPanel: document.getElementById('modal-edit-lead-panel'),
  editLeadName: document.getElementById('edit-lead-name'),
  editLeadCategory: document.getElementById('edit-lead-category'),
  editLeadPhone: document.getElementById('edit-lead-phone'),
  editLeadWebsite: document.getElementById('edit-lead-website'),
  editLeadCity: document.getElementById('edit-lead-city'),
  editLeadAddress: document.getElementById('edit-lead-address'),
  editLeadMapsUrl: document.getElementById('edit-lead-maps-url'),
  btnCancelEditLead: document.getElementById('btn-cancel-edit-lead'),
  btnSaveBusinessData: document.getElementById('btn-save-business-data'),
  modalAuditGrid: document.getElementById('modal-audit-grid'),
  modalPainTags: document.getElementById('modal-pain-tags'),
  modalPitchSection: document.getElementById('modal-pitch-section'),
  modalPitchTextarea: document.getElementById('modal-pitch-textarea'),
  modalFollowUpDate: document.getElementById('modal-followup-date'),
  btnGcalReminder: document.getElementById('btn-gcal-reminder'),
  modalContactHistory: document.getElementById('modal-contact-history'),
  modalNotesInput: document.getElementById('modal-notes-input'),
  modalCrmSelect: document.getElementById('modal-crm-select'),
  btnCopyPitch: document.getElementById('btn-copy-pitch'),
  btnSendEmailModal: document.getElementById('btn-send-email-modal'),
  btnSaveLeadModal: document.getElementById('btn-save-lead-modal'),
  btnSendWhatsappModal: document.getElementById('btn-send-whatsapp-modal'),
  // Modal Single Audit
  singleModal: document.getElementById('single-audit-modal'),
  btnOpenSingle: document.getElementById('btn-open-single-audit'),
  btnCloseSingle: document.getElementById('btn-close-single-modal'),
  singleForm: document.getElementById('single-audit-form')
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeHttpUrl(rawUrl) {
  const str = String(rawUrl || '').trim();
  if (!str) return '';
  const candidate = /^https?:\/\//i.test(str) ? str : `https://${str}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch (_) {}
  return '';
}

function toLocalDateStr(dateInput = new Date(), addDays = 0) {
  const d = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  if (addDays) d.setDate(d.getDate() + Number(addDays));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLocalTodayStr() {
  return toLocalDateStr(new Date(), 0);
}

function diffDaysFromToday(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

function getBrowserGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'buenos días';
  if (h >= 12 && h < 19) return 'buenas tardes';
  return 'buenas noches';
}

function adaptGreeting(text) {
  if (!text) return '';
  const g = getBrowserGreeting();
  return String(text)
    .replace(/^Hola,\s+(?:buenos días|buenas tardes|buenas noches)\./i, `Hola, ${g}.`)
    .replace(/^Hola de nuevo,\s+(?:buenos días|buenas tardes|buenas noches)\./i, `Hola de nuevo, ${g}.`);
}

function isLeadDueFollowUp(lead, todayStr = getLocalTodayStr()) {
  return Boolean(
    lead.nextFollowUpAt &&
      lead.nextFollowUpAt <= todayStr &&
      ['contactado', 'interesado', 'propuesta'].includes(lead.crmStatus)
  );
}

function isLeadBrokenOrInsecure(lead) {
  return (
    lead.primaryOpportunity === 'BROKEN_WEB' ||
    lead.primaryOpportunity === 'NO_SSL' ||
    Boolean(
      lead.audit &&
        (lead.audit.urlType === 'CUSTOM_DOMAIN' || lead.audit.urlType === 'FREE_BUILDER') &&
        (!lead.audit.reachable || !lead.audit.hasValidSsl)
    )
  );
}

function isLeadGenericEmailOnly(lead) {
  return (
    lead.primaryOpportunity === 'GENERIC_EMAIL' ||
    ((lead.audit?.genericEmails?.length || 0) > 0 &&
      (lead.audit?.corporateEmails?.length || 0) === 0)
  );
}

function appendConsoleLog(level, message) {
  const div = document.createElement('div');
  div.className = `log-entry ${level || 'info'}`;
  const time = new Date().toLocaleTimeString('es-CO', { hour12: false });
  div.textContent = `[${time}] ${message}`;
  els.consoleLogs.appendChild(div);
  els.consoleLogs.scrollTop = els.consoleLogs.scrollHeight;
}

function updateJobStatusUI(job) {
  if (!job) return;
  if (job.running) {
    els.statusDot.classList.add('running');
    els.statusText.textContent = `Extrayendo: ${job.processed || 0}/${job.foundCount || job.totalTarget}`;
    els.btnStart.classList.add('hidden');
    els.btnStop.classList.remove('hidden');

    const total = job.foundCount || job.totalTarget || 1;
    const pct = Math.min(100, Math.round(((job.processed || 0) / total) * 100));
    els.progressBar.style.width = `${pct}%`;
    els.consoleLabel.textContent = `Analizando "${job.query} en ${job.location}" · Progreso: ${job.processed || 0}/${total} (${pct}%)`;
  } else {
    els.statusDot.classList.remove('running');
    els.statusText.textContent = 'Motor Playwright Listo';
    els.btnStart.classList.remove('hidden');
    els.btnStop.classList.add('hidden');
  }
}

function renderStats() {
  const today = getLocalTodayStr();
  const dueCount = allLeads.filter((l) => isLeadDueFollowUp(l, today)).length;

  els.statTotal.textContent = allLeads.length;
  els.statDueFollowUp.textContent = dueCount;

  if (dueCount > 0) {
    els.kpiCardDue.classList.add('has-due');
    els.badgeDueFollowUp.className = 'kpi-badge amber';
    els.badgeDueFollowUp.textContent = 'Urgente';
  } else {
    els.kpiCardDue.classList.remove('has-due');
    els.badgeDueFollowUp.className = 'kpi-badge emerald';
    els.badgeDueFollowUp.textContent = 'Al día';
  }

  els.statNoWeb.textContent = allLeads.filter((l) => l.primaryOpportunity === 'NO_WEBSITE').length;
  els.statSocial.textContent = allLeads.filter((l) => l.primaryOpportunity === 'SOCIAL_ONLY').length;
  els.statBroken.textContent = allLeads.filter((l) => isLeadBrokenOrInsecure(l)).length;
  els.statGmail.textContent = allLeads.filter((l) => isLeadGenericEmailOnly(l)).length;
  els.statWhatsapp.textContent = allLeads.filter((l) => l.isWhatsappMobile).length;
}

function getFilteredLeads() {
  const search = (els.filterSearch.value || '').trim().toLowerCase();
  const crmFilter = els.filterCrm.value;
  const sortBy = els.filterSort.value;
  const today = getLocalTodayStr();

  const filtered = allLeads.filter((lead) => {
    if (activeFilter === 'DUE_FOLLOWUP' && !isLeadDueFollowUp(lead, today)) return false;
    if (activeFilter === 'NO_WEBSITE' && lead.primaryOpportunity !== 'NO_WEBSITE') return false;
    if (activeFilter === 'SOCIAL_ONLY' && lead.primaryOpportunity !== 'SOCIAL_ONLY') return false;
    if (activeFilter === 'BROKEN_OR_INSECURE' && !isLeadBrokenOrInsecure(lead)) return false;
    if (activeFilter === 'GENERIC_EMAIL' && !isLeadGenericEmailOnly(lead)) return false;
    if (activeFilter === 'WHATSAPP_MOBILE' && !lead.isWhatsappMobile) return false;

    if (crmFilter !== 'ALL' && (lead.crmStatus || 'nuevo') !== crmFilter) return false;

    if (search) {
      const haystack = [
        lead.name,
        lead.cleanName,
        lead.category,
        lead.city,
        lead.address,
        lead.phone,
        lead.website,
        lead.primaryLabel,
        lead.notes,
        ...(lead.audit?.allEmails || [])
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'followup_due') {
      const aDue = isLeadDueFollowUp(a, today) ? 1 : 0;
      const bDue = isLeadDueFollowUp(b, today) ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;
      if (a.nextFollowUpAt && b.nextFollowUpAt) {
        return a.nextFollowUpAt.localeCompare(b.nextFollowUpAt);
      }
      if (a.nextFollowUpAt) return -1;
      if (b.nextFollowUpAt) return 1;
      return (b.score || 0) - (a.score || 0);
    }
    if (sortBy === 'reviews_desc') return (b.reviewsCount || 0) - (a.reviewsCount || 0);
    if (sortBy === 'recent') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    return (b.score || 0) - (a.score || 0);
  });

  return filtered;
}

function buildFollowUpBadgeHtml(lead) {
  const count = lead.followUpCount || 0;
  const nextTouch = Math.min(4, count + 1);
  const diff = diffDaysFromToday(lead.nextFollowUpAt);

  if (
    lead.nextFollowUpAt &&
    ['contactado', 'interesado', 'propuesta'].includes(lead.crmStatus) &&
    diff !== null
  ) {
    if (diff < 0) {
      return `<div class="followup-pill overdue">⚠️ Vencido hace ${Math.abs(diff)}d · T${nextTouch}</div>`;
    }
    if (diff === 0) {
      return `<div class="followup-pill due-today">⏰ Hoy toca Toque ${nextTouch}</div>`;
    }
    return `<div class="followup-pill upcoming">Toque ${count} · en ${diff}d (${escapeHtml(formatShortDate(lead.nextFollowUpAt))})</div>`;
  }

  if (count > 0 && lead.crmStatus === 'contactado') {
    return `<div class="followup-pill done">✓ ${count} ${count === 1 ? 'toque' : 'toques'}</div>`;
  }

  return '';
}

function renderTable() {
  renderStats();
  const list = getFilteredLeads();
  const today = getLocalTodayStr();
  els.resultsCounter.textContent = `Mostrando ${list.length} de ${allLeads.length} prospectos`;

  if (list.length === 0) {
    els.leadsTbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          No hay prospectos que coincidan con este filtro.
        </td>
      </tr>
    `;
    return;
  }

  els.leadsTbody.innerHTML = list
    .map((lead) => {
      const emails = lead.audit?.allEmails || [];
      const websiteDisplay = lead.audit?.normalizedUrl || lead.website;
      const tagsHtml = (lead.painTags || [])
        .slice(0, 4)
        .map((t) => `<span class="sub-tag">${escapeHtml(t)}</span>`)
        .join('');

      const isDue = isLeadDueFollowUp(lead, today);
      const nextTouch = Math.min(4, (lead.followUpCount || 0) + 1);
      const actionBtnClass = isDue ? 'btn-followup' : 'btn-whatsapp';
      const actionBtnText = isDue ? `🔔 Seguim. T${nextTouch}` : '💬 Pitch / WhatsApp';

      return `
        <tr data-id="${escapeHtml(lead.id)}">
          <td>
            <div class="score-pill ${escapeHtml(lead.priority || 'MEDIA')}">
              <span class="num">${lead.score || 0}</span>
              <span class="lbl">${escapeHtml(lead.priority || 'MEDIA')}</span>
            </div>
          </td>
          <td>
            <div class="biz-title biz-title-link" data-action="open-detail" data-id="${escapeHtml(lead.id)}" title="Ver ficha completa y editar">${escapeHtml(lead.name)}</div>
            <div class="biz-meta">
              <span>${escapeHtml(lead.category || 'Negocio')}</span>
              <span>·</span>
              <span class="stars-chip">★ ${lead.rating || '—'} (${lead.reviewsCount || 0})</span>
              <span>·</span>
              <span>${escapeHtml(lead.city || '')}</span>
              ${
                lead.mapsUrl
                  ? `<a href="${escapeHtml(lead.mapsUrl)}" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:600;">Maps ↗</a>`
                  : ''
              }
            </div>
          </td>
          <td>
            <span class="pain-badge-main ${escapeHtml(lead.primaryOpportunity)}">
              ${escapeHtml(lead.primaryLabel)}
            </span>
            <div class="sub-tags">${tagsHtml}</div>
          </td>
          <td>
            <div class="plan-suggestion">${escapeHtml(lead.recommendedPlan)}</div>
          </td>
          <td>
            <div class="contact-list">
              ${
                lead.phone
                  ? `<span class="phone-tag ${lead.isWhatsappMobile ? 'mobile' : ''}">
                      ${lead.isWhatsappMobile ? '📱 ' : '☎️ '}${escapeHtml(lead.phone)}
                    </span>`
                  : '<span style="color:#94a3b8;">Sin teléfono</span>'
              }
              ${
                emails.length > 0
                  ? `<span style="color:#2563eb;font-weight:600;">✉️ ${escapeHtml(emails[0])}</span>`
                  : ''
              }
              ${
                websiteDisplay
                  ? `<a href="${escapeHtml(websiteDisplay)}" target="_blank" style="color:#64748b;font-size:0.74rem;text-overflow:ellipsis;overflow:hidden;max-width:190px;white-space:nowrap;">🌐 ${escapeHtml(
                      lead.audit?.hostname || websiteDisplay
                    )}</a>`
                  : '<span style="color:#dc2626;font-size:0.73rem;font-weight:700;">❌ Sin sitio web</span>'
              }
            </div>
          </td>
          <td>
            <select class="crm-select-inline" data-action="crm-change" data-id="${escapeHtml(lead.id)}">
              <option value="nuevo" ${lead.crmStatus === 'nuevo' ? 'selected' : ''}>🆕 Nuevo</option>
              <option value="contactado" ${lead.crmStatus === 'contactado' ? 'selected' : ''}>📤 Contactado</option>
              <option value="interesado" ${lead.crmStatus === 'interesado' ? 'selected' : ''}>🔥 Interesado</option>
              <option value="propuesta" ${lead.crmStatus === 'propuesta' ? 'selected' : ''}>📋 Propuesta</option>
              <option value="cliente" ${lead.crmStatus === 'cliente' ? 'selected' : ''}>✅ Cliente</option>
              <option value="descartado" ${lead.crmStatus === 'descartado' ? 'selected' : ''}>❌ Descartado</option>
            </select>
            ${buildFollowUpBadgeHtml(lead)}
          </td>
          <td style="text-align:right;">
            <div class="action-group">
              <button type="button" class="btn btn-outline btn-sm" data-action="open-detail" data-id="${escapeHtml(lead.id)}" title="Ver toda la información y editar datos">
                ✏️ Ver / Editar
              </button>
              <button type="button" class="btn ${actionBtnClass} btn-sm" data-action="open-pitch" data-id="${escapeHtml(lead.id)}">
                ${actionBtnText}
              </button>
              <button type="button" class="btn btn-ghost-danger btn-sm" data-action="delete-lead" data-id="${escapeHtml(lead.id)}" title="Eliminar">
                &times;
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

async function fetchInitialLeads() {
  try {
    const res = await fetch('/api/leads');
    const data = await res.json();
    allLeads = data.leads || [];
    updateJobStatusUI(data.job);
    renderTable();
  } catch (err) {
    appendConsoleLog('error', `Error cargando base de datos local: ${err.message}`);
  }
}

function connectSse() {
  const es = new EventSource('/api/scrape/stream');
  es.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      if (payload.type === 'init' || payload.type === 'status') {
        updateJobStatusUI(payload.job);
      } else if (payload.type === 'log') {
        appendConsoleLog(payload.level, payload.message);
      } else if (payload.type === 'lead' && payload.lead) {
        updateJobStatusUI(payload.job);
        const idx = allLeads.findIndex((l) => l.id === payload.lead.id);
        if (idx >= 0) {
          allLeads[idx] = payload.lead;
        } else {
          allLeads.unshift(payload.lead);
        }
        renderTable();
      }
    } catch (_) {}
  };
}

function getStagePitchText(lead, stage) {
  const cadence = lead.pitches?.cadence || {};
  const map = {
    1: cadence.stage1 || lead.pitches?.whatsappDirect || '',
    2: cadence.stage2 || '',
    3: cadence.stage3 || lead.pitches?.whatsappAutomation || '',
    4: cadence.stage4 || ''
  };
  return adaptGreeting(map[stage] || map[1] || '');
}

function setActiveStageTab(stage) {
  currentStage = stage;
  document.querySelectorAll('.pitch-tab').forEach((tab) => {
    tab.classList.toggle('active', Number(tab.dataset.stage) === stage);
  });
  document.querySelectorAll('.reply-chip').forEach((chip) => chip.classList.remove('active'));
  els.btnSendWhatsappModal.querySelector('span').textContent = `Enviar por WhatsApp (Toque ${stage}) →`;
}

function updateModalGcalHref() {
  if (!currentModalLead) return;
  const name = currentModalLead.cleanName || currentModalLead.name;
  const targetDateStr = els.modalFollowUpDate.value || toLocalDateStr(new Date(), 3);
  const compactDate = targetDateStr.replace(/-/g, '');
  const nextTouch = Math.min(4, (currentModalLead.followUpCount || 0) + 1);

  const dParts = targetDateStr.split('-').map(Number);
  let endCompact = compactDate;
  if (dParts.length === 3) {
    const endD = new Date(dParts[0], dParts[1] - 1, dParts[2] + 1);
    endCompact = toLocalDateStr(endD, 0).replace(/-/g, '');
  }

  const details = [
    `Prospecto: ${name}`,
    `Teléfono/WA: ${currentModalLead.phone || 'N/A'}`,
    `Diagnóstico: ${currentModalLead.primaryLabel || ''}`,
    `Toque sugerido: #${nextTouch}`,
    `Notas: ${els.modalNotesInput.value || currentModalLead.notes || 'Ninguna'}`,
    `Abrir CRM local: http://localhost:3000`
  ].join('\n');

  const url =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(`Seguimiento IVIA (T${nextTouch}): ${name}`)}` +
    `&dates=${compactDate}/${endCompact}` +
    `&details=${encodeURIComponent(details)}`;

  els.btnGcalReminder.href = url;
}

function updateModalChannelHrefs() {
  if (!currentModalLead) return;
  const text = els.modalPitchTextarea.value || '';
  const phone = currentModalLead.phoneE164 || '';

  if (phone) {
    els.btnSendWhatsappModal.href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  } else {
    els.btnSendWhatsappModal.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  }

  const emails = currentModalLead.audit?.allEmails || [];
  if (emails.length > 0) {
    const subject =
      currentModalLead.pitches?.emailSubject ||
      `Consulta sobre ${currentModalLead.cleanName || currentModalLead.name}`;
    els.btnSendEmailModal.href = `mailto:${encodeURIComponent(emails[0])}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(text)}`;
    els.btnSendEmailModal.classList.remove('hidden');
  } else {
    els.btnSendEmailModal.classList.add('hidden');
  }
}

function getAuditFreshnessInfo(lead) {
  const ref = lead.auditedAt || lead.createdAt;
  if (!ref) return { label: 'Sin fecha', stale: false };
  const days = Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return { label: 'Auditado hoy', stale: false };
  if (days === 1) return { label: 'Auditado ayer', stale: false };
  return { label: `Auditado hace ${days} días`, stale: days > 14 };
}

function renderContactHistory(lead) {
  const history = Array.isArray(lead.contactHistory) ? lead.contactHistory : [];
  if (history.length === 0) {
    els.modalContactHistory.textContent = 'Historial: Sin contactos registrados todavía.';
    return;
  }
  const items = history.slice(-4).map((h) => {
    const localDay = formatShortDate(toLocalDateStr(new Date(h.date), 0));
    const ch = h.channel === 'email' ? 'Correo' : 'WA';
    return `T${h.stage || 1} (${ch} · ${localDay})`;
  });
  els.modalContactHistory.textContent = `Historial (${history.length}): ${items.join(' → ')}`;
}

function populateEditLeadInputs(lead) {
  els.editLeadName.value = lead.name || '';
  els.editLeadCategory.value = lead.category || '';
  els.editLeadPhone.value = lead.phone || '';
  els.editLeadWebsite.value = lead.website || '';
  els.editLeadCity.value = lead.city || '';
  els.editLeadAddress.value = lead.address || '';
  els.editLeadMapsUrl.value = lead.mapsUrl || '';
}

function getEditedBusinessPayload() {
  return {
    name: els.editLeadName.value.trim(),
    category: els.editLeadCategory.value.trim(),
    phone: els.editLeadPhone.value.trim(),
    website: els.editLeadWebsite.value.trim(),
    city: els.editLeadCity.value.trim(),
    address: els.editLeadAddress.value.trim(),
    mapsUrl: els.editLeadMapsUrl.value.trim()
  };
}

function renderLeadInfoCard(lead) {
  const audit = lead.audit || {};
  const websiteRaw = audit.normalizedUrl || lead.website || '';
  const websiteHref = safeHttpUrl(websiteRaw);
  const mapsHref = safeHttpUrl(lead.mapsUrl || '');
  const emails = audit.allEmails || [];
  const genericSet = new Set(audit.genericEmails || []);
  const social = audit.socialLinks || {};

  const socialEntries = [
    { key: 'instagram', label: 'Instagram' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'tiktok', label: 'TikTok' }
  ]
    .map((s) => ({ ...s, href: safeHttpUrl(social[s.key]) }))
    .filter((s) => Boolean(s.href));

  const phoneHtml = lead.phone
    ? `<span class="phone-tag ${lead.isWhatsappMobile ? 'mobile' : ''}">${
        lead.isWhatsappMobile ? '📱 ' : '☎️ '
      }<a href="tel:${escapeHtml(lead.phone.replace(/\s+/g, ''))}" class="lead-info-link">${escapeHtml(
        lead.phone
      )}</a></span>
       <span class="lead-info-badge ${lead.isWhatsappMobile ? 'mobile' : ''}">${
         lead.isWhatsappMobile ? 'WhatsApp Móvil' : lead.phoneType === 'landline' ? 'Fijo' : 'Teléfono'
       }</span>
       <button type="button" class="btn-copy-inline" data-copy="${escapeHtml(lead.phone)}">📋 Copiar</button>`
    : '<span class="lead-info-badge danger">Sin teléfono</span>';

  const webHtml = websiteHref
    ? `<a href="${escapeHtml(websiteHref)}" target="_blank" rel="noopener noreferrer" class="lead-info-link">🌐 ${escapeHtml(
        websiteHref
      )} ↗</a>
       <button type="button" class="btn-copy-inline" data-copy="${escapeHtml(websiteHref)}">📋 Copiar</button>`
    : '<span class="lead-info-badge danger">❌ Sin sitio web</span>';

  const mapsHtml = mapsHref
    ? `<a href="${escapeHtml(mapsHref)}" target="_blank" rel="noopener noreferrer" class="lead-info-link">📍 Abrir en Google Maps ↗</a>
       <button type="button" class="btn-copy-inline" data-copy="${escapeHtml(mapsHref)}">📋 Copiar link</button>`
    : '<span style="color:#94a3b8;">Sin enlace de Google Maps</span>';

  const emailsHtml =
    emails.length > 0
      ? emails
          .map((email) => {
            const isGen = genericSet.has(email);
            return `<span class="lead-info-row">
              <a href="mailto:${escapeHtml(email)}" class="lead-info-link">✉️ ${escapeHtml(email)}</a>
              <span class="lead-info-badge ${isGen ? 'generic' : 'mobile'}">${
              isGen ? 'Genérico' : 'Corporativo'
            }</span>
              <button type="button" class="btn-copy-inline" data-copy="${escapeHtml(email)}">📋</button>
            </span>`;
          })
          .join('')
      : '<span style="color:#94a3b8;">Sin correos detectados</span>';

  const addressText = [lead.address, lead.city].filter(Boolean).join(' · ') || 'Sin dirección registrada';

  els.modalLeadInfoCard.innerHTML = `
    <div class="lead-info-grid">
      <div class="lead-info-item">
        <span class="lead-info-label">📱 Teléfono / WhatsApp</span>
        <div class="lead-info-row">${phoneHtml}</div>
      </div>
      <div class="lead-info-item">
        <span class="lead-info-label">🌐 Página Web</span>
        <div class="lead-info-row">${webHtml}</div>
      </div>
      <div class="lead-info-item">
        <span class="lead-info-label">📍 Google Maps y Ubicación</span>
        <div class="lead-info-row">${mapsHtml}</div>
        <div class="lead-info-row" style="color:#475569;font-size:0.76rem;">
          <span>${escapeHtml(addressText)}</span>
          ${
            lead.address
              ? `<button type="button" class="btn-copy-inline" data-copy="${escapeHtml(lead.address)}">📋 Dir.</button>`
              : ''
          }
        </div>
      </div>
      <div class="lead-info-item">
        <span class="lead-info-label">✉️ Correos Detectados (${emails.length})</span>
        <div style="display:flex;flex-direction:column;gap:0.3rem;">${emailsHtml}</div>
      </div>
      ${
        socialEntries.length > 0
          ? `<div class="lead-info-item full-width">
               <span class="lead-info-label">🔗 Redes Sociales</span>
               <div class="social-links-row">
                 ${socialEntries
                   .map(
                     (s) =>
                       `<a href="${escapeHtml(s.href)}" target="_blank" rel="noopener noreferrer" class="social-pill">${escapeHtml(
                         s.label
                       )} ↗</a>`
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }
    </div>
  `;
}

// Abrir modal de Ficha Completa, Edición, Pitch y Auditoría
function openPitchModal(leadId, options = {}) {
  const { focusSection = 'top', keepEditOpen = false } = options;
  const lead = allLeads.find((l) => l.id === leadId);
  if (!lead) return;
  currentModalLead = lead;

  els.modalLeadName.textContent = lead.name || lead.cleanName || 'Negocio';
  els.modalLeadCategory.textContent = `${lead.category || 'Empresa'} · ${lead.city || 'Colombia'} · Score ${
    lead.score || 0
  }/100 (${lead.priority || 'MEDIA'})`;

  const subParts = [`★ ${lead.rating || '—'} (${lead.reviewsCount || 0} reseñas)`];
  if (lead.cleanName && lead.cleanName !== lead.name) {
    subParts.push(`Nombre corto en pitch: ${lead.cleanName}`);
  }
  if (lead.searchQuery) {
    subParts.push(`Búsqueda: ${lead.searchQuery}`);
  }
  els.modalLeadSub.textContent = subParts.join(' · ');

  renderLeadInfoCard(lead);
  populateEditLeadInputs(lead);

  if (!keepEditOpen) {
    els.modalEditLeadPanel.classList.add('hidden');
    els.btnToggleEditLead.classList.remove('active');
  }

  const audit = lead.audit || {};
  const freshness = getAuditFreshnessInfo(lead);
  const sslStatusText =
    audit.urlType === 'NO_WEBSITE'
      ? 'Sin Sitio Web'
      : audit.urlType === 'SOCIAL_ONLY'
      ? `Solo ${audit.hostname}`
      : audit.reachable
      ? `${audit.hasValidSsl ? 'HTTPS Seguro' : '⚠️ Sin SSL'} (${audit.loadTimeMs || 0}ms)`
      : `Caído (${audit.error || 'Error'})`;

  els.modalAuditGrid.innerHTML = `
    <div class="audit-item">
      <span class="k">Diagnóstico Principal</span>
      <span class="v"><span class="pain-badge-main ${escapeHtml(lead.primaryOpportunity)}" style="margin:2px 0 0;">${escapeHtml(
    lead.primaryLabel
  )}</span></span>
    </div>
    <div class="audit-item">
      <span class="k">Plan IVIA Sugerido</span>
      <span class="v">${escapeHtml(lead.recommendedPlan)}</span>
    </div>
    <div class="audit-item">
      <span class="k">Estado Web &amp; SSL</span>
      <span class="v">${escapeHtml(sslStatusText)}</span>
    </div>
    <div class="audit-item">
      <span class="k">Servidor de Correo (MX)</span>
      <span class="v">${escapeHtml(audit.mxProvider || 'Sin dominio propio')}</span>
    </div>
    <div class="audit-item">
      <span class="k">Tecnología &amp; Móvil</span>
      <span class="v">${escapeHtml(audit.cms || 'N/A')} · Móvil: ${
    audit.hasMobileViewport ? 'Sí' : 'No'
  } · Botón WA: ${audit.hasWhatsappWidget ? 'Sí' : 'No'}</span>
    </div>
    <div class="audit-item">
      <span class="k">Frescura de Auditoría</span>
      <span class="v ${freshness.stale ? 'audit-stale' : ''}">${escapeHtml(freshness.label)}</span>
    </div>
  `;

  els.modalPainTags.innerHTML = (lead.painTags || [])
    .map((t) => `<span class="sub-tag">${escapeHtml(t)}</span>`)
    .join('');

  const count = lead.followUpCount || 0;
  const defaultStage = count === 0 ? 1 : count === 1 ? 2 : count === 2 ? 3 : 4;
  setActiveStageTab(defaultStage);

  els.modalPitchTextarea.value =
    defaultStage === 1 && lead.customPitch && count === 0
      ? lead.customPitch
      : getStagePitchText(lead, defaultStage);

  els.modalFollowUpDate.value = lead.nextFollowUpAt || '';
  userEditedFollowUpDate = false;

  els.modalNotesInput.value = lead.notes || '';
  els.modalCrmSelect.value = lead.crmStatus || 'nuevo';
  renderContactHistory(lead);
  updateModalChannelHrefs();
  updateModalGcalHref();

  els.pitchModal.classList.remove('hidden');

  if (focusSection === 'pitch') {
    requestAnimationFrame(() => {
      els.modalPitchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    els.modalPitchBody.scrollTop = 0;
  }
}

// Event Listeners
document.querySelectorAll('.preset-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.inputQuery.value = btn.dataset.query || '';
    if (btn.dataset.location) els.inputLocation.value = btn.dataset.location;
  });
});

document.querySelectorAll('.kpi-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.kpi-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    activeFilter = card.dataset.filter || 'ALL';
    renderTable();
  });
});

els.scrapeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    query: els.inputQuery.value.trim(),
    location: els.inputLocation.value.trim(),
    maxResults: Number(els.inputLimit.value) || 15,
    auditWebsites: els.inputAudit.checked,
    headless: els.inputHeadless.checked
  };

  try {
    const res = await fetch('/api/scrape/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      appendConsoleLog('error', data.error || 'No se pudo iniciar la búsqueda');
      return;
    }
    updateJobStatusUI(data.job);
  } catch (err) {
    appendConsoleLog('error', err.message);
  }
});

els.btnStop.addEventListener('click', async () => {
  await fetch('/api/scrape/stop', { method: 'POST' });
});

els.btnToggleConsole.addEventListener('click', () => {
  els.consoleLogs.classList.toggle('hidden');
});

els.filterSearch.addEventListener('input', renderTable);
els.filterCrm.addEventListener('change', renderTable);
els.filterSort.addEventListener('change', renderTable);

els.leadsTbody.addEventListener('change', async (e) => {
  const select = e.target.closest('select[data-action="crm-change"]');
  if (!select) return;
  const id = select.dataset.id;
  const crmStatus = select.value;
  const res = await fetch(`/api/leads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ crmStatus })
  });
  if (res.ok) {
    const { lead } = await res.json();
    const idx = allLeads.findIndex((l) => l.id === id);
    if (idx >= 0) allLeads[idx] = lead;
    renderTable();
  }
});

els.leadsTbody.addEventListener('click', async (e) => {
  const detailTrigger = e.target.closest('[data-action="open-detail"]');
  if (detailTrigger) {
    openPitchModal(detailTrigger.dataset.id, { focusSection: 'top' });
    return;
  }

  const pitchBtn = e.target.closest('button[data-action="open-pitch"]');
  if (pitchBtn) {
    openPitchModal(pitchBtn.dataset.id, { focusSection: 'pitch' });
    return;
  }

  const delBtn = e.target.closest('button[data-action="delete-lead"]');
  if (delBtn) {
    const id = delBtn.dataset.id;
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (res.ok) {
      allLeads = allLeads.filter((l) => l.id !== id);
      renderTable();
    }
  }
});

els.btnClearAll.addEventListener('click', async () => {
  if (!confirm('¿Estás seguro de eliminar todos los prospectos guardados?')) return;
  await fetch('/api/leads', { method: 'DELETE' });
  allLeads = [];
  renderTable();
});

// Eventos del Modal de Pitch, Cadencia y Seguimiento
document.querySelectorAll('.pitch-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (!currentModalLead) return;
    const stage = Number(tab.dataset.stage) || 1;
    setActiveStageTab(stage);
    els.modalPitchTextarea.value = getStagePitchText(currentModalLead, stage);
    updateModalChannelHrefs();
  });
});

document.querySelectorAll('.reply-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    if (!currentModalLead) return;
    const key = chip.dataset.reply;
    const replyText = currentModalLead.pitches?.replies?.[key] || '';
    if (!replyText) return;
    document.querySelectorAll('.reply-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    els.modalPitchTextarea.value = replyText;
    updateModalChannelHrefs();
  });
});

document.querySelectorAll('.followup-quick-btns .chip-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const days = Number(btn.dataset.days) || 0;
    els.modalFollowUpDate.value = days > 0 ? toLocalDateStr(new Date(), days) : '';
    userEditedFollowUpDate = true;
    updateModalGcalHref();
  });
});

els.modalFollowUpDate.addEventListener('change', () => {
  userEditedFollowUpDate = true;
  updateModalGcalHref();
});

els.modalNotesInput.addEventListener('input', updateModalGcalHref);

els.modalPitchTextarea.addEventListener('input', updateModalChannelHrefs);

els.btnReauditLead.addEventListener('click', async () => {
  if (!currentModalLead) return;
  const btn = els.btnReauditLead;
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Auditando...';

  try {
    const res = await fetch(`/api/leads/${currentModalLead.id}/reaudit`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.lead) {
      const idx = allLeads.findIndex((l) => l.id === data.lead.id);
      if (idx >= 0) allLeads[idx] = data.lead;
      renderTable();
      openPitchModal(data.lead.id);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
});

els.btnCopyPitch.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.modalPitchTextarea.value);
  const prev = els.btnCopyPitch.textContent;
  els.btnCopyPitch.textContent = '✅ ¡Copiado!';
  setTimeout(() => {
    els.btnCopyPitch.textContent = prev;
  }, 1500);
});

els.modalLeadInfoCard.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('.btn-copy-inline');
  if (!copyBtn) return;
  const value = copyBtn.dataset.copy || '';
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const prev = copyBtn.textContent;
    copyBtn.textContent = '✅';
    setTimeout(() => {
      copyBtn.textContent = prev;
    }, 1200);
  } catch (_) {}
});

els.btnToggleEditLead.addEventListener('click', () => {
  if (!currentModalLead) return;
  const isOpening = els.modalEditLeadPanel.classList.contains('hidden');
  if (isOpening) {
    populateEditLeadInputs(currentModalLead);
    els.modalEditLeadPanel.classList.remove('hidden');
    els.btnToggleEditLead.classList.add('active');
    els.editLeadName.focus();
  } else {
    els.modalEditLeadPanel.classList.add('hidden');
    els.btnToggleEditLead.classList.remove('active');
  }
});

els.btnCancelEditLead.addEventListener('click', () => {
  if (currentModalLead) populateEditLeadInputs(currentModalLead);
  els.modalEditLeadPanel.classList.add('hidden');
  els.btnToggleEditLead.classList.remove('active');
});

async function saveBusinessFieldsAndMaybeReaudit() {
  if (!currentModalLead) return null;
  const payload = getEditedBusinessPayload();
  const prevWebsite = (currentModalLead.website || '').trim();
  const websiteChanged = payload.website !== prevWebsite;

  const res = await fetch(`/api/leads/${currentModalLead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return null;

  let { lead } = await res.json();

  if (websiteChanged && payload.website) {
    const reauditRes = await fetch(`/api/leads/${lead.id}/reaudit`, { method: 'POST' });
    if (reauditRes.ok) {
      const reauditData = await reauditRes.json();
      if (reauditData.lead) lead = reauditData.lead;
    }
  }

  const idx = allLeads.findIndex((l) => l.id === lead.id);
  if (idx >= 0) allLeads[idx] = lead;
  renderTable();
  return lead;
}

els.btnSaveBusinessData.addEventListener('click', async () => {
  if (!currentModalLead) return;
  const btn = els.btnSaveBusinessData;
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';
  try {
    const updatedLead = await saveBusinessFieldsAndMaybeReaudit();
    if (updatedLead) {
      openPitchModal(updatedLead.id, { focusSection: 'top', keepEditOpen: false });
    }
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
});

els.btnSaveLeadModal.addEventListener('click', async () => {
  if (!currentModalLead) return;
  const editPanelOpen = !els.modalEditLeadPanel.classList.contains('hidden');
  const prevWebsite = (currentModalLead.website || '').trim();
  const businessPayload = editPanelOpen ? getEditedBusinessPayload() : {};
  const websiteChanged = editPanelOpen && businessPayload.website !== prevWebsite;

  const res = await fetch(`/api/leads/${currentModalLead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...businessPayload,
      notes: els.modalNotesInput.value,
      crmStatus: els.modalCrmSelect.value,
      nextFollowUpAt: els.modalFollowUpDate.value || null,
      customPitch: els.modalPitchTextarea.value
    })
  });
  if (res.ok) {
    let { lead } = await res.json();
    if (websiteChanged && businessPayload.website) {
      const reauditRes = await fetch(`/api/leads/${lead.id}/reaudit`, { method: 'POST' });
      if (reauditRes.ok) {
        const reauditData = await reauditRes.json();
        if (reauditData.lead) lead = reauditData.lead;
      }
    }
    const idx = allLeads.findIndex((l) => l.id === lead.id);
    if (idx >= 0) allLeads[idx] = lead;
    renderTable();
    els.pitchModal.classList.add('hidden');
  }
});

async function recordLeadContact(channel) {
  if (!currentModalLead) return;
  const recordContact = {
    stage: currentStage,
    channel,
    message: els.modalPitchTextarea.value
  };
  if (userEditedFollowUpDate) {
    recordContact.nextFollowUpAt = els.modalFollowUpDate.value || null;
  }

  const res = await fetch(`/api/leads/${currentModalLead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      crmStatus: els.modalCrmSelect.value === 'nuevo' ? 'contactado' : els.modalCrmSelect.value,
      notes: els.modalNotesInput.value,
      customPitch: els.modalPitchTextarea.value,
      recordContact
    })
  });

  if (res.ok) {
    const { lead } = await res.json();
    currentModalLead = lead;
    const idx = allLeads.findIndex((l) => l.id === lead.id);
    if (idx >= 0) allLeads[idx] = lead;
    els.modalCrmSelect.value = lead.crmStatus;
    els.modalFollowUpDate.value = lead.nextFollowUpAt || '';
    userEditedFollowUpDate = false;
    renderContactHistory(lead);
    updateModalGcalHref();
    renderTable();
  }
}

els.btnSendWhatsappModal.addEventListener('click', () => {
  recordLeadContact('whatsapp');
});

els.btnSendEmailModal.addEventListener('click', () => {
  recordLeadContact('email');
});

els.btnCloseModal.addEventListener('click', () => {
  els.pitchModal.classList.add('hidden');
});

els.pitchModal.addEventListener('click', (e) => {
  if (e.target === els.pitchModal) {
    els.pitchModal.classList.add('hidden');
  }
});

// Modal de Auditoría Individual
els.btnOpenSingle.addEventListener('click', () => {
  els.singleModal.classList.remove('hidden');
});

els.btnCloseSingle.addEventListener('click', () => {
  els.singleModal.classList.add('hidden');
});

els.singleModal.addEventListener('click', (e) => {
  if (e.target === els.singleModal) {
    els.singleModal.classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.pitchModal.classList.contains('hidden')) {
      els.pitchModal.classList.add('hidden');
    }
    if (!els.singleModal.classList.contains('hidden')) {
      els.singleModal.classList.add('hidden');
    }
  }
});

els.singleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-submit-single-audit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Auditando...';

  try {
    const res = await fetch('/api/audit-single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('single-name').value,
        category: document.getElementById('single-category').value,
        city: document.getElementById('single-city').value,
        phone: document.getElementById('single-phone').value,
        website: document.getElementById('single-website').value
      })
    });
    const data = await res.json();
    if (res.ok && data.lead) {
      els.singleModal.classList.add('hidden');
      els.singleForm.reset();
      openPitchModal(data.lead.id);
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ejecutar Auditoría IVIA';
  }
});

fetchInitialLeads();
connectSse();
