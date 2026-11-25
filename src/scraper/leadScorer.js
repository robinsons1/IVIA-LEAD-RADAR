const { normalizeColombianPhone } = require('../storage/db');

const UPPER_ACRONYMS = new Set([
  'IN',
  'HC',
  'SJ',
  'DGR',
  'JLC',
  'SST',
  'ACDS',
  'IPS',
  'EPS',
  'POS',
  'CRM',
  'IVIA',
  'IT',
  'TV',
  '3D',
  'VIP',
  'B2B',
  'PYME',
  'PYMES'
]);

const TITLE_CASE_OVERRIDES = {
  DR: 'Dr.',
  'DR.': 'Dr.',
  DRA: 'Dra.',
  'DRA.': 'Dra.'
};

const LOWER_CONNECTORS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'e',
  'en',
  'para',
  'por',
  'con',
  'a',
  'o',
  'el',
  'al'
]);

function capitalizeSegment(seg, isFirstWord) {
  if (!seg) return seg;
  const upper = seg.toUpperCase();
  if (TITLE_CASE_OVERRIDES[upper]) return TITLE_CASE_OVERRIDES[upper];
  if (seg.includes('&') && seg.length <= 6) return upper;
  if (UPPER_ACRONYMS.has(upper.replace(/[.,]/g, ''))) return upper;
  const lower = seg.toLowerCase();
  if (!isFirstWord && LOWER_CONNECTORS.has(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Limpia nombres largos de Google Maps (sufijos legales, pipes, subtítulos SEO y MAYÚSCULAS)
 */
function cleanBusinessName(rawName) {
  let name = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!name) return 'su negocio';

  const legalSuffixRe = /\s+(?:m[aá]s\s+)?(?:s\.?\s*a\.?\s*s\.?|ltda\.?|s\.?\s*a\.?|e\.?\s*u\.?|s\.?\s*c\.?\s*a\.?)\.?$/i;
  name = name.replace(legalSuffixRe, '').trim();

  if (name.includes('|')) {
    const parts = name
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      name = parts[0].length >= 5 ? parts[0] : parts.slice(0, 2).join(' ');
    }
  }

  if (name.length > 36 && name.includes(' - ')) {
    const first = name.split(' - ')[0].trim();
    if (first.length >= 8) name = first;
  }

  if (name.length > 38 && name.includes(', ')) {
    const first = name.split(', ')[0].trim();
    if (first.length >= 10) name = first;
  }

  if (name.length > 36 && name.includes(': ')) {
    const first = name.split(': ')[0].trim();
    if (first.length >= 8) name = first;
  }

  name = name
    .replace(legalSuffixRe, '')
    .replace(/[.,\-:\s]+$/, '')
    .trim();

  const isAllUpper = !/[a-zñáéíóú]/.test(name) && name.length > 5;
  const isAllLower = !/[A-ZÑÁÉÍÓÚ]/.test(name) && name.length > 5;

  if (isAllUpper || isAllLower) {
    name = name
      .split(/\s+/)
      .map((word, idx) => {
        if (word.includes('-')) {
          return word
            .split('-')
            .map((part, subIdx) => capitalizeSegment(part, idx === 0 && subIdx === 0))
            .join('-');
        }
        return capitalizeSegment(word, idx === 0);
      })
      .join(' ');
  }

  return name || 'su negocio';
}

function cleanZone(city) {
  const raw = String(city || '').trim();
  if (!raw) return 'Bogotá';
  const first = raw.split(',')[0].trim();
  return first || 'Bogotá';
}

function getGreetingByHour(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'buenos días';
  if (hour >= 12 && hour < 19) return 'buenas tardes';
  return 'buenas noches';
}

function formatPlatformLabel(hostname = '') {
  const h = String(hostname || '').toLowerCase();
  if (h.includes('wa.me') || h.includes('whatsapp')) return 'WhatsApp';
  if (h.includes('instagram')) return 'Instagram';
  if (h.includes('facebook') || h.includes('fb.')) return 'Facebook';
  if (h.includes('linktr.ee')) return 'Linktree';
  if (h.includes('webnode')) return 'Webnode';
  if (h.includes('wixsite')) return 'Wix';
  if (h.includes('amawebs')) return 'Amawebs';
  if (h.includes('blogspot')) return 'Blogger';
  if (h.includes('wordpress.com')) return 'WordPress gratuito';
  if (h.includes('sites.google')) return 'Google Sites';
  if (h.includes('canva.site')) return 'Canva';
  return h || 'un enlace externo';
}

function getGenericEmailProviderLabel(email = '') {
  const domain = String(email || '').split('@')[1] || '';
  if (domain.includes('gmail')) return 'Gmail';
  if (domain.includes('hotmail') || domain.includes('outlook') || domain.includes('live')) {
    return 'Hotmail/Outlook';
  }
  if (domain.includes('yahoo')) return 'Yahoo';
  return 'correo gratuito';
}

/**
 * Construye la cadencia de 4 toques (0-3-7-15) + 5 respuestas rápidas + correo humano
 */
function buildColdOutreachTemplates(rawLead, audit, scoredContext) {
  const cleanName = cleanBusinessName(rawLead.name);
  const zone = cleanZone(rawLead.city);
  const greeting = getGreetingByHour();
  const reviewsCount = Number(rawLead.reviewsCount) || 0;
  const rating = Number(rawLead.rating) || 0;
  const hasStrongReviews = reviewsCount >= 8 && rating >= 4.0;
  const domain = audit?.hostname || rawLead.website || 'su página web';
  const opp = scoredContext.primaryOpportunity;

  let stage1 = '';
  let findingShort = 'mejorar su presencia web';
  let emailSubject = `Consulta rápida sobre ${cleanName}`;

  if (opp === 'BROKEN_WEB') {
    findingShort = 'corregir el enlace caído en Google';
    emailSubject = `Aviso: el enlace web de ${cleanName} aparece caído en Google`;
    stage1 =
      `Hola, ${greeting}. Estaba revisando el perfil de ${cleanName} en Google Maps aquí en ${zone} ` +
      `y noté que el enlace a su página (${domain}) aparece caído y no les carga a los clientes.\n\n` +
      `¿Ustedes administran el sitio internamente o tienen a alguien técnico a quien avisarle?`;
  } else if (opp === 'NO_WEBSITE') {
    findingShort = 'montar su página web propia';
    emailSubject = `Consulta sobre la ficha de ${cleanName} en Google Maps`;
    const proof = hasStrongReviews
      ? `tienen muy buenas calificaciones (${reviewsCount} reseñas)`
      : 'tienen muy buenas referencias';
    stage1 =
      `Hola, ${greeting}. Vi el perfil de ${cleanName} en Google Maps aquí en ${zone}; ${proof}, ` +
      `pero noté que aún no tienen página web enlazada.\n\n` +
      `¿Actualmente manejan todo por WhatsApp y referidos o tienen pensado montar su web?`;
  } else if (opp === 'SOCIAL_ONLY') {
    const channel = formatPlatformLabel(audit?.hostname);
    findingShort = 'tener su página web propia';
    emailSubject = `Consulta sobre el enlace de ${cleanName} en Google Maps`;
    const proof = hasStrongReviews ? ` (vi sus ${reviewsCount} reseñas en ${zone})` : ` en ${zone}`;
    stage1 =
      `Hola, ${greeting}. Estaba viendo el perfil de ${cleanName} en Google Maps${proof}. ` +
      `Noté que el enlace web dirige solo a ${channel} en lugar de una página propia.\n\n` +
      `¿Lo manejan así por elección propia o es algo que tienen pendiente?`;
  } else if (opp === 'FREE_BUILDER') {
    const platform = formatPlatformLabel(audit?.hostname);
    findingShort = 'pasar su web a dominio propio (.com)';
    emailSubject = `Consulta sobre la web de ${cleanName}`;
    stage1 =
      `Hola, ${greeting}. Vi el perfil de ${cleanName} en Google aquí en ${zone}. ` +
      `Tienen muy buenas referencias, pero noté que su página sigue en un enlace gratuito (${platform}) y sin correo corporativo.\n\n` +
      `¿Han pensado en pasarla a dominio propio (.com) o por ahora la mantienen así?`;
  } else if (opp === 'NO_SSL') {
    findingShort = 'activar el certificado de seguridad (SSL)';
    emailSubject = `Aviso: la web de ${cleanName} muestra alerta de "Sitio no seguro"`;
    stage1 =
      `Hola, ${greeting}. Entré a la página de ${cleanName} (${domain}) desde Google Maps ` +
      `y noté que el navegador muestra una alerta de "Sitio no seguro" al abrirla.\n\n` +
      `¿Ustedes manejan el mantenimiento de la página o tienen proveedor externo para revisarlo?`;
  } else if (opp === 'GENERIC_EMAIL') {
    const genEmail = audit?.genericEmails?.[0] || '';
    const provider = getGenericEmailProviderLabel(genEmail);
    findingShort = `configurar correo corporativo (@${domain})`;
    emailSubject = `Consulta rápida sobre el correo de ${cleanName}`;
    stage1 =
      `Hola, ${greeting}. Estuve viendo la página de ${cleanName} desde Google Maps. ` +
      `Se ve muy bien, solo noté que usan un correo de ${provider} en lugar de uno con su propio dominio (@${domain}).\n\n` +
      `¿No lo han configurado todavía o prefieren manejarlo así?`;
  } else if (opp === 'SUBOPTIMAL_WEB') {
    const missingItems = [];
    if (!audit?.hasWhatsappWidget) missingItems.push('botón directo a WhatsApp');
    if (!audit?.hasMobileViewport) missingItems.push('adaptación a celular');
    const detail = missingItems.length > 0 ? missingItems.join(' ni ') : 'contacto rápido por WhatsApp';
    findingShort = `agregar ${detail} en su web`;
    emailSubject = `Detalle rápido en la web de ${cleanName}`;
    stage1 =
      `Hola, ${greeting}. Estaba viendo la página de ${cleanName} (${domain}) desde Google Maps en ${zone}. ` +
      `Se ve bien, pero noté que no tiene ${detail} visible para quienes entran desde el celular.\n\n` +
      `¿Ustedes mismos administran la web o alguien externo les hace esos ajustes?`;
  } else {
    findingShort = 'automatizar citas o cotizaciones';
    emailSubject = `Consulta rápida para ${cleanName}`;
    stage1 =
      `Hola, ${greeting}. Vi el perfil de ${cleanName} en Google Maps aquí en ${zone}; ` +
      `tienen muy buena presencia digital.\n\n` +
      `Por curiosidad, ¿hoy agendan citas y envían cotizaciones de forma manual por WhatsApp o ya lo tienen automatizado?`;
  }

  let stage2 = '';
  if (opp === 'BROKEN_WEB' || opp === 'NO_SSL') {
    stage2 =
      `Hola de nuevo, ${greeting}. Te dejo el pantallazo de lo que sale al intentar abrir el enlace de ${cleanName} desde Google, ` +
      `por si el mensaje anterior quedó abajo en el chat.`;
  } else {
    stage2 =
      `Hola, ${greeting}. Te escribo rápido por si el mensaje de hace unos días quedó enterrado. ` +
      `¿Al final sí tienen en el radar ${findingShort} este mes o por ahora siguen como están?`;
  }

  const stage3 =
    `Hola, ${greeting}. Soy Robin, manejo soluciones web para negocios aquí en Bogotá (IVIA). ` +
    `Como vi que ${cleanName} tiene buena reputación en Google pero le falta ${findingShort}, ` +
    `si les sirve les puedo armar una vista previa rápida sin costo — trabajamos con cero anticipos y solo pagan si les gusta funcionando. ¿Les gustaría verla?`;

  const stage4 =
    `Hola, ${greeting}. Para no ser intenso, dejo el tema hasta aquí. ` +
    `Si más adelante necesitan ayuda con la página web o correos corporativos de ${cleanName}, me escriben por este mismo número con toda confianza. ¡Muchos éxitos con el negocio!`;

  const replies = {
    gracias:
      `Con gusto. Sí, justo a eso nos dedicamos aquí en Bogotá (IVIA). ` +
      `Si quieres reviso en 5 minutos si el problema es de servidor o vencimiento del dominio y te digo exactamente qué pasa, sin costo. ` +
      `¿Prefieres que te cuente por aquí o te llamo 2 minutos mañana?`,
    quien:
      `¡Hola! Soy Robin, de IVIA (Ingversia) aquí en Bogotá. Estaba revisando negocios del sector en Google Maps y vi el caso puntual de ${cleanName}. ` +
      `No quería mandar publicidad larga sin preguntar: nosotros montamos y administramos páginas web y correos corporativos para negocios locales sin cobrar anticipos ` +
      `(primero ves tu sitio en línea y solo pagas si lo apruebas). ¿Te interesaría ver una propuesta rápida para ${cleanName}?`,
    precio:
      `Para darte el número claro de una vez: manejamos planes llave en mano sin cobro de creación ni anticipos ` +
      `(incluye diseño, dominio .com, hosting, SSL, botón de WhatsApp y soporte mensual).\n` +
      `- Plan Básico: $89.000/mes (sitio web profesional optimizado para celular).\n` +
      `- Plan Estándar: $149.000/mes (web más completa + correos corporativos @tunegocio.com).\n` +
      `- En Plan Anual quedan 2 meses gratis ($890.000 o $1.490.000/año).\n\n` +
      `Lo mejor es que no pagas nada al inicio: la montamos en 7 días, la revisas en vivo y solo pagas si la apruebas. ¿Necesitarían también correos corporativos o solo la página?`,
    info:
      `Claro que sí, en resumen te entregamos en 7 días:\n` +
      `• Página web rápida adaptada a celular con botón directo a WhatsApp\n` +
      `• Dominio propio (.com) y certificado de seguridad SSL\n` +
      `• Correos corporativos (@tunegocio.com) y soporte mensual incluido\n` +
      `• Cero anticipos: solo pagas cuando ves el sitio funcionando y lo apruebas (desde $89.000/mes).\n\n` +
      `Puedes ver nuestro trabajo en https://ivia.ingversia.com. Si quieres, esta semana te armo un borrador visual para ${cleanName} sin compromiso. ¿Te parece?`,
    noAhora:
      `Súper válido, si hoy les funciona bien así está perfecto. ` +
      `Si en algún momento quieren evaluar cómo se vería su página para captar clientes que buscan en Google, aquí queda mi contacto sin compromiso. ¡Un saludo!`
  };

  return {
    cleanName,
    pitches: {
      whatsappDirect: stage1,
      whatsappAutomation: stage3,
      cadence: {
        stage1,
        stage2,
        stage3,
        stage4
      },
      replies,
      emailSubject,
      emailBody: `${stage1}\n\nQuedo atento.\nRobin · IVIA (Ingversia)`
    }
  };
}

/**
 * Califica el prospecto (0 - 100) según el modelo comercial de IVIA (ivia.ingversia.com)
 * y genera los mensajes de contacto personalizados para WhatsApp y Correo.
 */
function scoreAndBuildPitch(rawLead, audit) {
  let score = 0;
  const painTags = [];
  const opportunities = [];

  const phoneInfo = normalizeColombianPhone(rawLead.phone || '');
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

  // 1. Evaluar Dolor Digital Principal (BROKEN_WEB antes que FREE_BUILDER si está caída)
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
  } else if (audit.urlType !== 'INVALID_URL' && !audit.reachable) {
    score += 50;
    primaryOpportunity = 'BROKEN_WEB';
    primaryLabel = 'Sitio Web Caído / Error';
    recommendedPlan = 'Rescate Web Urgente — Plan Estándar ($149.000/mes)';
    painTags.push(`Web Caída (${audit.error || 'Error'})`);
    if (audit.urlType === 'FREE_BUILDER') {
      painTags.push('Subdominio Gratuito Caído');
    }
    opportunities.push('Su enlace en Google Maps está roto o vencido: pérdida directa de clientes');
  } else if (audit.urlType === 'FREE_BUILDER') {
    score += 38;
    primaryOpportunity = 'FREE_BUILDER';
    primaryLabel = `Web Gratuita (${audit.hostname})`;
    recommendedPlan = 'Plan Básico ($89.000/mes) o Estándar ($149.000/mes)';
    painTags.push('Dominio Gratuito');
    opportunities.push('Migrar de plataforma gratuita a dominio corporativo propio con SSL');
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

    const hasCorporateEmail = (audit.corporateEmails || []).length > 0;
    const hasGenericEmail = (audit.genericEmails || []).length > 0;

    if (hasGenericEmail && !hasCorporateEmail) {
      if (!audit.hasMxRecords) {
        score += 24;
        if (primaryOpportunity === 'OPTIMIZED_OR_AUTOMATION') {
          primaryOpportunity = 'GENERIC_EMAIL';
          primaryLabel = 'Usa Correo @gmail/@hotmail';
          recommendedPlan = 'Correo Corporativo Blindado + Administración Web';
        }
        painTags.push(`Solo usa ${audit.genericEmails[0]}`);
      } else {
        score += 12;
        if (primaryOpportunity === 'OPTIMIZED_OR_AUTOMATION') {
          primaryOpportunity = 'GENERIC_EMAIL';
          primaryLabel = 'Publica Correo Genérico';
          recommendedPlan = 'Correo Corporativo Blindado + Administración Web';
        }
        painTags.push(`Publica ${audit.genericEmails[0]}`);
      }
      opportunities.push('Reemplazar correo genérico por buzones corporativos (@suempresa.com)');
    } else if (!hasGenericEmail && !audit.hasMxRecords) {
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

  const isLargeEnterprise =
    reviewsCount >= 350 &&
    audit?.urlType === 'CUSTOM_DOMAIN' &&
    audit?.reachable &&
    audit?.hasValidSsl;

  if (isLargeEnterprise) {
    score -= 35;
    painTags.push('Empresa Grande (+350 reseñas)');
  } else if (rating > 0 && rating < 3.5) {
    painTags.push('Baja calificación');
  } else if (reviewsCount >= 15 && rating >= 4.0) {
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

  // 3. Construir Mensajes Personalizados Humanos (Cadencia 0-3-7-15 + Respuestas + Email)
  const { cleanName, pitches } = buildColdOutreachTemplates(rawLead, audit, {
    primaryOpportunity,
    primaryLabel,
    recommendedPlan
  });

  const whatsappUrl = bestWhatsappE164
    ? `https://wa.me/${bestWhatsappE164}?text=${encodeURIComponent(pitches.whatsappDirect)}`
    : '';

  return {
    cleanName,
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
    pitches
  };
}

module.exports = {
  scoreAndBuildPitch,
  cleanBusinessName,
  cleanZone,
  getGreetingByHour,
  buildColdOutreachTemplates
};
