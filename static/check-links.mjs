#!/usr/bin/env node
// Comprueba enlaces internos de static/dist en los tres idiomas (es en la raíz, ca/ y en/): archivos (href/src) y anclas (#id).
// También verifica: un solo <h1> por página, ids duplicados, <img> sin alt, <html lang> correcto según la carpeta,
// que cada página exista en los tres idiomas y que el selector de idioma / hreflang estén completos.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const LANGS = ['es', 'ca', 'en'];
const PREFIX = { es: '', ca: 'ca/', en: 'en/' };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));
const idsOf = new Map();
const getIds = (file) => {
  if (!idsOf.has(file)) idsOf.set(file, [...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  return idsOf.get(file);
};
const errors = [];
const perLang = Object.fromEntries(LANGS.map((l) => [l, 0]));
let checked = 0;

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const rel = relative(DIST, file).split(sep).join('/');
  const lang = LANGS.find((l) => l !== 'es' && rel.startsWith(PREFIX[l])) || 'es';
  const page = rel.slice(PREFIX[lang].length); // ruta sin prefijo de idioma
  perLang[lang]++;
  const base = /<base href="([^"]*)"/.exec(html)?.[1];

  // Idioma del documento
  const htmlLang = /<html[^>]*\slang="([^"]+)"/.exec(html)?.[1];
  if (htmlLang !== lang) errors.push(`${rel}: <html lang="${htmlLang}"> (esperado "${lang}")`);
  // La misma página debe existir en los tres idiomas (salvo la 404, solo en español)
  if (rel !== '404.html') {
    for (const l of LANGS) if (!existsSync(join(DIST, PREFIX[l] + page))) errors.push(`${rel}: falta la versión "${l}" (${PREFIX[l] + page})`);
    for (const l of [...LANGS, 'x-default']) if (!new RegExp(`<link rel="alternate" hreflang="${l}"`).test(html)) errors.push(`${rel}: falta <link rel="alternate" hreflang="${l}">`);
  }
  // Selector de idioma: un enlace por idioma con lang + hreflang, y aria-current en el actual
  for (const l of LANGS) if (!new RegExp(`<a [^>]*lang="${l}" hreflang="${l}"`).test(html)) errors.push(`${rel}: el selector de idioma no enlaza a "${l}"`);
  if (!new RegExp(`lang="${lang}" hreflang="${lang}" aria-current="true"`).test(html)) errors.push(`${rel}: el selector de idioma no marca "${lang}" con aria-current`);

  const ids = getIds(file);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push(`${rel}: ids duplicados: ${[...new Set(dup)].join(', ')}`);
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) errors.push(`${rel}: ${h1} <h1> (debe haber 1)`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) errors.push(`${rel}: <img> sin alt`);

  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    let url = m[1].replace(/&amp;/g, '&');
    if (/^(?:[a-z]+:|\/\/)/i.test(url)) continue; // externos, mailto, tel
    if (rel === '404.html' && base) {             // 404 usa <base> absoluto (GitHub Pages): se resuelve desde la raíz de dist
      if (/^#/.test(url) || url === base) continue;
      const clean = url.split('#')[0].split('?')[0];
      let target = join(DIST, clean);
      if (!clean || clean.endsWith('/')) target = join(target, 'index.html');
      checked++;
      if (!existsSync(target)) errors.push(`${rel}: enlace roto "${url}" (desde <base>)`);
      continue;
    }
    checked++;
    const [pathPart, hash] = url.split('#');
    let target = file;
    if (pathPart) {
      const clean = pathPart.split('?')[0];
      target = resolve(dirname(file), clean);
      if (clean.endsWith('/') || (existsSync(target) && statSync(target).isDirectory())) target = join(target, 'index.html');
      if (!target.startsWith(DIST)) { errors.push(`${rel}: "${url}" sale de dist/`); continue; }
      if (!existsSync(target)) { errors.push(`${rel}: enlace roto "${url}"`); continue; }
    }
    if (hash && target.endsWith('.html')) {
      const tIds = getIds(target);
      const isSprite = url.startsWith('#i-');
      if (!tIds.includes(hash) && !isSprite) errors.push(`${rel}: ancla inexistente "${url}"`);
    }
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} problema(s):\n  ` + errors.slice(0, 200).join('\n  ') + (errors.length > 200 ? `\n  … y ${errors.length - 200} más` : ''));
  process.exit(1);
}
console.log(`✔ ${htmlFiles.length} páginas (${LANGS.map((l) => `${l}: ${perLang[l]}`).join(', ')}), ${checked} enlaces internos revisados sin errores`);
