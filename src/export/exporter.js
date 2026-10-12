const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { OUTPUT_DIR, ensureDirs } = require('../storage/db');

function escapeCsvField(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/\r?\n/g, ' ');
  if (str.includes(',') || str.includes('"') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exporta los prospectos a CSV con BOM UTF-8 (compatible con Excel en español)
 */
function exportLeadsToCsv(leads, customFilename = null) {
  ensureDirs();
  const filename =
    customFilename ||
    `prospectos_ivia_${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = path.join(OUTPUT_DIR, filename);

  const headers = [
    'Score IVIA',
    'Prioridad',
    'Estado CRM',
    'Nombre del Negocio',
    'Categoría',
    'Diagnóstico Principal',
    'Plan IVIA Sugerido',
    'Teléfono',
    '¿Es WhatsApp Móvil?',
    'Link WhatsApp Directo',
    'Correos Detectados',
    'Correos Genéricos (@gmail/hotmail)',
    'Sitio Web Actual',
    '¿Tiene SSL?',
    'Servidor Correo (MX)',
    'Rating Maps',
    'Nº Reseñas',
    'Ciudad / Zona',
    'Dirección',
    'Dolores Detectados',
    'Notas CRM',
    'Mensaje WhatsApp Sugerido',
    'Link Google Maps'
  ];

  const rows = leads.map((l) => [
    l.score || 0,
    l.priority || 'MEDIA',
    (l.crmStatus || 'nuevo').toUpperCase(),
    l.name || '',
    l.category || '',
    l.primaryLabel || '',
    l.recommendedPlan || '',
    l.phone || '',
    l.isWhatsappMobile ? 'SÍ (Celular)' : 'NO',
    l.whatsappUrl || '',
    (l.audit?.allEmails || []).join(' | '),
    (l.audit?.genericEmails || []).join(' | '),
    l.audit?.normalizedUrl || l.website || 'SIN WEB',
    l.audit?.urlType === 'CUSTOM_DOMAIN' ? (l.audit?.hasValidSsl ? 'SÍ' : 'NO (Inseguro)') : 'N/A',
    l.audit?.mxProvider || 'N/A',
    l.rating || 0,
    l.reviewsCount || 0,
    l.city || '',
    l.address || '',
    (l.painTags || []).join(', '),
    l.notes || '',
    l.customPitch || l.pitches?.whatsappDirect || '',
    l.mapsUrl || ''
  ]);

  const csvLines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(escapeCsvField).join(','))
  ];

  // \uFEFF = UTF-8 BOM para que Excel en Windows lea tildes y ñ perfectamente
  fs.writeFileSync(filePath, '\uFEFF' + csvLines.join('\r\n'), 'utf8');
  return filePath;
}

/**
 * Exporta los prospectos a un libro Excel (.xlsx) profesional con colores, filtros e hipervínculos
 */
async function exportLeadsToExcel(leads, customFilename = null) {
  ensureDirs();
  const filename =
    customFilename ||
    `prospectos_ivia_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const filePath = path.join(OUTPUT_DIR, filename);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IVIA Lead Radar by Ingversia';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Prospectos IVIA', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  sheet.columns = [
    { header: 'Score', key: 'score', width: 10 },
    { header: 'Prioridad', key: 'priority', width: 12 },
    { header: 'Estado CRM', key: 'crmStatus', width: 14 },
    { header: 'Negocio', key: 'name', width: 32 },
    { header: 'Categoría', key: 'category', width: 22 },
    { header: 'Diagnóstico Digital', key: 'primaryLabel', width: 26 },
    { header: 'Plan IVIA Recomendado', key: 'recommendedPlan', width: 38 },
    { header: 'Teléfono', key: 'phone', width: 18 },
    { header: 'WhatsApp Móvil', key: 'isWhatsappMobile', width: 16 },
    { header: 'Contactar 1-Clic', key: 'whatsappLink', width: 20 },
    { header: 'Correos Detectados', key: 'emails', width: 30 },
    { header: 'Sitio Web Actual', key: 'website', width: 30 },
    { header: 'SSL Seguro', key: 'ssl', width: 14 },
    { header: 'Correo MX', key: 'mx', width: 24 },
    { header: 'Rating', key: 'rating', width: 10 },
    { header: 'Reseñas', key: 'reviewsCount', width: 11 },
    { header: 'Ciudad / Zona', key: 'city', width: 20 },
    { header: 'Dirección', key: 'address', width: 32 },
    { header: 'Hallazgos Clave', key: 'painTags', width: 38 },
    { header: 'Notas CRM', key: 'notes', width: 28 },
    { header: 'Mensaje Sugerido WhatsApp', key: 'pitch', width: 55 }
  ];

  // Estilo de cabecera azul ejecutivo IVIA
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' }
    };
    cell.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  for (const lead of leads) {
    const row = sheet.addRow({
      score: lead.score || 0,
      priority: lead.priority || 'MEDIA',
      crmStatus: (lead.crmStatus || 'nuevo').toUpperCase(),
      name: lead.name || '',
      category: lead.category || '',
      primaryLabel: lead.primaryLabel || '',
      recommendedPlan: lead.recommendedPlan || '',
      phone: lead.phone || '',
      isWhatsappMobile: lead.isWhatsappMobile ? 'SÍ (Móvil)' : 'No / Fijo',
      whatsappLink: lead.whatsappUrl
        ? { text: 'Abrir WhatsApp →', hyperlink: lead.whatsappUrl }
        : 'Sin móvil',
      emails: (lead.audit?.allEmails || []).join(', '),
      website: lead.audit?.normalizedUrl || lead.website || 'SIN SITIO WEB',
      ssl:
        lead.audit?.urlType === 'CUSTOM_DOMAIN'
          ? lead.audit?.hasValidSsl
            ? 'SÍ (HTTPS)'
            : 'NO (Inseguro)'
          : 'N/A',
      mx: lead.audit?.mxProvider || 'N/A',
      rating: lead.rating || 0,
      reviewsCount: lead.reviewsCount || 0,
      city: lead.city || '',
      address: lead.address || '',
      painTags: (lead.painTags || []).join(' · '),
      notes: lead.notes || '',
      pitch: lead.customPitch || lead.pitches?.whatsappDirect || ''
    });

    row.height = 22;
    row.alignment = { vertical: 'middle', wrapText: false };

    // Colorear prioridad
    const prioCell = row.getCell('priority');
    if (lead.priority === 'ALTA') {
      prioCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEE2E2' }
      };
      prioCell.font = { bold: true, color: { argb: 'FFB91C1C' } };
    } else if (lead.priority === 'MEDIA') {
      prioCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' }
      };
      prioCell.font = { bold: true, color: { argb: 'FFB45309' } };
    }

    if (lead.whatsappUrl) {
      const waCell = row.getCell('whatsappLink');
      waCell.font = { color: { argb: 'FF15803D' }, bold: true, underline: true };
    }
  }

  sheet.autoFilter = {
    from: 'A1',
    to: 'U1'
  };

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = {
  exportLeadsToCsv,
  exportLeadsToExcel
};
