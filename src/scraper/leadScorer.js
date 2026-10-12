const { normalizeColombianPhone } = require('../storage/db');

/**
 * Califica el prospecto (0 - 100) según el modelo comercial de IVIA (ivia.ingversia.com)
 * y genera los mensajes de contacto personalizados para WhatsApp y Correo.
 */
function scoreAndBuildPitch(rawLead, audit) {
  let score = 0;
  const painTags = [];
  const opportunities = [];

  const phoneInfo = normalizeColombianPhone(rawLead.phone || '');
  // Si en la web encontramos un número de WhatsApp y en Maps había un fijo o nada, usamos el de la web
  const webWaInfo = audit?.whatsappWebNumber
    ? normalizeColombianPhone(audit.whatsappWebNumber)
    : { isWhatsappMobile: false, e164: '' };

  const bestWhatsappE164 = phoneInfo.isWhatsappMobile
    ? phoneInfo.e164
    : webWaInfo.isWhatsappMobile
    ? webWaInfo.e164
    : phoneInfo.e164;

  const hasWhatsappMobile = phoneInfo.isWhatsappMobile || webWaInfo.isWhatsappMobile;

  let primaryOpportunity = 'OPTIMIZED_OR_AUTOMATION';
  let primaryLabel = 'Automatización / Sistemas a Medida';
  let recommendedPlan = 'Sistemas a la Medida / Automatización IVIA';

  // 1. Evaluar Dolor Digital Principal
  if (!audit || audit.urlType === 'NO_WEBSITE') {
    score += 48;
    primaryOpportunity = 'NO_WEBSITE';
    primaryLabel = 'Sin Página Web';
    recommendedPlan = 'Plan Básico ($89.000/mes) o Estándar ($149.000/mes)';
    painTags.push('Sin Sitio Web');
    painTags.push('Sin Dominio Propio');
    opportunities.push('Crear sitio web profesional + dominio .com + correo corporativo');
  } else if (audit.urlType === 'SOCIAL_ONLY') {
    score += 42;
    primaryOpportunity = 'SOCIAL_ONLY';
    primaryLabel = `Solo Redes (${audit.hostname})`;
    recommendedPlan = 'Plan Estándar ($149.000/mes) · Web + Dominio + 3 Correos';
    painTags.push(`Solo usa ${audit.hostname}`);
    painTags.push('Sin Dominio Corporativo');
    opportunities.push('Pasar de depender solo de redes sociales a tener portal oficial en Google');
  } else if (audit.urlType === 'FREE_BUILDER') {
    score += 38;
    primaryOpportunity = 'FREE_BUILDER';
    primaryLabel = `Web Gratuita (${audit.hostname})`;
    recommendedPlan = 'Plan Básico ($89.000/mes) o Estándar ($149.000/mes)';
    painTags.push('Dominio Gratuito');
    opportunities.push('Migrar de plataforma gratuita a dominio corporativo propio con SSL');
  } else if (!audit.reachable) {
    score += 50;
    primaryOpportunity = 'BROKEN_WEB';
    primaryLabel = 'Sitio Web Caído / Error';
    recommendedPlan = 'Rescate Web Urgente — Plan Estándar ($149.000/mes)';
    painTags.push(`Web Caída (${audit.error || 'Error'})`);
    opportunities.push('Su enlace en Google Maps está roto o vencido: pérdida directa de clientes');
  } else {
    // Tiene dominio propio y carga: revisamos vulnerabilidades y brechas
    if (!audit.hasValidSsl) {
      score += 36;
      primaryOpportunity = 'NO_SSL';
      primaryLabel = 'Sitio Inseguro (Sin SSL)';
      recommendedPlan = 'Plan Estándar ($149.000/mes) con Blindaje SSL Cloudflare';
      painTags.push('Sin Certificado SSL (No Seguro)');
      opportunities.push('El navegador alerta "Sitio No Seguro" a sus visitantes');
    }

    if (audit.genericEmails && audit.genericEmails.length > 0) {
      score += 22;
      if (primaryOpportunity === 'OPTIMIZED_OR_AUTOMATION') {
        primaryOpportunity = 'GENERIC_EMAIL';
        primaryLabel = 'Usa Correo @gmail/@hotmail';
        recommendedPlan = 'Correo Corporativo Blindado + Administración Web';
      }
      painTags.push(`Usa ${audit.genericEmails[0]}`);
      opportunities.push('Reemplazar correo genérico por buzones corporativos (@suempresa.com)');
    } else if (!audit.hasMxRecords) {
      score += 14;
      painTags.push('Sin Servidor de Correo (MX)');
      opportunities.push('Configurar buzones de correo empresarial con SPF/DKIM');
    }

    if (!audit.hasWhatsappWidget) {
      score += 15;
      if (primaryOpportunity === 'OPTIMIZED_OR_AUTOMATION') {
        primaryOpportunity = 'SUBOPTIMAL_WEB';
        primaryLabel = 'Web sin Botón WhatsApp';
        recommendedPlan = 'Rediseño Orientado a Conversión — Plan Estándar ($149.000/mes)';
      }
      painTags.push('Sin Botón de WhatsApp en Web');
      opportunities.push('Integrar embudo de contacto rápido por WhatsApp');
    }

    if (!audit.hasMobileViewport) {
      score += 15;
      if (primaryOpportunity === 'OPTIMIZED_OR_AUTOMATION') {
        primaryOpportunity = 'SUBOPTIMAL_WEB';
        primaryLabel = 'No Adaptable a Celular';
        recommendedPlan = 'Modernización Móvil — Plan Estándar ($149.000/mes)';
      }
      painTags.push('Diseño No Móvil');
      opportunities.push('Optimizar experiencia para celulares');
    }

    if (audit.isSlow) {
      score += 10;
      painTags.push(`Carga Lenta (${(audit.loadTimeMs / 1000).toFixed(1)}s)`);
      opportunities.push('Acelerar carga en servidores NVMe con Cloudflare');
    }
  }

  // 2. Evaluar Tracción Comercial (Capacidad de pago y contactabilidad)
  const rating = Number(rawLead.rating) || 0;
  const reviewsCount = Number(rawLead.reviewsCount) || 0;

  if (hasWhatsappMobile) {
    score += 20;
    painTags.push('WhatsApp Móvil Directo');
  } else if (phoneInfo.clean) {
    score += 8;
    painTags.push('Teléfono Fijo');
  } else {
    score -= 15;
  }

  if (reviewsCount >= 15 && rating >= 4.0) {
    score += 18;
    painTags.push(`Negocio Validado (${rating}★ · ${reviewsCount} reseñas)`);
  } else if (reviewsCount >= 5) {
    score += 12;
  } else if (reviewsCount > 0) {
    score += 6;
  }

  if (audit?.allEmails?.length > 0) {
    score += 6;
  }

  score = Math.max(5, Math.min(99, Math.round(score)));

  let priority = 'BAJA';
  if (score >= 70) priority = 'ALTA';
  else if (score >= 45) priority = 'MEDIA';

  // 3. Construir Mensajes Personalizados de Contacto (WhatsApp + Email)
  const bizName = rawLead.name || 'su empresa';
  const category = rawLead.category || 'su sector';
  const city = rawLead.city || 'Colombia';

  let pitchDirect = '';
  if (primaryOpportunity === 'NO_WEBSITE') {
    pitchDirect =
      `Hola, equipo de *${bizName}* 👋. Los encontré en Google Maps buscando *${category}* en ${city} (vi que tienen muy buenas referencias).\n\n` +
      `Noté que en su ficha de Google aún no tienen enlazada una página web oficial. En *IVIA (by Ingversia)* creamos y administramos sitios web profesionales con dominio propio, correo corporativo y botón directo a WhatsApp desde *$89.000/mes*.\n\n` +
      `Trabajamos con *Cero Anticipos*: diseñamos una propuesta para *${bizName}* y solo pagas cuando apruebas el sitio funcionando. ¿Te gustaría que te envíe un prototipo sin costo por aquí?`;
  } else if (primaryOpportunity === 'SOCIAL_ONLY') {
    pitchDirect =
      `Hola, equipo de *${bizName}* 👋. Vi su perfil en Google Maps e Instagram buscando *${category}* en ${city}.\n\n` +
      `Noté que actualmente dirigen su ficha de Google a redes sociales en lugar de un dominio propio (.com). En *IVIA (by Ingversia)* les armamos su sitio web oficial con catálogo/servicios, correo corporativo (@suempresa.com) y conexión a WhatsApp para captar clientes que buscan en Google.\n\n` +
      `No pedimos anticipos (*pagas únicamente cuando apruebas tu sitio en vivo*). ¿Les gustaría ver una maqueta para *${bizName}* sin compromiso?`;
  } else if (primaryOpportunity === 'BROKEN_WEB') {
    pitchDirect =
      `Hola, equipo de *${bizName}* 👋. Estaba revisando su ficha en Google Maps y noté que el enlace a su página web (${audit?.hostname || 'su sitio'}) actualmente presenta un error y no carga para los clientes.\n\n` +
      `En *IVIA (by Ingversia)* nos encargamos de rescatar y administrar toda su infraestructura web (dominio, hosting NVMe, seguridad SSL y soporte mensual) sin anticipos: *solo pagan cuando el sitio está 100% en línea y aprobado*.\n\n` +
      `¿Con quién podría conversar 2 minutos para ayudarles a restablecerlo?`;
  } else if (primaryOpportunity === 'NO_SSL') {
    pitchDirect =
      `Hola, equipo de *${bizName}* 👋. Visitando su página web (${audit?.hostname}) desde Google Maps, noté que el navegador la marca como *"No Segura" (sin certificado SSL activo)*, lo que puede frenar a clientes potenciales.\n\n` +
      `En *IVIA (by Ingversia)* modernizamos su sitio web con blindaje SSL Cloudflare, correo corporativo y mantenimiento mensual incluido, *sin anticipos (pagas cuando apruebas el resultado)*.\n\n` +
      `¿Te comparto un diagnóstico rápido de cómo dejarlo 100% seguro y optimizado para celular?`;
  } else if (primaryOpportunity === 'GENERIC_EMAIL' || primaryOpportunity === 'FREE_BUILDER') {
    pitchDirect =
      `Hola, equipo de *${bizName}* 👋. Los ubiqué en Google Maps buscando *${category}* en ${city}.\n\n` +
      `Vimos una oportunidad genial para elevar la imagen corporativa de *${bizName}* con un dominio propio, buzones de correo empresariales (*contacto@tuempresa.com* cero spam) y un sitio web ultrarrápido administrado por nosotros.\n\n` +
      `En *IVIA* trabajamos sin anticipos ni cláusulas de permanencia (*pagas solo cuando apruebas tu plataforma*). ¿Te envío información breve por aquí?`;
  } else {
    pitchDirect =
      `Hola, equipo de *${bizName}* 👋. Estuve viendo su presencia en Google Maps en ${city}.\n\n` +
      `En *IVIA (by Ingversia)* desarrollamos herramientas a la medida y automatizaciones para empresas de *${category}* que reducen el tiempo operativo (agendamiento de citas, generación automática de documentos/cotizaciones, inventario y portales de clientes) además de administración web integral.\n\n` +
      `¿Qué proceso manual les está quitando más tiempo hoy en *${bizName}*? Me encantaría mostrarles cómo automatizarlo.`;
  }

  const pitchAutomation =
    `Hola, equipo de *${bizName}* 👋. Soy de *IVIA (by Ingversia)* (https://ivia.ingversia.com).\n\n` +
    `Ayudamos a negocios de *${category}* en ${city} a ahorrar horas operativas cada semana mediante herramientas a la medida (automatización de cotizaciones/documentos, agendamiento de citas por WhatsApp, control de inventario y sitios web administrados).\n\n` +
    `Trabajamos bajo modalidad de *Cero Anticipos (pagas al aprobar)*. ¿Les gustaría agendar una llamada corta de 10 min para evaluar qué tareas repetitivas podemos automatizar en *${bizName}*?`;

  const whatsappUrl = bestWhatsappE164
    ? `https://wa.me/${bestWhatsappE164}?text=${encodeURIComponent(pitchDirect)}`
    : '';

  return {
    score,
    priority,
    primaryOpportunity,
    primaryLabel,
    recommendedPlan,
    painTags,
    opportunities,
    phoneClean: phoneInfo.clean,
    phoneE164: bestWhatsappE164,
    isWhatsappMobile: hasWhatsappMobile,
    phoneType: hasWhatsappMobile ? 'mobile' : phoneInfo.phoneType,
    whatsappUrl,
    pitches: {
      whatsappDirect: pitchDirect,
      whatsappAutomation: pitchAutomation,
      emailSubject: `Diagnóstico de presencia digital y automatización para ${bizName} | IVIA`,
      emailBody: pitchDirect.replace(/\*/g, '')
    }
  };
}

module.exports = {
  scoreAndBuildPitch
};
