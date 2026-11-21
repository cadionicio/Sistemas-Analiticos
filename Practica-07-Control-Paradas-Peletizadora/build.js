// Construye el HTML autocontenido (único código para HTML y EXE).
// Uso: node build.js 0.1.0
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('Indique versión X.Y.Z'); process.exit(1); }
const ahora = new Date(Date.now() - 5 * 3600e3).toISOString();
const compilacion = ahora.slice(0, 10).replace(/-/g, '') + '-' + ahora.slice(11, 16).replace(':', '');
const demo = path.join(__dirname, 'datos', '06_Entrada_DatosSinteticos.xlsx');
const segura = s => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const app = esbuild.buildSync({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', target: ['chrome109'], write: false, charset: 'utf8', legalComments: 'inline' }).outputFiles[0].text;
const partes = {
  __CSS__: fs.readFileSync('src/estilos.css', 'utf8'),
  __SQLJS__: segura(fs.readFileSync('node_modules/sql.js/dist/sql-wasm-inline.js', 'utf8')),
  __XLSX__: segura(fs.readFileSync('node_modules/xlsx/dist/xlsx.full.min.js', 'utf8')),
  __APP__: segura(app),
  __DEMO_B64__: fs.readFileSync(demo).toString('base64'),
  __DEMO_NOMBRE__: path.basename(demo),
  __IMG_INGRESO__: 'data:image/svg+xml;base64,' + fs.readFileSync('recursos/ilustracion_ingreso.svg').toString('base64'),
  __VERSION__: version,
  __COMPILACION__: compilacion,
};
let html = fs.readFileSync('src/plantilla.html', 'utf8');
for (const [k, v] of Object.entries(partes)) html = html.split(k).join(v);
if (/https?:\/\/[^\s"'<>]*\.(js|css|wasm)\b/.test(html.replace(/sheetjs\.com|github\.com|mozilla\.org|w3\.org|apache\.org|opensource\.org/g, ''))) console.warn('Aviso: se detectó una URL de recurso externo');
fs.mkdirSync('dist', { recursive: true });
const salida = path.join('dist', `ControlParadas_P01_v${version}.html`);
fs.writeFileSync(salida, html);
fs.mkdirSync('electron/app', { recursive: true });
fs.writeFileSync('electron/app/index.html', html);
const pkg = JSON.parse(fs.readFileSync('electron/package.json', 'utf8'));
pkg.version = version; fs.writeFileSync('electron/package.json', JSON.stringify(pkg, null, 2));
const h = crypto.createHash('sha256').update(html).digest('hex');
console.log(JSON.stringify({ salida, bytes: html.length, sha256: h, compilacion, demoSha256: crypto.createHash('sha256').update(fs.readFileSync(demo)).digest('hex') }, null, 1));
