let allLeads = [];
let activeFilter = 'ALL';
let currentModalLead = null;

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
  statNoWeb: document.getElementById('stat-no-website'),
  statSocial: document.getElementById('stat-social-only'),
  statBroken: document.getElementById('stat-broken'),
  statGmail: document.getElementById('stat-generic-email'),
  statWhatsapp: document.getElementById('stat-whatsapp'),
  // Modal Pitch
  pitchModal: document.getElementById('pitch-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  modalLeadName: document.getElementById('modal-lead-name'),
  modalLeadCategory: document.getElementById('modal-lead-category'),
  modalAuditGrid: document.getElementById('modal-audit-grid'),
  modalPitchTextarea: document.getElementById('modal-pitch-textarea'),
  modalNotesInput: document.getElementById('modal-notes-input'),
  modalCrmSelect: document.getElementById('modal-crm-select'),
  btnCopyPitch: document.getElementById('btn-copy-pitch'),
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
  els.statTotal.textContent = allLeads.length;
  els.statNoWeb.textContent = allLeads.filter((l) => l.primaryOpportunity === 'NO_WEBSITE').length;
  els.statSocial.textContent = allLeads.filter((l) => l.primaryOpportunity === 'SOCIAL_ONLY').length;
  els.statBroken.textContent = allLeads.filter(
    (l) =>
      l.primaryOpportunity === 'BROKEN_WEB' ||
      l.primaryOpportunity === 'NO_SSL' ||
      (l.audit && l.audit.urlType === 'CUSTOM_DOMAIN' && (!l.audit.reachable || !l.audit.hasValidSsl))
  ).length;
  els.statGmail.textContent = allLeads.filter(
    (l) =>
      l.primaryOpportunity === 'GENERIC_EMAIL' ||
      (l.audit?.genericEmails && l.audit.genericEmails.length > 0)
  ).length;
  els.statWhatsapp.textContent = allLeads.filter((l) => l.isWhatsappMobile).length;
}

function getFilteredLeads() {
  const search = (els.filterSearch.value || '').trim().toLowerCase();
  const crmFilter = els.filterCrm.value;
  const sortBy = els.filterSort.value;

  const filtered = allLeads.filter((lead) => {
    // Filtro por tarjeta KPI
    if (activeFilter === 'NO_WEBSITE' && lead.primaryOpportunity !== 'NO_WEBSITE') return false;
    if (activeFilter === 'SOCIAL_ONLY' && lead.primaryOpportunity !== 'SOCIAL_ONLY') return false;
    if (
      activeFilter === 'BROKEN_OR_INSECURE' &&
      lead.primaryOpportunity !== 'BROKEN_WEB' &&
      lead.primaryOpportunity !== 'NO_SSL' &&
      !(lead.audit && lead.audit.urlType === 'CUSTOM_DOMAIN' && (!lead.audit.reachable || !lead.audit.hasValidSsl))
    ) {
      return false;
    }
    if (
      activeFilter === 'GENERIC_EMAIL' &&
      lead.primaryOpportunity !== 'GENERIC_EMAIL' &&
      !(lead.audit?.genericEmails && lead.audit.genericEmails.length > 0)
    ) {
      return false;
    }
    if (activeFilter === 'WHATSAPP_MOBILE' && !lead.isWhatsappMobile) return false;

    // Filtro por Estado CRM
    if (crmFilter !== 'ALL' && (lead.crmStatus || 'nuevo') !== crmFilter) return false;

    // Filtro por texto
    if (search) {
      const haystack = [
        lead.name,
        lead.category,
        lead.city,
        lead.address,
        lead.phone,
        lead.website,
        lead.primaryLabel,
        ...(lead.audit?.allEmails || [])
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'reviews_desc') return (b.reviewsCount || 0) - (a.reviewsCount || 0);
    if (sortBy === 'recent') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    return (b.score || 0) - (a.score || 0);
  });

  return filtered;
}

function renderTable() {
  renderStats();
  const list = getFilteredLeads();
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

      return `
        <tr data-id="${escapeHtml(lead.id)}">
          <td>
            <div class="score-pill ${escapeHtml(lead.priority || 'MEDIA')}">
              <span class="num">${lead.score || 0}</span>
              <span class="lbl">${escapeHtml(lead.priority || 'MEDIA')}</span>
            </div>
          </td>
          <td>
            <div class="biz-title">${escapeHtml(lead.name)}</div>
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
          </td>
          <td style="text-align:right;">
            <div class="action-group">
              <button type="button" class="btn btn-whatsapp btn-sm" data-action="open-pitch" data-id="${escapeHtml(lead.id)}">
                💬 Pitch / WhatsApp
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

//Abrir modal de Pitch & Auditoría
function openPitchModal(leadId) {
  const lead = allLeads.find((l) => l.id === leadId);
  if (!lead) return;
  currentModalLead = lead;

  els.modalLeadName.textContent = lead.name;
  els.modalLeadCategory.textContent = `${lead.category || 'Empresa'} · ${lead.city || 'Colombia'} · Score ${lead.score}/100`;

  const audit = lead.audit || {};
  els.modalAuditGrid.innerHTML = `
    <div class="audit-item">
      <span class="k">Diagnóstico Principal</span>
      <span class="v">${escapeHtml(lead.primaryLabel)}</span>
    </div>
    <div class="audit-item">
      <span class="k">Plan IVIA Sugerido</span>
      <span class="v">${escapeHtml(lead.recommendedPlan)}</span>
    </div>
    <div class="audit-item">
      <span class="k">Teléfono / WhatsApp</span>
      <span class="v">${escapeHtml(lead.phone || 'No registrado')} ${lead.isWhatsappMobile ? '(Móvil)' : ''}</span>
    </div>
    <div class="audit-item">
      <span class="k">Estado Web &amp; SSL</span>
      <span class="v">${
        audit.urlType === 'NO_WEBSITE'
          ? 'Sin Sitio Web'
          : audit.urlType === 'SOCIAL_ONLY'
          ? `Solo ${audit.hostname}`
          : audit.reachable
          ? `${audit.hasValidSsl ? 'HTTPS Seguro' : '⚠️ Sin SSL'} (${audit.loadTimeMs}ms)`
          : `Caído (${audit.error || 'Error'})`
      }</span>
    </div>
    <div class="audit-item">
      <span class="k">Servidor de Correo (MX)</span>
      <span class="v">${escapeHtml(audit.mxProvider || 'Sin dominio propio')}</span>
    </div>
    <div class="audit-item">
      <span class="k">Correos Encontrados</span>
      <span class="v">${escapeHtml((audit.allEmails || []).join(', ') || 'Ninguno visible')}</span>
    </div>
  `;

  document.querySelectorAll('.pitch-tab').forEach((b) => b.classList.remove('active'));
  document.querySelector('.pitch-tab[data-pitch-type="direct"]').classList.add('active');

  els.modalPitchTextarea.value =
    lead.customPitch || lead.pitches?.whatsappDirect || '';
  els.modalNotesInput.value = lead.notes || '';
  els.modalCrmSelect.value = lead.crmStatus || 'nuevo';

  updateModalWhatsappHref();
  els.pitchModal.classList.remove('hidden');
}

function updateModalWhatsappHref() {
  if (!currentModalLead) return;
  const text = els.modalPitchTextarea.value || '';
  const phone = currentModalLead.phoneE164 || '';
  if (phone) {
    els.btnSendWhatsappModal.href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    els.btnSendWhatsappModal.classList.remove('hidden');
  } else {
    // Permite abrir WhatsApp Web para elegir contacto si no tiene móvil
    els.btnSendWhatsappModal.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
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
    renderStats();
  }
});

els.leadsTbody.addEventListener('click', async (e) => {
  const pitchBtn = e.target.closest('button[data-action="open-pitch"]');
  if (pitchBtn) {
    openPitchModal(pitchBtn.dataset.id);
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

// Eventos del Modal de Pitch
document.querySelectorAll('.pitch-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (!currentModalLead) return;
    document.querySelectorAll('.pitch-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const type = tab.dataset.pitchType;
    els.modalPitchTextarea.value =
      type === 'automation'
        ? currentModalLead.pitches?.whatsappAutomation || ''
        : currentModalLead.pitches?.whatsappDirect || '';
    updateModalWhatsappHref();
  });
});

els.modalPitchTextarea.addEventListener('input', updateModalWhatsappHref);

els.btnCopyPitch.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.modalPitchTextarea.value);
  const prev = els.btnCopyPitch.textContent;
  els.btnCopyPitch.textContent = '✅ ¡Copiado!';
  setTimeout(() => {
    els.btnCopyPitch.textContent = prev;
  }, 1500);
});

els.btnSaveLeadModal.addEventListener('click', async () => {
  if (!currentModalLead) return;
  const res = await fetch(`/api/leads/${currentModalLead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notes: els.modalNotesInput.value,
      crmStatus: els.modalCrmSelect.value,
      customPitch: els.modalPitchTextarea.value
    })
  });
  if (res.ok) {
    const { lead } = await res.json();
    const idx = allLeads.findIndex((l) => l.id === lead.id);
    if (idx >= 0) allLeads[idx] = lead;
    renderTable();
    els.pitchModal.classList.add('hidden');
  }
});

els.btnSendWhatsappModal.addEventListener('click', async () => {
  if (!currentModalLead) return;
  const res = await fetch(`/api/leads/${currentModalLead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      crmStatus: 'contactado',
      notes: els.modalNotesInput.value,
      customPitch: els.modalPitchTextarea.value,
      lastContactedAt: new Date().toISOString()
    })
  });
  if (res.ok) {
    const { lead } = await res.json();
    const idx = allLeads.findIndex((l) => l.id === lead.id);
    if (idx >= 0) allLeads[idx] = lead;
    renderTable();
  }
});

els.btnCloseModal.addEventListener('click', () => {
  els.pitchModal.classList.add('hidden');
});

// Modal de Auditoría Individual
els.btnOpenSingle.addEventListener('click', () => {
  els.singleModal.classList.remove('hidden');
});

els.btnCloseSingle.addEventListener('click', () => {
  els.singleModal.classList.add('hidden');
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
