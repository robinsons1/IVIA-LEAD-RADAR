# IVIA Lead Radar — Buscador y Auditor de Clientes Potenciales

Herramienta local de prospección y auditoría digital diseñada para **IVIA (`ivia.ingversia.com`)**.

## 🛠️ Herramientas Gratuitas Integradas
- **Playwright + Google Chrome**: Extracción automatizada desde Google Maps sin pagar Google Places API.
- **Cheerio + Fetch HTTP/TLS**: Auditoría técnica de sitios web (estado HTTP, certificado SSL, velocidad, adaptación móvil, extracción de correos `@gmail` vs corporativos y detección de botón de WhatsApp).
- **DNS MX Inspector (`node:dns`)**: Verificación gratuita de servidores de correo corporativo (Google Workspace, Microsoft 365 o ausencia de correo).
- **ExcelJS**: Generación de reportes `.xlsx` con formato ejecutivo, colores de prioridad, filtros automáticos y enlaces directos de 1 clic a WhatsApp.

---

## 🚀 Cómo Usar la Herramienta

### Opción 1: Dashboard Web Ejecutivo (Recomendado)
Inicia el servidor local:
```powershell
npm start
```
Luego abre en tu navegador: **[http://localhost:3000](http://localhost:3000)**

Desde el Dashboard puedes:
1. Elegir un nicho rápido (*Odontólogos, Abogados, Contadores, Consultorios, Ferreterías, Inmobiliarias, Talleres, Empresas SST*) o escribir cualquier rubro y ciudad/barrio.
2. Ver la extracción y auditoría en vivo en la consola integrada.
3. Filtrar en 1 clic por:
   - 🔴 **Sin Página Web** (Prioridad Plan Básico \$89k / Estándar \$149k)
   - 🟠 **Solo Redes Sociales / Linktree**
   - 🚨 **Web Caída o Sin SSL**
   - 🟡 **Usan `@gmail` / `@hotmail`** (Oportunidad Correo Corporativo)
   - 🟢 **Con WhatsApp Móvil (`3xx`)**
4. Hacer clic en **💬 Pitch / WhatsApp** para abrir el mensaje personalizado con la garantía de *"Cero Anticipos: pagas cuando apruebas"* y enviarlo directamente a WhatsApp Web.
5. Descargar el reporte en **Excel (`.xlsx`)** o **CSV (`.csv`)**.

---

### Opción 2: Modo Consola (CLI)
Puedes lanzar búsquedas y exportar a Excel directamente desde la terminal:

```powershell
# Buscar 20 negocios de un rubro y exportar automáticamente a Excel y CSV
node src/cli.js --query "Firmas de Abogados" --location "Bogotá" --limit 20 --export

# Reanudar una búsqueda interrumpida desde el último checkpoint
node src/cli.js --query "Firmas de Abogados" --location "Bogotá" --limit 50 --resume --export

# Ver el navegador Chrome en vivo mientras busca
node src/cli.js --query "Consultorios Médicos" --location "Medellín" --limit 15 --headed --export

# Solo exportar la base de datos actual a Excel y CSV
npm run export
```

Los archivos exportados se guardan en la carpeta `output/` y la base de datos local en `data/leads.json`.
