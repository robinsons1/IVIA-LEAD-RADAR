const { chromium } = require('playwright');
const { auditBusinessWebsite } = require('./websiteAuditor');
const { scoreAndBuildPitch } = require('./leadScorer');
const {
  upsertLead,
  loadProgress,
  saveProgress,
  logMessage
} = require('../storage/db');

let activeJob = {
  running: false,
  stopRequested: false,
  query: '',
  location: '',
  totalTarget: 0,
  processed: 0,
  foundCount: 0,
  startedAt: null
};

function getJobStatus() {
  return { ...activeJob };
}

function requestStopJob() {
  if (activeJob.running) {
    activeJob.stopRequested = true;
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs = 900, maxMs = 2100) {
  const delta = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(delta);
}

/**
 * Ejecuta el pipeline completo:
 * 1. Búsqueda en Google Maps con Playwright Chromium (100% gratis)
 * 2. Extracción de teléfono, web, dirección, rating, reseñas
 * 3. Auditoría profunda de sitio web + SSL + DNS MX + extracción de correos y WhatsApp
 * 4. Calificación IVIA Lead Score + generación de pitch de WhatsApp/Email
 * 5. Guardado incremental con soporte de --resume
 */
async function runLeadPipeline(options = {}, onEvent = null) {
  if (activeJob.running) {
    throw new Error('Ya hay una búsqueda en ejecución. Detén la actual o espera a que finalice.');
  }

  const query = (options.query || 'Empresas').trim();
  const location = (options.location || 'Bogotá, Colombia').trim();
  const maxResults = Math.max(1, Math.min(200, Number(options.maxResults) || 20));
  const auditWebsites = options.auditWebsites !== false;
  const headless = options.headless !== false;
  const resume = Boolean(options.resume);

  const searchQuery = `${query} en ${location}`;

  activeJob = {
    running: true,
    stopRequested: false,
    query,
    location,
    totalTarget: maxResults,
    processed: 0,
    foundCount: 0,
    startedAt: new Date().toISOString()
  };

  const emit = (payload) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(payload);
      } catch (_) {}
    }
  };

  let progress = loadProgress();
  if (!resume || progress.query !== query || progress.location !== location) {
    progress = {
      query,
      location,
      completedUrls: [],
      lastIndex: 0,
      status: 'running'
    };
    saveProgress(progress);
  } else {
    logMessage(
      'info',
      `Reanudando búsqueda previa para "${searchQuery}" (${progress.completedUrls.length} ya procesados)`,
      emit
    );
  }

  let browser = null;
  const results = [];

  try {
    logMessage('info', `Iniciando navegador Playwright para buscar: "${searchQuery}" (Meta: ${maxResults} prospectos)`, emit);
    emit({ type: 'status', status: 'running', job: getJobStatus() });

    const launchArgs = ['--disable-blink-features=AutomationControlled', '--no-sandbox'];
    try {
      browser = await chromium.launch({ channel: 'chrome', headless, args: launchArgs });
    } catch (_) {
      try {
        browser = await chromium.launch({ channel: 'msedge', headless, args: launchArgs });
      } catch (__) {
        browser = await chromium.launch({ headless, args: launchArgs });
      }
    }

    const context = await browser.newContext({
      locale: 'es-CO',
      viewport: { width: 1366, height: 860 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    const mapsSearchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=es`;

    await page.goto(mapsSearchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Cerrar banner de consentimiento si aparece
    try {
      const acceptBtn = page.locator('button:has-text("Aceptar todo"), button:has-text("Accept all")').first();
      if (await acceptBtn.isVisible({ timeout: 2500 })) {
        await acceptBtn.click();
        await sleep(1000);
      }
    } catch (_) {}

    // Esperar que cargue la lista de resultados o un resultado único
    await page.waitForSelector('a[href*="/maps/place/"], h1.DUwDvf', { timeout: 25000 }).catch(() => {});
    await sleep(1800);

    // Fase 1: Hacer scroll en el panel lateral para recolectar enlaces de negocios
    logMessage('info', 'Explorando listado de Google Maps y cargando fichas de negocios...', emit);

    const collectedPlaces = new Map();
    let stagnantScrolls = 0;

    while (collectedPlaces.size < maxResults && stagnantScrolls < 7 && !activeJob.stopRequested) {
      const items = await page.$$eval('a[href*="/maps/place/"]', (anchors) =>
        anchors.map((a) => ({
          href: a.href,
          label: a.getAttribute('aria-label') || a.innerText || ''
        }))
      );

      const prevSize = collectedPlaces.size;
      for (const item of items) {
        if (item.href && !collectedPlaces.has(item.href)) {
          collectedPlaces.set(item.href, item.label.trim());
        }
      }

      if (collectedPlaces.size >= maxResults) break;

      if (collectedPlaces.size === prevSize) {
        stagnantScrolls++;
      } else {
        stagnantScrolls = 0;
        logMessage(
          'info',
          `Descubiertos ${Math.min(collectedPlaces.size, maxResults)} / ${maxResults} negocios en la zona...`,
          emit
        );
      }

      // Hacer scroll en el contenedor de resultados (role="feed")
      const scrolled = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          feed.scrollBy(0, 900);
          return true;
        }
        return false;
      });

      if (!scrolled) break;
      await sleep(1300);
    }

    const placeEntries = [...collectedPlaces.entries()].slice(0, maxResults);
    activeJob.foundCount = placeEntries.length;
    logMessage(
      'info',
      `Se encontraron ${placeEntries.length} negocios. Iniciando extracción detallada y auditoría IVIA...`,
      emit
    );
    emit({ type: 'status', status: 'running', job: getJobStatus() });

    // Fase 2: Visitar cada negocio para extraer datos exactos y auditar su presencia web
    for (let i = 0; i < placeEntries.length; i++) {
      if (activeJob.stopRequested) {
        logMessage('warn', 'Búsqueda detenida manualmente por el usuario.', emit);
        break;
      }

      const [placeUrl, fallbackName] = placeEntries[i];
      if (resume && progress.completedUrls.includes(placeUrl)) {
        activeJob.processed = i + 1;
        continue;
      }

      try {
        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('h1.DUwDvf', { timeout: 10000 }).catch(() => {});
        await sleep(900);

        const details = await page.evaluate(() => {
          const getText = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : '';
          };

          const name = getText('h1.DUwDvf');
          const category = getText('button.DkEaL') || getText('span.DkEaL');

          // Rating
          let rating = 0;
          const ratingText = getText('div.F7nice span[aria-hidden="true"]');
          if (ratingText) {
            rating = parseFloat(ratingText.replace(',', '.')) || 0;
          }

          // Cantidad de reseñas
          let reviewsCount = 0;
          const reviewEl = document.querySelector(
            'div.F7nice span[aria-label*="reseña"], div.F7nice span[aria-label*="opiniones"], div.F7nice span[aria-label*="review"]'
          );
          if (reviewEl) {
            const aria = reviewEl.getAttribute('aria-label') || reviewEl.textContent || '';
            const digits = aria.replace(/\D/g, '');
            if (digits) reviewsCount = parseInt(digits, 10) || 0;
          }

          // Dirección
          let address = '';
          const addrBtn = document.querySelector('button[data-item-id="address"]');
          if (addrBtn) {
            address = (addrBtn.getAttribute('aria-label') || addrBtn.textContent || '')
              .replace(/^Dirección:\s*/i, '')
              .trim();
          }

          // Teléfono
          let phone = '';
          const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
          if (phoneBtn) {
            const dataId = phoneBtn.getAttribute('data-item-id') || '';
            phone = dataId.replace(/^phone:tel:/i, '').trim();
            if (!phone) {
              phone = (phoneBtn.getAttribute('aria-label') || phoneBtn.textContent || '')
                .replace(/^Teléfono:\s*/i, '')
                .trim();
            }
          }

          // Sitio Web
          let website = '';
          const webLink = document.querySelector('a[data-item-id="authority"]');
          if (webLink) {
            website = webLink.getAttribute('href') || '';
          }

          return { name, category, rating, reviewsCount, address, phone, website };
        });

        const bizName = details.name || fallbackName || `Negocio #${i + 1}`;
        logMessage(
          'info',
          `[${i + 1}/${placeEntries.length}] Analizando: ${bizName} (${details.website ? 'Con enlace web' : 'SIN WEB'})`,
          emit
        );

        const audit = auditWebsites
          ? await auditBusinessWebsite(details.website)
          : { urlType: details.website ? 'CUSTOM_DOMAIN' : 'NO_WEBSITE', normalizedUrl: details.website };

        const rawLead = {
          name: bizName,
          category: details.category || query,
          searchQuery: query,
          city: location,
          address: details.address || location,
          phone: details.phone || '',
          website: details.website || '',
          rating: details.rating || 0,
          reviewsCount: details.reviewsCount || 0,
          mapsUrl: placeUrl
        };

        const scored = scoreAndBuildPitch(rawLead, audit);

        const fullLead = {
          ...rawLead,
          ...scored,
          audit
        };

        const { lead: savedLead, isNew } = upsertLead(fullLead);
        results.push(savedLead);

        progress.completedUrls.push(placeUrl);
        progress.lastIndex = i;
        saveProgress(progress);

        activeJob.processed = i + 1;
        emit({
          type: 'lead',
          lead: savedLead,
          isNew,
          job: getJobStatus()
        });

        await randomDelay(800, 1700);
      } catch (itemErr) {
        logMessage('warn', `Error procesando ficha #${i + 1}: ${itemErr.message}`, emit);
        activeJob.processed = i + 1;
      }
    }

    progress.status = activeJob.stopRequested ? 'stopped' : 'completed';
    saveProgress(progress);

    logMessage(
      'info',
      `Proceso finalizado: ${results.length} prospectos analizados y guardados en la base de datos.`,
      emit
    );

    return results;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    activeJob.running = false;
    emit({ type: 'status', status: 'idle', job: getJobStatus() });
  }
}

module.exports = {
  runLeadPipeline,
  getJobStatus,
  requestStopJob
};
