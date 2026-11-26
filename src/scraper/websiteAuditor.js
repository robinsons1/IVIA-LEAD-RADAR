const cheerio = require('cheerio');
const dns = require('dns').promises;
const { URL } = require('url');

const SOCIAL_DOMAINS = [
  'instagram.com',
  'facebook.com',
  'fb.com',
  'fb.me',
  'linktr.ee',
  'wa.me',
  'api.whatsapp.com',
  'whatsapp.com',
  'tiktok.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'beacons.ai',
  'bio.link',
  'taplink.cc',
  'wa.link',
  'doctoralia.co',
  'topdoctors.com.co',
  'paginasamarillas.com.co',
  'agendapro.com',
  'fresha.com',
  'rappi.com.co',
  'civico.com'
];

const FREE_BUILDER_DOMAINS = [
  'wixsite.com',
  'blogspot.com',
  'wordpress.com',
  'weebly.com',
  'jimdofree.com',
  'jimdo.com',
  'webnode.es',
  'webnode.com',
  'webnode.com.co',
  'godaddysites.com',
  'sites.google.com',
  'negocio.site',
  'business.site',
  'my.canva.site',
  'carrd.co',
  'amawebs.com',
  'webnode.page',
  'ueniweb.com',
  'strikingly.com',
  'site123.me',
  'mozello.com',
  'sumupstore.com',
  'mitiendanube.com',
  'empretienda.com'
];

const SHORTENER_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  'cutt.ly',
  'rb.gy',
  'shorturl.at',
  't.co',
  'goo.gl'
];

const GENERIC_EMAIL_PROVIDERS = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'outlook.es',
  'hotmail.es',
  'yahoo.com',
  'yahoo.es',
  'live.com',
  'icloud.com',
  'msn.com',
  'aol.com'
];

const IGNORE_EMAIL_PATTERNS = [
  /example\.com/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.webp$/i,
  /\.svg$/i,
  /\.gif$/i,
  /\.css$/i,
  /\.js$/i,
  /sentry\.io/i,
  /wixpress\.com/i,
  /wordpress\.org/i,
  /w3\.org/i,
  /schema\.org/i,
  /tuempresa\.com/i,
  /correo\.com/i,
  /dominio\.com/i,
  /email\.com/i,
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

function classifyWebsiteUrl(rawUrl) {
  if (!rawUrl || !String(rawUrl).trim()) {
    return { type: 'NO_WEBSITE', normalizedUrl: '', hostname: '', rootDomain: '' };
  }

  let urlStr = String(rawUrl).trim();
  // Si es una redirección de Google Maps /url?q=...
  if (urlStr.includes('google.com/url?')) {
    try {
      const parsedGoogle = new URL(urlStr);
      const q = parsedGoogle.searchParams.get('q') || parsedGoogle.searchParams.get('url');
      if (q) urlStr = q;
    } catch (_) {}
  }

  if (!/^https?:\/\//i.test(urlStr)) {
    urlStr = 'https://' + urlStr;
  }

  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    const isSocial = SOCIAL_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith('.' + d)
    );
    if (isSocial) {
      return {
        type: 'SOCIAL_ONLY',
        normalizedUrl: parsed.href,
        hostname,
        rootDomain: hostname
      };
    }

    const isFreeBuilder = FREE_BUILDER_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith('.' + d)
    );
    if (isFreeBuilder) {
      return {
        type: 'FREE_BUILDER',
        normalizedUrl: parsed.href,
        hostname,
        rootDomain: hostname
      };
    }

    return {
      type: 'CUSTOM_DOMAIN',
      normalizedUrl: parsed.href,
      hostname,
      rootDomain: hostname
    };
  } catch (_) {
    return { type: 'INVALID_URL', normalizedUrl: rawUrl, hostname: '', rootDomain: '' };
  }
}

function extractEmailsFromHtml(html, $ = null) {
  const found = new Set();
  const $doc = $ || (html ? cheerio.load(html) : null);
  let textToScan = html || '';

  if ($doc) {
    $doc('a[href^="mailto:"]').each((_, el) => {
      const href = $doc(el).attr('href') || '';
      const mail = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (mail && mail.includes('@')) found.add(mail);
    });

    const rawHtml = html || $doc.html() || '';
    if (rawHtml) {
      const $clean = cheerio.load(rawHtml);
      $clean('script, style, noscript, svg').remove();
      const hrefText = [];
      $clean('a[href]').each((_, el) => {
        hrefText.push($clean(el).attr('href') || '');
      });
      textToScan = `${$clean.root().text()} ${hrefText.join(' ')}`;
    }
  }

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}/g;
  const matches = textToScan.match(emailRegex) || [];
  for (const raw of matches) {
    const clean = raw.trim().toLowerCase().replace(/[.,;:)>\]]+$/, '');
    if (clean.length > 6 && clean.length < 75) {
      found.add(clean);
    }
  }

  const validEmails = [...found].filter((email) => {
    return !IGNORE_EMAIL_PATTERNS.some((re) => re.test(email));
  });

  const genericEmails = [];
  const corporateEmails = [];

  for (const email of validEmails) {
    const domain = email.split('@')[1] || '';
    if (GENERIC_EMAIL_PROVIDERS.includes(domain)) {
      genericEmails.push(email);
    } else {
      corporateEmails.push(email);
    }
  }

  return {
    allEmails: validEmails.slice(0, 6),
    genericEmails: genericEmails.slice(0, 4),
    corporateEmails: corporateEmails.slice(0, 4)
  };
}

function detectTechAndSignals(html, $) {
  const lower = (html || '').toLowerCase();

  // Detectar CMS / Plataforma con firmas exactas
  let cms = 'Código a medida / Otro';
  if (lower.includes('/wp-content/') || lower.includes('/wp-includes/')) cms = 'WordPress';
  else if (lower.includes('static.parastorage.com') || lower.includes('wix-bolt') || lower.includes('wixsite.com')) cms = 'Wix';
  else if (lower.includes('cdn.shopify.com')) cms = 'Shopify';
  else if (lower.includes('webflow.com')) cms = 'Webflow';
  else if (lower.includes('blogger.com') || lower.includes('blogspot.com')) cms = 'Blogger';
  else if (lower.includes('/media/system/js/') || lower.includes('joomla!')) cms = 'Joomla';
  else if (lower.includes('static1.squarespace.com')) cms = 'Squarespace';

  // Detectar WhatsApp en la web
  let hasWhatsappWidget = false;
  let whatsappWebNumber = '';

  const waLinks = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (
      href.includes('wa.me/') ||
      href.includes('wa.link/') ||
      href.includes('api.whatsapp.com') ||
      href.includes('whatsapp://') ||
      href.includes('web.whatsapp.com')
    ) {
      hasWhatsappWidget = true;
      waLinks.push(href);
    }
  });

  const waPluginMarkers = [
    'joinchat',
    'ht-ctc',
    'qlwapp',
    'floating-wpp',
    'whatsapp-widget',
    'whatsapp-button',
    'whatsapp-float',
    'wa-chat-box',
    'chaty-widget',
    'getbutton.io',
    'callbell'
  ];

  if (
    !hasWhatsappWidget &&
    (lower.includes('wa.me/') ||
      lower.includes('wa.link/') ||
      lower.includes('api.whatsapp.com/send') ||
      waPluginMarkers.some((marker) => lower.includes(marker)))
  ) {
    hasWhatsappWidget = true;
  }

  for (const link of waLinks) {
    const numMatch = link.match(/(?:wa\.me\/|phone=)(\+?\d{10,13})/);
    if (numMatch) {
      whatsappWebNumber = numMatch[1].replace(/\D/g, '');
      break;
    }
  }

  // Detectar adaptación móvil (meta viewport)
  const hasMobileViewport = $('meta[name="viewport"]').length > 0;
  const title = ($('title').first().text() || '').trim().slice(0, 120);
  const metaDescription = (
    $('meta[name="description"]').attr('content') || ''
  ).trim().slice(0, 180);

  // Extraer redes sociales desde la página
  const socialLinks = {};
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (href.includes('instagram.com/') && !socialLinks.instagram) {
      socialLinks.instagram = href;
    } else if ((href.includes('facebook.com/') || href.includes('fb.com/')) && !socialLinks.facebook) {
      socialLinks.facebook = href;
    } else if (href.includes('linkedin.com/') && !socialLinks.linkedin) {
      socialLinks.linkedin = href;
    } else if (href.includes('tiktok.com/') && !socialLinks.tiktok) {
      socialLinks.tiktok = href;
    }
  });

  return {
    cms,
    hasWhatsappWidget,
    whatsappWebNumber,
    hasMobileViewport,
    title,
    metaDescription,
    socialLinks
  };
}

async function checkMxRecords(domain) {
  if (!domain) return { hasMx: false, mxProvider: 'Sin dominio' };
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 3500))
    ]);
    if (!records || records.length === 0) {
      return { hasMx: false, mxProvider: 'Sin servidor de correo (MX vacío)' };
    }
    const exchanges = records.map((r) => (r.exchange || '').toLowerCase()).join(' ');
    let mxProvider = 'Servidor de correo activo';
    if (exchanges.includes('google.com') || exchanges.includes('googlemail.com')) {
      mxProvider = 'Google Workspace';
    } else if (exchanges.includes('outlook.com') || exchanges.includes('protection.outlook.com')) {
      mxProvider = 'Microsoft 365';
    } else if (exchanges.includes('zoho.com')) {
      mxProvider = 'Zoho Mail';
    } else if (exchanges.includes('secureserver.net')) {
      mxProvider = 'GoDaddy Mail';
    } else if (exchanges.includes('hostinger')) {
      mxProvider = 'Hostinger Mail';
    }
    return { hasMx: true, mxProvider };
  } catch (_) {
    return { hasMx: false, mxProvider: 'Sin correo corporativo configurado' };
  }
}

async function fetchHtmlWithFallback(targetUrl, timeoutMs = 9500) {
  const startTime = Date.now();
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8'
  };

  async function attemptFetch(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal
      });
      const html = await res.text();
      return {
        status: res.status,
        finalUrl: res.url || url,
        html,
        loadTimeMs: Date.now() - startTime
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const primaryHttpsUrl = targetUrl.replace(/^http:\/\//i, 'https://');
  const httpFallbackUrl = targetUrl.replace(/^https:\/\//i, 'http://');
  let httpsAttempt = null;

  try {
    httpsAttempt = await attemptFetch(primaryHttpsUrl, timeoutMs);
    const hasValidSsl = httpsAttempt.finalUrl.toLowerCase().startsWith('https://');
    if (httpsAttempt.status < 400) {
      return {
        reachable: true,
        statusCode: httpsAttempt.status,
        loadTimeMs: httpsAttempt.loadTimeMs,
        finalUrl: httpsAttempt.finalUrl,
        hasValidSsl,
        html: httpsAttempt.html,
        error: hasValidSsl ? null : 'Sin certificado SSL válido (Redirige a HTTP)'
      };
    }
  } catch (err) {
    httpsAttempt = { error: err };
  }

  // Si HTTPS falló (error de certificado/puerto 443) o devolvió >= 400, probamos con HTTP
  try {
    const httpRes = await attemptFetch(httpFallbackUrl, 7000);
    const redirectedToHttps = httpRes.finalUrl.toLowerCase().startsWith('https://');
    if (httpRes.status < 400) {
      return {
        reachable: true,
        statusCode: httpRes.status,
        loadTimeMs: Date.now() - startTime,
        finalUrl: httpRes.finalUrl,
        hasValidSsl: redirectedToHttps,
        html: httpRes.html,
        error: redirectedToHttps ? null : 'Sin certificado SSL válido (Solo HTTP)'
      };
    }
  } catch (_) {}

  if (httpsAttempt && typeof httpsAttempt.status === 'number') {
    return {
      reachable: false,
      statusCode: httpsAttempt.status,
      loadTimeMs: httpsAttempt.loadTimeMs,
      finalUrl: httpsAttempt.finalUrl,
      hasValidSsl: httpsAttempt.finalUrl.toLowerCase().startsWith('https://'),
      html: httpsAttempt.html || '',
      error: `HTTP ${httpsAttempt.status}`
    };
  }

  const err = httpsAttempt?.error;
  return {
    reachable: false,
    statusCode: 0,
    loadTimeMs: Date.now() - startTime,
    finalUrl: targetUrl,
    hasValidSsl: false,
    html: '',
    error: err?.cause?.code || err?.message || 'Sitio caído o dominio vencido'
  };
}

/**
 * Audita de forma integral la presencia digital de un prospecto
 */
async function auditBusinessWebsite(rawUrl) {
  const classification = classifyWebsiteUrl(rawUrl);

  const baseAudit = {
    urlType: classification.type, // NO_WEBSITE | SOCIAL_ONLY | FREE_BUILDER | CUSTOM_DOMAIN | INVALID_URL
    normalizedUrl: classification.normalizedUrl,
    hostname: classification.hostname,
    reachable: false,
    statusCode: 0,
    hasValidSsl: false,
    loadTimeMs: 0,
    isSlow: false,
    hasMobileViewport: false,
    hasWhatsappWidget: false,
    whatsappWebNumber: '',
    cms: 'Ninguno',
    allEmails: [],
    genericEmails: [],
    corporateEmails: [],
    hasMxRecords: false,
    mxProvider: 'No aplica',
    socialLinks: {},
    error: null
  };

  if (classification.type === 'NO_WEBSITE') {
    return baseAudit;
  }

  if (classification.type === 'SOCIAL_ONLY') {
    const h = classification.hostname;
    if (h.includes('instagram.com')) baseAudit.socialLinks.instagram = classification.normalizedUrl;
    if (h.includes('facebook.com') || h.includes('fb.com'))
      baseAudit.socialLinks.facebook = classification.normalizedUrl;
    if (h.includes('wa.me') || h.includes('whatsapp.com') || h.includes('wa.link')) {
      baseAudit.hasWhatsappWidget = true;
      const numMatch = classification.normalizedUrl.match(/(?:wa\.me\/|phone=)(\+?\d{10,13})/);
      if (numMatch) baseAudit.whatsappWebNumber = numMatch[1].replace(/\D/g, '');
    }
    baseAudit.cms = `Red Social (${classification.hostname})`;
    return baseAudit;
  }

  const isShortener = SHORTENER_DOMAINS.some(
    (d) => classification.hostname === d || classification.hostname.endsWith('.' + d)
  );

  // Verificar MX y descargar HTML en paralelo
  const [fetchResult, initialMxResult] = await Promise.all([
    fetchHtmlWithFallback(classification.normalizedUrl),
    classification.type === 'CUSTOM_DOMAIN' && !isShortener
      ? checkMxRecords(classification.rootDomain)
      : isShortener
      ? Promise.resolve({ hasMx: false, mxProvider: 'Enlace acortado' })
      : Promise.resolve({ hasMx: false, mxProvider: 'Subdominio gratuito' })
  ]);

  let mxResult = initialMxResult;

  // Si era un acortador (bit.ly, etc.) y redirigió a WhatsApp/Instagram/Directorio/Dominio real, reclasificar
  if (fetchResult.finalUrl && fetchResult.finalUrl !== classification.normalizedUrl) {
    const redirectedClass = classifyWebsiteUrl(fetchResult.finalUrl);
    if (redirectedClass.type === 'SOCIAL_ONLY' || redirectedClass.type === 'FREE_BUILDER') {
      baseAudit.urlType = redirectedClass.type;
      baseAudit.normalizedUrl = redirectedClass.normalizedUrl;
      baseAudit.hostname = redirectedClass.hostname;
      if (redirectedClass.type === 'SOCIAL_ONLY') {
        const rh = redirectedClass.hostname;
        if (rh.includes('instagram.com')) baseAudit.socialLinks.instagram = redirectedClass.normalizedUrl;
        if (rh.includes('facebook.com') || rh.includes('fb.com'))
          baseAudit.socialLinks.facebook = redirectedClass.normalizedUrl;
        if (rh.includes('wa.me') || rh.includes('whatsapp.com') || rh.includes('wa.link')) {
          baseAudit.hasWhatsappWidget = true;
          const numMatch = redirectedClass.normalizedUrl.match(/(?:wa\.me\/|phone=)(\+?\d{10,13})/);
          if (numMatch) baseAudit.whatsappWebNumber = numMatch[1].replace(/\D/g, '');
        }
        baseAudit.cms = `Red Social (${redirectedClass.hostname})`;
        return baseAudit;
      }
    } else if (isShortener && redirectedClass.type === 'CUSTOM_DOMAIN') {
      baseAudit.normalizedUrl = redirectedClass.normalizedUrl;
      baseAudit.hostname = redirectedClass.hostname;
      mxResult = await checkMxRecords(redirectedClass.rootDomain);
    }
  }

  baseAudit.reachable = fetchResult.reachable;
  baseAudit.statusCode = fetchResult.statusCode;
  baseAudit.hasValidSsl = fetchResult.hasValidSsl;
  baseAudit.loadTimeMs = fetchResult.loadTimeMs;
  baseAudit.isSlow = fetchResult.loadTimeMs > 4000;
  baseAudit.error = fetchResult.error;
  baseAudit.hasMxRecords = mxResult.hasMx;
  baseAudit.mxProvider = mxResult.mxProvider;

  if (
    baseAudit.urlType === 'CUSTOM_DOMAIN' &&
    fetchResult.reachable &&
    fetchResult.hasValidSsl &&
    fetchResult.finalUrl &&
    fetchResult.finalUrl.toLowerCase().startsWith('https://')
  ) {
    baseAudit.normalizedUrl = fetchResult.finalUrl;
  }

  if (!fetchResult.html) {
    return baseAudit;
  }

  const $ = cheerio.load(fetchResult.html);
  const emailsHome = extractEmailsFromHtml(fetchResult.html, $);
  const tech = detectTechAndSignals(fetchResult.html, $);

  let allEmails = [...emailsHome.allEmails];
  let genericEmails = [...emailsHome.genericEmails];
  let corporateEmails = [...emailsHome.corporateEmails];

  // Si no se hallaron correos en el home, buscar enlace de /contacto rápido
  if (allEmails.length === 0 && fetchResult.reachable) {
    let contactUrl = null;
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (/contact|contacto|nosotros|quienes-somos/i.test(href) && !contactUrl) {
        try {
          const resolved = new URL(href, fetchResult.finalUrl);
          if (resolved.hostname === new URL(fetchResult.finalUrl).hostname) {
            contactUrl = resolved.href;
          }
        } catch (_) {}
      }
    });

    if (contactUrl) {
      const contactRes = await fetchHtmlWithFallback(contactUrl, 5000);
      if (contactRes.html) {
        const $c = cheerio.load(contactRes.html);
        const contactEmails = extractEmailsFromHtml(contactRes.html, $c);
        allEmails = [...new Set([...allEmails, ...contactEmails.allEmails])];
        genericEmails = [...new Set([...genericEmails, ...contactEmails.genericEmails])];
        corporateEmails = [...new Set([...corporateEmails, ...contactEmails.corporateEmails])];
      }
    }
  }

  return {
    ...baseAudit,
    cms: tech.cms,
    hasWhatsappWidget: tech.hasWhatsappWidget,
    whatsappWebNumber: tech.whatsappWebNumber,
    hasMobileViewport: tech.hasMobileViewport,
    title: tech.title,
    metaDescription: tech.metaDescription,
    socialLinks: tech.socialLinks,
    allEmails,
    genericEmails,
    corporateEmails
  };
}

module.exports = {
  classifyWebsiteUrl,
  auditBusinessWebsite,
  extractEmailsFromHtml,
  FREE_BUILDER_DOMAINS
};
