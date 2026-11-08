#!/usr/bin/env node
// Comprueba enlaces internos de static/dist: archivos (href/src) y anclas (#id).
// También verifica: un solo <h1> por página, ids duplicados y <img> sin alt.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));
const idsOf = new Map();
const getIds = (file) => {
  if (!idsOf.has(file)) idsOf.set(file, [...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  return idsOf.get(file);
};
const errors = [];
let checked = 0;

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const rel = relative(DIST, file);
  const base = /<base href="([^"]*)"/.exec(html)?.[1];
  const ids = getIds(file);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push(`${rel}: ids duplicados: ${[...new Set(dup)].join(', ')}`);
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) errors.push(`${rel}: ${h1} <h1> (debe haber 1)`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) errors.push(`${rel}: <img> sin alt`);

  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    let url = m[1].replace(/&amp;/g, '&');
    if (/^(?:[a-z]+:|\/\/)/i.test(url)) continue; // externos, mailto, tel
    if (rel === '404.html' && base) continue;     // 404 usa <base> absoluto (GitHub Pages)
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
  console.error(`✖ ${errors.length} problema(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`✔ ${htmlFiles.length} páginas, ${checked} enlaces internos revisados sin errores`);
