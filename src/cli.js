#!/usr/bin/env node
const { runLeadPipeline, requestStopJob } = require('./scraper/mapsScraper');
const { loadLeads, logMessage } = require('./storage/db');
const { exportLeadsToCsv, exportLeadsToExcel } = require('./export/exporter');

function parseArgs(argv) {
  const args = {
    query: 'Odontólogos',
    location: 'Chapinero, Bogotá',
    limit: 15,
    resume: false,
    export: true,
    exportOnly: false,
    auditWebsites: true,
    headless: true
  };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if ((token === '--query' || token === '-q') && argv[i + 1]) {
      args.query = argv[++i];
    } else if ((token === '--location' || token === '-l') && argv[i + 1]) {
      args.location = argv[++i];
    } else if ((token === '--limit' || token === '--max' || token === '-n') && argv[i + 1]) {
      args.limit = parseInt(argv[++i], 10) || 15;
    } else if (token === '--resume') {
      args.resume = true;
    } else if (token === '--export') {
      args.export = true;
    } else if (token === '--export-only') {
      args.exportOnly = true;
    } else if (token === '--no-audit') {
      args.auditWebsites = false;
    } else if (token === '--headed' || token === '--visible') {
      args.headless = false;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  process.on('SIGINT', () => {
    logMessage('warn', 'Ctrl+C detectado. Guardando progreso de forma segura...');
    requestStopJob();
  });

  if (args.exportOnly) {
    const allLeads = loadLeads();
    const xlsxPath = await exportLeadsToExcel(allLeads);
    const csvPath = exportLeadsToCsv(allLeads);
    logMessage('info', `Exportación completada (${allLeads.length} prospectos):`);
    logMessage('info', `  -> Excel: ${xlsxPath}`);
    logMessage('info', `  -> CSV:   ${csvPath}`);
    return;
  }

  console.log('\n==============================================================');
  console.log('  IVIA LEAD RADAR — CLI DE PROSPECCIÓN Y AUDITORÍA DIGITAL');
  console.log('==============================================================');
  console.log(`  Rubro:      ${args.query}`);
  console.log(`  Ubicación:  ${args.location}`);
  console.log(`  Límite:     ${args.limit} negocios`);
  console.log(`  Auditoría:  ${args.auditWebsites ? 'Completa (Web + SSL + DNS MX + Emails)' : 'Solo Maps'}`);
  console.log(`  Modo:       ${args.resume ? 'Reanudar (--resume)' : 'Nueva búsqueda'}`);
  console.log('==============================================================\n');

  await runLeadPipeline({
    query: args.query,
    location: args.location,
    maxResults: args.limit,
    auditWebsites: args.auditWebsites,
    headless: args.headless,
    resume: args.resume
  });

  if (args.export) {
    const allLeads = loadLeads();
    const xlsxPath = await exportLeadsToExcel(allLeads);
    const csvPath = exportLeadsToCsv(allLeads);
    console.log('\n--------------------------------------------------------------');
    console.log(`✅ Archivos generados exitosamente (${allLeads.length} prospectos totales):`);
    console.log(`   📊 Excel (.xlsx): ${xlsxPath}`);
    console.log(`   📄 CSV (.csv):    ${csvPath}`);
    console.log('--------------------------------------------------------------\n');
  }
}

main().catch((err) => {
  logMessage('error', `Fallo en CLI: ${err.message}`);
  process.exit(1);
});
