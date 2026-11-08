#!/usr/bin/env node
/**
 * Imperium Beauty Studio — generador estático (Node >= 18, sin dependencias).
 *
 *   node static/build.mjs                         → genera static/dist/
 *   SITE_URL=https://usuario.github.io/repo/ node static/build.mjs
 *                                                  → igual, con URLs absolutas (canonical, OG, sitemap)
 *
 * Fuente única de verdad: content/*.json (ver content/SCHEMA.md).
 * Si content/treatments.json, packs.json o marketing.json no existen (o no son JSON válido),
 * se usan los datos de prueba de static/fixtures/.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONTENT = process.env.CONTENT_DIR ? resolve(process.env.CONTENT_DIR) : join(ROOT, 'content');
const FIXTURES = join(HERE, 'fixtures');
const SRC = join(HERE, 'src');
const DIST = join(HERE, 'dist');
const warnings = [];
const warn = (m) => warnings.push(m);

/* ==========================================================================
   1. Datos
   ========================================================================== */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function loadData(name, { required = false } = {}) {
  const real = join(CONTENT, `${name}.json`);
  if (existsSync(real)) {
    try { return { data: readJson(real), source: `content/${name}.json` }; }
    catch (e) {
      if (required) throw new Error(`content/${name}.json no es JSON válido: ${e.message}`);
      warn(`content/${name}.json no es JSON válido (${e.message}); uso static/fixtures/${name}.json`);
    }
  } else if (required) {
    throw new Error(`Falta content/${name}.json`);
  }
  return { data: readJson(join(FIXTURES, `${name}.json`)), source: `static/fixtures/${name}.json (prueba)` };
}

const siteSrc = loadData('site', { required: true });
const trSrc = loadData('treatments');
const pkSrc = loadData('packs');
const mkSrc = loadData('marketing');

const site = siteSrc.data;
const brand = site.brand ?? {};
const contact = site.contact ?? {};
const social = site.social ?? {};
const seo = site.seo ?? {};
const legal = site.legal ?? {};
const theme = site.theme ?? { colors: {}, fonts: {} };

const categories = [...(trSrc.data.categories ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
const treatments = (trSrc.data.treatments ?? []).filter((t) => t && t.id);
const packs = pkSrc.data ?? {};
const mk = mkSrc.data ?? {};
const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
const trById = Object.fromEntries(treatments.map((t) => [t.id, t]));
const byCat = (id) => treatments.filter((t) => t.category === id);

for (const t of treatments) {
  if (!catById[t.category]) warn(`Tratamiento "${t.id}" usa categoría inexistente "${t.category}"`);
  if (!/^[a-z0-9-]+$/.test(t.id)) warn(`Tratamiento "${t.id}": el id debería ser un slug (a-z, 0-9, guiones)`);
}

let SITE_URL = (seo.siteUrl || process.env.SITE_URL || '').trim(); // site.json manda; SITE_URL (CI) si está vacío
if (SITE_URL && !SITE_URL.endsWith('/')) SITE_URL += '/';
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const VERSION = Date.now().toString(36);

/* ==========================================================================
   2. Textos de interfaz (microcopy estructural; el contenido va en content/)
   ========================================================================== */
const UI = {
  skip: 'Saltar al contenido',
  menuOpen: 'Abrir menú', menuClose: 'Cerrar menú',
  bookCta: 'Pide cita',
  from: 'desde', consult: 'Consultar',
  seeFicha: 'Ver ficha', seeAll: 'Ver todos los tratamientos', seeMore: 'Ver más',
  whatsapp: 'WhatsApp', whatsappLong: 'Escríbenos por WhatsApp', call: 'Llamar', form: 'Formulario de contacto',
  newTab: '(se abre en una pestaña nueva)',
  home: 'Inicio',
  painLabels: ['Sin molestia', 'Muy leve', 'Leve', 'Moderada', 'Intensa', 'Muy intensa'],
  reviewsNotice: 'Reseñas de ejemplo: se sustituirán por opiniones reales de clientas. No son testimonios verificados.',
  imageSlot: 'Foto pendiente',
};
const PAIN = (n) => UI.painLabels[Math.max(0, Math.min(5, Number(n) || 0))];

/* ==========================================================================
   3. Utilidades
   ========================================================================== */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Escapa y resalta los "[POR DEFINIR]" para que se vean como pendientes. */
const fill = (s) => esc(s).replace(/\[POR[ -]DEFINIR\]/gi, (m) => `<span class="todo">${m}</span>`);
const arr = (x) => (Array.isArray(x) ? x.filter((v) => v !== null && v !== undefined && v !== '') : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => {
  if (isNum(v) && v > 0) return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
  if (typeof v === 'string' && v.trim()) return esc(v);
  return UI.consult;
};
const saving = (price, old) => (isNum(price) && isNum(old) && old > price ? { amount: +(old - price).toFixed(2), pct: Math.round(((old - price) / old) * 100) } : null);
const savingHtml = (s) => (s ? `<span class="save">Ahorras ${money(s.amount)} (−${s.pct}%)</span>` : '');
const priceFromOf = (t) => (isNum(t.priceFrom) && t.priceFrom > 0 ? t.priceFrom : Math.min(...arr(t.prices).map((p) => p.price).filter((p) => isNum(p) && p > 0), Infinity));
const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${esc(name)}"></use></svg>`;
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const WA = digits(contact.whatsapp);
const waUrl = (text) => `https://wa.me/${WA}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
const waFor = (name) => (contact.whatsappTreatmentMessage || '¡Hola! Me gustaría información y cita para: {treatment}').replace('{treatment}', name);
const tel = contact.phone ? `tel:${String(contact.phone).replace(/[^\d+]/g, '')}` : '';
const abs = (p) => (SITE_URL ? new URL(p, SITE_URL).href : null);
/** Enlaces del contenido ("tratamientos/", "#reservar", "https://…") → relativos a la página. */
const link = (href, root) => {
  if (!href) return root || './';
  if (/^(?:[a-z]+:|#|\/\/)/i.test(href)) return href;
  return (root || '') + href.replace(/^\/+/, '') || './';
};
const ext = (href) => /^https?:/i.test(href || '');
const extAttrs = (href) => (ext(href) ? ' target="_blank" rel="noopener"' : '');
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const knownIcons = new Set([...readFileSync(join(SRC, 'assets', 'icons.svg'), 'utf8').matchAll(/id="i-([a-z]+)"/g)].map((m) => m[1]));
const ic = (name, fallback = 'sparkle') => {
  if (name && knownIcons.has(name)) return name;
  if (name) warn(`Icono desconocido "${name}" (uso "${fallback}")`);
  return fallback;
};

/** Imagen: campo `image` (ruta relativa a static/src/assets/ o URL) o autodetección en assets/img/<base>.{webp,jpg,…}. */
function findImage(field, autoBase) {
  if (field) {
    if (ext(field)) return field;
    const rel = String(field).replace(/^\/+/, '').replace(/^assets\//, '');
    if (existsSync(join(SRC, 'assets', rel))) return `assets/${rel}`;
    warn(`Imagen no encontrada: static/src/assets/${rel}`);
    return null;
  }
  for (const e of ['webp', 'avif', 'jpg', 'jpeg', 'png']) {
    if (existsSync(join(SRC, 'assets', 'img', `${autoBase}.${e}`))) return `assets/img/${autoBase}.${e}`;
  }
  return null;
}
const imgSrc = (src, root) => (ext(src) ? src : root + src);

/* ==========================================================================
   4. Color: variables CSS + variantes accesibles calculadas (WCAG 2.2 AA)
   ========================================================================== */
const hex = (h) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  let s = m[1]; if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const toHsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l]; const d = mx - mn; const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, s, l]; };
const fromHsl = ([h, s, l]) => { if (!s) return [l * 255, l * 255, l * 255]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; };

const C = { cream: '#FBF4EE', nude: '#F1DDD0', pink: '#F4B6C2', coral: '#F07C6C', sage: '#B9CDB4', green: '#3F6B57', gold: '#C9A24B', ink: '#2B2024', white: '#FFFFFF', whatsapp: '#25D366', ...(theme.colors || {}) };
function buildThemeCss() {
  const rgb = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, hex(v)]));
  const vars = Object.entries(C).map(([k, v]) => `--c-${k}: ${v};`);
  const ink = rgb.ink, cream = rgb.cream, white = rgb.white;
  const bgs = [cream, white, rgb.nude && cream ? mix(cream, rgb.nude, 0.55) : null, rgb.sage && cream ? mix(cream, rgb.sage, 0.35) : null].filter(Boolean);
  // Versión "strong": oscurece (HSL) hasta >= 4.6:1 sobre todos los fondos claros.
  const strong = (k) => {
    const base = rgb[k]; if (!base || !ink || !cream) return C[k];
    const [h, sat, l0] = toHsl(base); // baja la luminosidad conservando el tono (colores vivos, no 'sucios')
    for (let l = l0; l >= 0; l -= 0.01) { const c = fromHsl([h, sat, l]); if (bgs.every((b) => contrast(c, b) >= 4.6)) return toHex(c); }
    return C.ink;
  };
  // Dorado legible sobre fondo ink (footer, banda oscura).
  const onInk = (k) => {
    const base = rgb[k]; if (!base || !ink || !cream) return C[k];
    for (let t = 0; t <= 1.0001; t += 0.02) { const c = mix(base, cream, t); if (contrast(c, ink) >= 4.6) return toHex(c); }
    return C.cream;
  };
  // Texto secundario: el más suave que aún cumple 4.6:1.
  let muted = C.ink;
  if (ink && cream) for (let t = 0.6; t >= 0; t -= 0.02) { const c = mix(ink, cream, t); if (bgs.every((b) => contrast(c, b) >= 4.6)) { muted = toHex(c); break; } }
  const on = (k) => { const b = rgb[k]; if (!b || !ink || !white) return C.ink; return contrast(b, ink) >= contrast(b, white) ? C.ink : C.white; };
  const derived = [];
  for (const k of ['coral', 'pink', 'green', 'gold', 'sage']) derived.push(`--c-${k}-strong: ${strong(k)};`);
  derived.push(`--c-gold-on-ink: ${onInk('gold')};`, `--c-muted: ${muted};`, `--c-wa: ${C.whatsapp};`);
  for (const k of Object.keys(C)) derived.push(`--on-${k}: ${on(k)};`);
  derived.push(`--on-wa: ${on('whatsapp')};`);
  // Comprobaciones de contraste del texto principal
  if (ink && cream && contrast(ink, cream) < 4.5) warn('theme.colors: ink sobre cream no alcanza 4.5:1');
  const f = theme.fonts || {};
  return `/* GENERADO por static/build.mjs desde content/site.json → theme. No editar a mano. */
:root {
  ${vars.join('\n  ')}
  ${derived.join('\n  ')}
  --font-heading: ${f.heading || 'Georgia, serif'};
  --font-body: ${f.body || 'system-ui, sans-serif'};
}
`;
}

/* ==========================================================================
   5. Decoración SVG (formas orgánicas, hojas tropicales, brillos dorados)
   ========================================================================== */
let uid = 0;
const BLOBS = [
  'M44.7,-62.4C57.6,-52.3,67.1,-38.2,71.6,-22.6C76.1,-7,75.6,10.1,69.4,24.9C63.2,39.7,51.3,52.2,37.2,60.7C23.1,69.2,6.8,73.7,-9.9,72.3C-26.6,70.9,-43.7,63.6,-55.5,51.3C-67.3,39,-73.8,21.7,-74.2,4.4C-74.6,-12.9,-68.9,-30.2,-57.8,-41.6C-46.7,-53,-30.2,-58.5,-14.6,-65.3C1,-72.1,15.7,-80.2,29,-77C42.3,-73.8,31.8,-72.5,44.7,-62.4Z',
  'M38.9,-51.6C50.4,-44.7,59.6,-33.4,65.1,-19.9C70.6,-6.4,72.4,9.3,67.2,22.4C62,35.5,49.8,46,36.4,54.6C23,63.2,8.4,69.9,-7.4,71.2C-23.2,72.5,-40.2,68.4,-52.3,58.2C-64.4,48,-71.6,31.7,-73.1,15.3C-74.6,-1.1,-70.4,-17.6,-61.6,-30.6C-52.8,-43.6,-39.4,-53.1,-25.8,-59.3C-12.2,-65.5,1.6,-68.4,14.2,-65.3C26.8,-62.2,27.4,-58.5,38.9,-51.6Z',
];
function blob(cls, from, to, which = 0) {
  const id = `g${++uid}`;
  return `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--c-${from})"/><stop offset="1" style="stop-color:var(--c-${to})"/></linearGradient></defs><path transform="translate(100 100)" d="${BLOBS[which % BLOBS.length]}" fill="url(#${id})"/></svg>`;
}
/** Hoja de palmera generada a lo largo de una curva de Bézier. */
function palm(cls, color = 'sage') {
  const P0 = [20, 285], P1 = [110, 120], P2 = [285, 25];
  const at = (t) => [0, 1].map((i) => (1 - t) ** 2 * P0[i] + 2 * (1 - t) * t * P1[i] + t ** 2 * P2[i]);
  const tan = (t) => [0, 1].map((i) => 2 * (1 - t) * (P1[i] - P0[i]) + 2 * t * (P2[i] - P1[i]));
  let leaves = '';
  const n = 13;
  for (let i = 0; i < n; i++) {
    const t = 0.1 + (i / (n - 1)) * 0.86;
    const [x, y] = at(t); const [dx, dy] = tan(t);
    const a = (Math.atan2(dy, dx) * 180) / Math.PI;
    const L = 95 - i * 5.2, W = 9 - i * 0.35;
    for (const s of [-1, 1]) leaves += `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(a + s * 52).toFixed(1)})" d="M0 0Q${L / 2} ${-W} ${L} 0Q${L / 2} ${W} 0 0Z"/>`;
  }
  return `<svg class="${cls}" viewBox="0 0 300 300" aria-hidden="true" focusable="false"><g style="fill:var(--c-${color})">${leaves}</g><path d="M${P0}Q${P1} ${P2}" fill="none" style="stroke:var(--c-${color})" stroke-width="3" stroke-linecap="round"/></svg>`;
}
/** Hoja ancha tropical con nervios. */
function leaf(cls, color = 'green') {
  let veins = '';
  for (let i = 1; i <= 6; i++) { const x = 20 + i * 22; veins += `<path d="M${x} 100 Q${x + 14} ${100 - 22 - i} ${x + 24} ${100 - 34 + i * 2}M${x} 100 Q${x + 14} ${100 + 22 + i} ${x + 24} ${100 + 34 - i * 2}"/>`; }
  return `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><path d="M10 100C40 30 140 20 192 100C140 180 40 170 10 100Z" style="fill:var(--c-${color})"/><g fill="none" style="stroke:var(--c-cream)" stroke-width="2" stroke-linecap="round" opacity=".55"><path d="M10 100H188"/>${veins}</g></svg>`;
}
const SPARK = 'M0 -10C1 -3 3 -1 10 0C3 1 1 3 0 10C-1 3 -3 1 -10 0C-3 -1 -1 -3 0 -10Z';
function sparkles(cls = 'deco-sparkles', count = 14) {
  const pts = [[8, 18, 1.6], [22, 70, 1], [35, 12, .8], [48, 85, 1.3], [58, 30, .7], [66, 62, 1.1], [75, 15, 1.4], [86, 45, .9], [93, 80, 1.2], [15, 50, .6], [40, 48, .5], [80, 88, .7], [52, 8, 1], [97, 22, .6]];
  return `<svg class="${cls}" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${pts.slice(0, count).map(([x, y, s]) => `<path class="sparkle" transform="translate(${x * 10} ${y * 6}) scale(${s})" d="${SPARK}"/>`).join('')}</svg>`;
}
function imgSlot(pathHint) {
  return `<div class="img-slot" aria-hidden="true">${palm('img-slot__art', 'white')}<span class="img-slot__label">${icon('image')} ${UI.imageSlot} · ${esc(pathHint)}</span></div>`;
}
function logoMark(cls = 'logo__mark') {
  const id = `lg${++uid}`;
  const letter = esc((brand.shortName || brand.name || 'I').trim().charAt(0).toUpperCase());
  return `<svg class="${cls}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--c-pink)"/><stop offset=".6" style="stop-color:var(--c-coral)"/><stop offset="1" style="stop-color:var(--c-gold)"/></linearGradient></defs><path d="M20 2C31 2 38 9 38 20S31 38 20 38 2 31 2 20 9 2 20 2Z" fill="url(#${id})"/><text x="20" y="27.5" text-anchor="middle" font-family="Georgia, serif" font-size="21" font-weight="700" font-style="italic" style="fill:var(--c-ink)">${letter}</text><path transform="translate(31 9) scale(.45)" d="${SPARK}" style="fill:var(--c-white)"/></svg>`;
}

/* ==========================================================================
   6. Componentes compartidos
   ========================================================================== */
const SPRITE = readFileSync(join(SRC, 'assets', 'icons.svg'), 'utf8').replace(/<\?xml[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*/g, '');

function businessLd() {
  return {
    '@context': 'https://schema.org', '@type': 'BeautySalon',
    '@id': SITE_URL ? `${SITE_URL}#negocio` : undefined,
    name: brand.name, description: brand.description, slogan: brand.tagline,
    url: SITE_URL || undefined, telephone: contact.phone || undefined, email: contact.email || undefined,
    image: seo.ogImage ? abs(seo.ogImage) || undefined : undefined,
    priceRange: '€€', currenciesAccepted: 'EUR',
    address: { '@type': 'PostalAddress', streetAddress: contact.address, addressLocality: contact.city, postalCode: contact.postalCode, addressCountry: 'ES' },
    hasMap: contact.mapsUrl || undefined,
    sameAs: Object.values(social).filter(Boolean),
  };
}

function waBtn(text, label = UI.whatsapp, cls = 'btn btn--wa') {
  return `<a class="${cls}" href="${esc(waUrl(text))}" target="_blank" rel="noopener">${icon('whatsapp')}<span>${esc(label)}</span><span class="visually-hidden"> ${UI.newTab}</span></a>`;
}
function callBtn(cls = 'btn btn--ghost') {
  return tel ? `<a class="${cls}" href="${tel}">${icon('phone')}<span>${UI.call}</span></a>` : '';
}
function bookingBtn(cls = 'btn btn--green') {
  return contact.bookingUrl ? `<a class="${cls}" href="${esc(contact.bookingUrl)}" target="_blank" rel="noopener">${icon('calendar')}<span>${esc(contact.bookingLabel || 'Reserva online')}</span><span class="visually-hidden"> ${UI.newTab}</span></a>` : '';
}

function header(root, current, hasReservar = true) {
  const a = mk.announcement;
  const announce = a && a.active && a.text
    ? `<div class="announce"><div class="container">${icon('sparkle')}<p style="margin:0">${a.href ? `<a href="${esc(link(a.href, root))}"${extAttrs(a.href)}>${esc(a.text)}</a>` : esc(a.text)}</p></div></div>` : '';
  const navItems = arr(site.nav).map((n) => {
    const cur = current && n.href.replace(/^\/+/, '') === current;
    return `<li><a class="nav__link" href="${esc(link(n.href, root))}"${cur ? ' aria-current="page"' : ''}${extAttrs(n.href)}>${esc(n.label)}</a></li>`;
  }).join('');
  const cta = contact.bookingUrl ? bookingBtn('btn btn--sm header-cta') : `<a class="btn btn--sm header-cta" href="${hasReservar ? '#reservar' : root + 'contacto/'}">${icon('calendar')}<span>${UI.bookCta}</span></a>`;
  return `${announce}
<header class="site-header">
  <div class="container site-header__bar">
    <a class="logo" href="${root || './'}" aria-label="${esc(brand.name)} — ${UI.home}">${logoMark()}<span><span class="logo__text">${esc(brand.logoText || brand.name)}</span><span class="logo__accent">${esc(brand.logoAccent || '')}</span></span></a>
    <nav id="site-nav" class="nav" aria-label="Principal">
      <ul class="nav__list">${navItems}</ul>
      <div class="nav__mobile-cta">${waBtn(contact.whatsappMessage, UI.whatsappLong, 'btn btn--wa btn--block')}${callBtn('btn btn--ghost btn--block')}${bookingBtn('btn btn--green btn--block')}</div>
    </nav>
    <div class="header-actions">
      ${cta}
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="${UI.menuOpen}" data-label-open="${UI.menuOpen}" data-label-close="${UI.menuClose}">${icon('menu', 'icon-open')}${icon('close', 'icon-close')}</button>
    </div>
  </div>
</header>`;
}

function hoursDl(cls = 'hours') {
  const h = arr(contact.hours);
  return h.length ? `<dl class="${cls}">${h.map((x) => `<dt>${esc(x.days)}</dt><dd>${esc(x.time)}</dd>`).join('')}</dl>` : '';
}

function footer(root) {
  const soc = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook']].filter(([k]) => social[k])
    .map(([k, l]) => `<a href="${esc(social[k])}" target="_blank" rel="noopener" aria-label="${l} ${UI.newTab}">${icon(k)}</a>`).join('');
  return `<footer class="site-footer">
  ${leaf('footer-deco', 'sage')}
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="logo" href="${root || './'}" aria-label="${esc(brand.name)} — ${UI.home}">${logoMark()}<span><span class="logo__text">${esc(brand.logoText || brand.name)}</span><span class="logo__accent">${esc(brand.logoAccent || '')}</span></span></a>
        <p style="margin-top:1rem">${esc(brand.tagline)}</p>
        ${soc ? `<div class="social">${soc}</div>` : ''}
      </div>
      <div><h2>Explora</h2><ul class="footer-list">${arr(site.nav).map((n) => `<li><a href="${esc(link(n.href, root))}">${esc(n.label)}</a></li>`).join('')}</ul></div>
      <div><h2>Contacto</h2><ul class="footer-list">
        ${tel ? `<li><a href="${tel}">${icon('phone')}${fill(contact.phoneDisplay || contact.phone)}</a></li>` : ''}
        ${WA ? `<li><a href="${esc(waUrl(contact.whatsappMessage))}" target="_blank" rel="noopener">${icon('whatsapp')}WhatsApp<span class="visually-hidden"> ${UI.newTab}</span></a></li>` : ''}
        ${contact.email ? `<li><a href="mailto:${esc(contact.email)}">${icon('mail')}${fill(contact.email)}</a></li>` : ''}
        <li><span style="display:inline-flex;gap:.45rem;padding-block:.6rem">${icon('pin')}<span>${fill(contact.address)}${contact.city ? `, ${fill(contact.city)}` : ''}</span></span></li>
      </ul></div>
      <div><h2>Horario</h2>${hoursDl()}</div>
    </div>
    <div class="footer-bottom">
      <p style="margin:0">© <span data-year>${new Date().getFullYear()}</span> ${esc(brand.name)}${legal.companyName ? ` · ${fill(legal.companyName)}` : ''}</p>
      <ul class="footer-list" style="display:flex;flex-wrap:wrap;gap:0 1.25rem">
        <li><a href="${root}privacidad/">Privacidad</a></li><li><a href="${root}aviso-legal/">Aviso legal</a></li><li><a href="${root}cookies/">Cookies</a></li>
      </ul>
    </div>
  </div>
</footer>`;
}

function fabs() {
  return `<div class="fab-stack">
  ${tel ? `<a class="fab fab--call" href="${tel}" aria-label="${UI.call} ${esc(contact.phoneDisplay || contact.phone)}">${icon('phone')}</a>` : ''}
  ${WA ? `<a class="fab fab--wa" href="${esc(waUrl(contact.whatsappMessage))}" target="_blank" rel="noopener" aria-label="${UI.whatsappLong} ${UI.newTab}">${icon('whatsapp')}<span class="fab__label" aria-hidden="true">${UI.whatsapp}</span></a>` : ''}
</div>`;
}

function ctaReservar(root, { waText, title = '¿Te reservamos un hueco?', text } = {}) {
  return `<section class="section" id="reservar" aria-labelledby="reservar-title">
  <div class="container">
    <div class="cta-band reveal">
      ${leaf('cta-band__deco cta-band__deco--l', 'sage')}${palm('cta-band__deco cta-band__deco--r', 'pink')}
      <p class="eyebrow">Reserva fácil</p>
      <h2 id="reservar-title">${esc(title)}</h2>
      <p>${esc(text || 'Escríbenos por WhatsApp, llámanos o déjanos tus datos. Te respondemos rápido y te asesoramos sin compromiso.')}</p>
      <div class="btn-row">
        ${waBtn(waText || contact.whatsappMessage, UI.whatsappLong)}
        ${bookingBtn()}
        ${callBtn()}
        <a class="btn btn--ghost" href="${root}contacto/">${icon('mail')}<span>${UI.form}</span></a>
      </div>
    </div>
  </div>
</section>`;
}

/* ==========================================================================
   7. Layout
   ========================================================================== */
const pages = []; // para sitemap
function layout({ path, title, description, body, ld = [], current = '', ogType = 'website', noindex = false, base = '', cta = {}, ogImage, rootOverride }) {
  const depth = path ? path.split('/').filter(Boolean).length : 0;
  const root = rootOverride ?? '../'.repeat(depth);
  const fullTitle = title ? `${title}${seo.titleSuffix || ''}` : `${brand.name} — ${brand.tagline}`;
  const desc = (description || seo.defaultDescription || brand.description || '').slice(0, 300);
  const url = SITE_URL ? new URL(path, SITE_URL).href : '';
  const og = ogImage || seo.ogImage;
  const ogAbs = og ? (ext(og) ? og : abs(og) || root + og) : '';
  const fontsUrl = theme.fonts?.googleFontsUrl;
  return `<!doctype html>
<html lang="es" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base ? `<base href="${esc(base)}">\n` : ''}<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}${url && !noindex ? `<link rel="canonical" href="${esc(url)}">\n` : ''}<meta name="theme-color" content="${esc(C.cream)}">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
${fontsUrl ? `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${esc(fontsUrl)}">\n` : ''}<link rel="stylesheet" href="${root}css/theme.css?v=${VERSION}">
<link rel="stylesheet" href="${root}css/main.css?v=${VERSION}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(brand.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:locale" content="${esc(seo.locale || 'es_ES')}">
${url ? `<meta property="og:url" content="${esc(url)}">\n` : ''}${ogAbs ? `<meta property="og:image" content="${esc(ogAbs)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<script>document.documentElement.className=document.documentElement.className.replace('no-js','js');</script>
${[businessLd(), ...ld].map(jsonLd).join('\n')}
</head>
<body>
${SPRITE}
<a class="skip-link" href="#main">${UI.skip}</a>
${header(root, current, cta !== false || path === '' || path === 'contacto/')}
<main id="main" tabindex="-1">
${body(root)}
${cta === false ? '' : ctaReservar(root, cta)}
</main>
${footer(root)}
${fabs()}
<script src="${root}js/main.js?v=${VERSION}" defer></script>
</body>
</html>
`;
}

function writePage(path, html, { sitemap = true, file } = {}) {
  const out = file ? join(DIST, file) : join(DIST, path, 'index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  if (sitemap) pages.push(path);
}

function pageHero({ root, crumbs = [], eyebrow, title, lead, extra = '', id = 'page-title' }) {
  return `<section class="page-hero" aria-labelledby="${id}">
  <div class="hero__layer" data-speed="0.12">${blob('deco-blob-a', 'pink', 'coral', 1)}</div>
  <div class="hero__layer" data-speed="0.3">${palm('deco-leaf-b', 'sage')}</div>
  <div class="hero__layer" data-speed="0.45">${sparkles('deco-sparkles', 7)}</div>
  <div class="container">
    ${crumbs.length ? breadcrumbs(root, crumbs) : ''}
    ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
    <h1 id="${id}">${title}</h1>
    ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
    ${extra}
  </div>
</section>`;
}
function breadcrumbs(root, crumbs) {
  const all = [{ label: UI.home, href: root || './' }, ...crumbs];
  return `<nav class="breadcrumbs" aria-label="Migas de pan"><ol>${all.map((c, i) => i === all.length - 1 ? `<li><span aria-current="page">${esc(c.label)}</span></li>` : `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`).join('')}</ol></nav>`;
}
function breadcrumbLd(crumbs) {
  if (!SITE_URL) return null;
  const all = [{ label: UI.home, path: '' }, ...crumbs];
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: all.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, item: new URL(c.path, SITE_URL).href })) };
}
function faqLd(items) {
  const f = arr(items).filter((x) => x.q && x.a);
  return f.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: f.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) } : null;
}
function faqList(items) {
  return `<div class="faq">${arr(items).map((f) => `<details class="reveal"><summary>${esc(f.q)}</summary><div class="faq__a"><p>${esc(f.a)}</p></div></details>`).join('')}</div>`;
}

function treatmentImage(t) { return findImage(t.image, `tratamientos/${t.id}`); }
function treatmentCard(t, root, i = 0) {
  const cat = catById[t.category];
  const img = treatmentImage(t);
  const pf = priceFromOf(t);
  return `<article class="card reveal tone-${(i % 5) + 1}" style="--i:${i % 4}">
  ${img ? `<div class="card__thumb"><img src="${esc(imgSrc(img, root))}" alt="${esc(t.imageAlt || '')}" loading="lazy" decoding="async"></div>` : `<span class="card__icon">${icon(ic(t.icon || cat?.icon))}</span>`}
  ${cat ? `<span class="card__cat">${esc(cat.name)}</span>` : ''}
  <h3><a class="card__link" href="${root}tratamientos/${esc(t.id)}/">${esc(t.name)}</a></h3>
  <p>${esc(t.short)}</p>
  <div class="card__meta">${t.duration ? `<span>${icon('clock')}${esc(t.duration)}</span>` : ''}${isFinite(pf) ? `<span class="card__price">${UI.from} ${money(pf)}</span>` : ''}</div>
  <span class="card__more" aria-hidden="true">${UI.seeFicha} ${icon('arrow')}</span>
</article>`;
}

function contactInfo(root) {
  return `<ul class="info-list">
    <li><span class="card__icon tone-1">${icon('pin')}</span><span><strong>Dirección</strong>${fill(contact.address)}${contact.postalCode ? `, ${fill(contact.postalCode)}` : ''} ${fill(contact.city)}${contact.mapsUrl ? `<br><a href="${esc(contact.mapsUrl)}" target="_blank" rel="noopener">Cómo llegar<span class="visually-hidden"> ${UI.newTab}</span></a>` : ''}</span></li>
    ${tel ? `<li><span class="card__icon tone-2">${icon('phone')}</span><span><strong>Teléfono</strong><a href="${tel}">${fill(contact.phoneDisplay || contact.phone)}</a></span></li>` : ''}
    ${WA ? `<li><span class="card__icon tone-3">${icon('whatsapp')}</span><span><strong>WhatsApp</strong><a href="${esc(waUrl(contact.whatsappMessage))}" target="_blank" rel="noopener">Escríbenos<span class="visually-hidden"> ${UI.newTab}</span></a></span></li>` : ''}
    ${contact.email ? `<li><span class="card__icon tone-4">${icon('mail')}</span><span><strong>Email</strong><a href="mailto:${esc(contact.email)}">${fill(contact.email)}</a></span></li>` : ''}
    <li><span class="card__icon tone-5">${icon('clock')}</span><span><strong>Horario</strong>${hoursDl()}</span></li>
  </ul>`;
}
function mapBlock() {
  if (contact.mapsEmbed) return `<div class="map"><iframe src="${esc(contact.mapsEmbed)}" title="Mapa: ubicación de ${esc(brand.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
  const img = findImage(contact.image, 'local');
  return `<div class="map">${img ? `<img src="${esc(img)}" alt="${esc(contact.imageAlt || `Fachada de ${brand.name}`)}" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : imgSlot('static/src/assets/img/local.jpg (o contact.mapsEmbed)')}</div>`;
}

/** Formulario: POST a contact.formEndpoint si existe; si no, abre WhatsApp con los datos. */
function formAttrs(kind, intro) {
  const ep = contact.formEndpoint;
  const common = `data-form="${kind}" data-wa="${WA}" data-wa-intro="${esc(intro)}" data-msg-invalid="Revisa los campos obligatorios marcados." data-msg-ok="¡Gracias! Te responderemos muy pronto." data-msg-error="No se pudo enviar. Prueba por WhatsApp o teléfono." data-msg-wa="Abriendo WhatsApp con tu mensaje…" data-msg-sending="Enviando…" novalidate`;
  return ep ? `action="${esc(ep)}" method="post" data-endpoint="${esc(ep)}" ${common}` : `action="https://wa.me/${WA}" method="get" target="_blank" ${common}`;
}
function privacyCheck(root, id) {
  return `<div class="check"><input type="checkbox" id="${id}" name="privacidad" value="acepto" required aria-required="true"><label for="${id}">${esc(legal.privacyText || 'He leído y acepto la política de privacidad.')} <a href="${root}privacidad/">Ver política de privacidad</a>. <span aria-hidden="true">*</span></label></div>`;
}
function contactForm(root, preselect = '') {
  const ep = contact.formEndpoint;
  const opts = categories.map((c) => {
    const ts = byCat(c.id); if (!ts.length) return '';
    return `<optgroup label="${esc(c.name)}">${ts.map((t) => `<option${t.name === preselect ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`;
  }).join('');
  return `<form class="form form--card" ${formAttrs('contact', contact.whatsappMessage || 'Hola')} aria-labelledby="form-title">
    <h2 id="form-title" style="font-size:1.6rem">Cuéntanos qué te apetece</h2>
    <p class="form__hint">Los campos con * son obligatorios.</p>
    <div class="form__row">
      <div class="field"><label for="f-name">Nombre *</label><input id="f-name" name="nombre" autocomplete="name" required aria-required="true" data-wa-label="Nombre"></div>
      <div class="field"><label for="f-tel">Teléfono *</label><input id="f-tel" name="telefono" type="tel" autocomplete="tel" inputmode="tel" required aria-required="true" data-wa-label="Teléfono"></div>
    </div>
    <div class="form__row">
      <div class="field"><label for="f-email">Email <span class="opt">(opcional)</span></label><input id="f-email" name="email" type="email" autocomplete="email" data-wa-label="Email"></div>
      <div class="field"><label for="f-pref">Prefiero que me atendáis <span class="opt">(opcional)</span></label><select id="f-pref" name="preferencia" data-wa-label="Preferencia"><option value="">Indiferente</option><option>Por la mañana</option><option>Por la tarde</option></select></div>
    </div>
    <div class="field"><label for="f-tr">Tratamiento de interés <span class="opt">(opcional)</span></label><select id="f-tr" name="tratamiento" data-wa-label="Tratamiento"><option value="">Aún no lo sé, quiero asesoramiento</option>${opts}</select></div>
    <div class="field"><label for="f-msg">Mensaje <span class="opt">(opcional)</span></label><textarea id="f-msg" name="${ep ? 'mensaje' : 'text'}" data-wa-label="Mensaje"></textarea></div>
    <div class="hp" aria-hidden="true"><label for="f-gotcha">No rellenar</label><input id="f-gotcha" name="_gotcha" tabindex="-1" autocomplete="off"></div>
    ${privacyCheck(root, 'f-priv')}
    <button class="btn btn--block" type="submit">${icon(ep ? 'mail' : 'whatsapp')}<span>${ep ? 'Enviar solicitud' : 'Enviar por WhatsApp'}</span></button>
    <p class="form__status" role="status" aria-live="polite"></p>
  </form>`;
}

/* ==========================================================================
   8. Páginas
   ========================================================================== */
const featured = (() => { const f = treatments.filter((t) => t.featured); return (f.length ? f : treatments).slice(0, 6); })();
const activePromos = arr(mk.promos).filter((p) => p.active !== false);

/* ---------- Inicio ---------- */
function pageHome() {
  const h = site.hero || {};
  const heroImg = findImage(h.image, 'hero');
  const testi = site.testimonials || {};
  const lm = mk.leadMagnet;
  const statsHtml = arr(site.stats).length ? `<div class="container stats"><ul class="stats__list reveal">${arr(site.stats).map((s) => `<li class="stat"><span class="stat__value">${esc(s.value)}</span><span class="stat__label">${esc(s.label)}</span></li>`).join('')}</ul></div>` : '';
  const body = (root) => `
<section class="hero" aria-labelledby="hero-title" data-parallax-scope>
  <div class="hero__layer" data-speed="0.08">${blob('deco-blob-a', 'pink', 'coral', 0)}${blob('deco-blob-b', 'sage', 'cream', 1)}</div>
  <div class="hero__layer" data-speed="0.18">${blob('deco-blob-c', 'gold', 'pink', 1)}</div>
  <div class="hero__layer" data-speed="0.32">${palm('deco-leaf-a', 'sage')}${palm('deco-leaf-b', 'green')}${leaf('deco-leaf-c', 'sage')}</div>
  <div class="hero__layer" data-speed="0.5">${sparkles()}</div>
  <div class="container hero__inner">
    <div>
      ${h.eyebrow ? `<p class="eyebrow">${esc(h.eyebrow)}</p>` : ''}
      <h1 id="hero-title">${esc(h.title)} ${h.titleAccent ? `<span class="accent">${esc(h.titleAccent)}</span>` : ''}</h1>
      ${h.subtitle ? `<p class="hero__subtitle">${esc(h.subtitle)}</p>` : ''}
      <div class="btn-row">
        ${h.ctaPrimary ? `<a class="btn" href="${esc(link(h.ctaPrimary.href, root))}"${extAttrs(h.ctaPrimary.href)}>${icon('calendar')}<span>${esc(h.ctaPrimary.label)}</span></a>` : ''}
        ${h.ctaSecondary ? `<a class="btn btn--ghost" href="${esc(link(h.ctaSecondary.href, root))}"${extAttrs(h.ctaSecondary.href)}><span>${esc(h.ctaSecondary.label)}</span>${icon('arrow')}</a>` : ''}
      </div>
      <ul class="hero__chips">${arr(site.whyUs).slice(0, 3).map((w) => `<li class="chip">${icon(ic(w.icon))}${esc(w.title)}</li>`).join('')}</ul>
    </div>
    <div class="hero__visual">
      <div class="arch__ring" aria-hidden="true"></div>
      <div class="arch">${heroImg ? `<img src="${esc(imgSrc(heroImg, root))}" alt="${esc(h.imageAlt || '')}" fetchpriority="high">` : imgSlot('static/src/assets/img/hero.jpg')}</div>
      ${arr(site.stats)[1] ? `<div class="float-card float-card--a" aria-hidden="true">${icon('heart')}<span><strong>${esc(site.stats[1].value)}</strong>${esc(site.stats[1].label)}</span></div>` : ''}
      ${arr(site.stats)[0] ? `<div class="float-card float-card--b" aria-hidden="true">${icon('sparkle')}<span><strong>${esc(site.stats[0].value)}</strong>${esc(site.stats[0].label)}</span></div>` : ''}
    </div>
  </div>
</section>
${statsHtml}

${categories.length ? `<section class="section" aria-labelledby="cats-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Qué hacemos</p><h2 id="cats-title">Encuentra tu <span class="accent">tratamiento</span></h2><p>Elige una categoría y descubre cada tratamiento explicado paso a paso.</p></div>
    <div class="grid grid--3">${categories.map((c, i) => `<article class="card cat-card reveal tone-${(i % 5) + 1}" style="--i:${i % 3}">
      <span class="card__icon">${icon(ic(c.icon))}</span>
      <h3><a class="card__link" href="${root}tratamientos/#${esc(c.id)}">${esc(c.name)}</a></h3>
      ${c.intro ? `<p>${esc(c.intro)}</p>` : ''}
      <span class="cat-card__count">${byCat(c.id).length} ${byCat(c.id).length === 1 ? 'tratamiento' : 'tratamientos'}</span>
    </article>`).join('')}</div>
  </div>
</section>` : ''}

${featured.length ? `<section class="section section--white" aria-labelledby="feat-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Los más pedidos</p><h2 id="feat-title">Tratamientos <span class="accent">estrella</span></h2></div>
    <div class="grid grid--3">${featured.map((t, i) => treatmentCard(t, root, i)).join('')}</div>
    <p style="margin-top:2rem"><a class="link-arrow" href="${root}tratamientos/">${UI.seeAll} ${icon('arrow')}</a></p>
  </div>
</section>` : ''}

${arr(site.whyUs).length ? `<section class="section" aria-labelledby="why-title">
  <div class="container">
    <div class="section__head section__head--center"><p class="eyebrow">Por qué nosotras</p><h2 id="why-title">Belleza con <span class="accent">cabeza</span> (y corazón)</h2></div>
    <div class="grid grid--4">${arr(site.whyUs).map((w, i) => `<article class="card why reveal" style="--i:${i}"><span class="card__icon">${icon(ic(w.icon))}</span><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></article>`).join('')}</div>
  </div>
</section>` : ''}

${packs.aloha || packs.ohana ? `<section class="section section--nude" aria-labelledby="clubs-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Ventajas exclusivas</p><h2 id="clubs-title">Packs <span class="accent">Aloha</span> &amp; Ohana</h2></div>
    <div class="duo">${['aloha', 'ohana'].filter((k) => packs[k]).map((k) => { const p = packs[k]; return `<article class="club club--${k} reveal">
      ${k === 'aloha' ? palm('club__deco', 'white') : leaf('club__deco', 'white')}
      <p class="club__subtitle">${esc(p.subtitle)}</p>
      <h3 class="club__name">${esc(p.name)}</h3>
      <p>${esc(p.description)}</p>
      ${arr(p.perks).length ? `<ul class="checklist">${arr(p.perks).slice(0, 3).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      <p><a class="btn btn--ink" href="${root}packs/#${k}">${esc(p.cta || UI.seeMore)} ${icon('arrow')}</a></p>
    </article>`; }).join('')}</div>
  </div>
</section>` : ''}

${activePromos.length ? `<section class="section" aria-labelledby="promos-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Solo por tiempo limitado</p><h2 id="promos-title">Promos que <span class="accent">enamoran</span></h2></div>
    <div class="grid grid--3">${activePromos.map(promoCard).join('')}</div>
  </div>
</section>` : ''}

${arr(testi.items).length ? `<section class="section section--white" aria-labelledby="reviews-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Opiniones</p><h2 id="reviews-title">Lo que dicen <span class="accent">de nosotras</span></h2></div>
    ${testi.isPlaceholder ? `<div class="notice" role="note">${icon('info')}<p><strong>Ejemplo.</strong> ${UI.reviewsNotice}</p></div>` : ''}
    <div class="grid grid--3">${arr(testi.items).map((r, i) => `<figure class="card review reveal${testi.isPlaceholder ? ' review--placeholder' : ''}" style="--i:${i}">
      ${testi.isPlaceholder ? '<span class="tag-example">Ejemplo</span>' : `<span class="stars" role="img" aria-label="5 de 5 estrellas">${icon('star').repeat(5)}</span>`}
      <blockquote><p style="margin:0">${esc(r.text)}</p></blockquote>
      <figcaption><strong>${esc(r.name)}</strong>${r.treatment ? esc(r.treatment) : ''}</figcaption>
    </figure>`).join('')}</div>
  </div>
</section>` : ''}

${lm && lm.title ? `<section class="section" aria-labelledby="lead-title">
  <div class="container">
    <div class="lead-box reveal">
      ${sparkles('lead-box__deco', 6)}
      <div><p class="eyebrow">Regalo</p><h2 id="lead-title">${esc(lm.title)}</h2><p>${esc(lm.text)}</p></div>
      <form class="form" ${formAttrs('lead', lm.title)} aria-labelledby="lead-title">
        <div class="field"><label for="l-email">Tu email *</label><input id="l-email" name="email" type="email" autocomplete="email" required aria-required="true" data-wa-label="Email"></div>
        <div class="hp" aria-hidden="true"><label for="l-gotcha">No rellenar</label><input id="l-gotcha" name="_gotcha" tabindex="-1" autocomplete="off"></div>
        <input type="hidden" name="origen" value="lead-magnet">
        ${privacyCheck(root, 'l-priv')}
        <button class="btn" type="submit">${icon('gift')}<span>${esc(lm.cta || 'Quiero recibirla')}</span></button>
        <p class="form__status" role="status" aria-live="polite"></p>
      </form>
    </div>
  </div>
</section>` : ''}

${arr(mk.faqGeneral).length ? `<section class="section section--sage" aria-labelledby="faq-title">
  <div class="container container--narrow">
    <div class="section__head section__head--center"><p class="eyebrow">Dudas frecuentes</p><h2 id="faq-title">Preguntas <span class="accent">frecuentes</span></h2></div>
    ${faqList(mk.faqGeneral)}
  </div>
</section>` : ''}
`;
  const contactSection = (root) => `<section class="section section--white" id="contacto" aria-labelledby="contact-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Visítanos</p><h2 id="contact-title">Ven a <span class="accent">conocernos</span></h2></div>
    <div class="contact-grid"><div>${contactInfo(root)}<div class="btn-row">${waBtn(contact.whatsappMessage, UI.whatsappLong)}${callBtn()}</div></div>${mapBlock()}</div>
  </div>
</section>`;
  // En portada: CTA reservar antes del bloque de contacto
  const html = layout({
    path: '', title: '', description: seo.defaultDescription, current: '',
    body: (root) => body(root) + ctaReservar(root) + contactSection(root), cta: false,
    ld: [faqLd(mk.faqGeneral)].filter(Boolean),
  });
  writePage('', html);
}

function promoCard(p, i = 0) {
  return `<article class="card promo reveal" style="--i:${i % 3}">
    ${p.badge ? `<span class="promo__badge">${esc(p.badge)}</span>` : ''}
    <h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>
    ${p.validity ? `<span class="promo__validity">${icon('clock')}${esc(p.validity)}</span>` : ''}
  </article>`;
}

/* ---------- Catálogo ---------- */
function pageCatalog() {
  const html = layout({
    path: 'tratamientos/', current: 'tratamientos/', title: 'Tratamientos',
    description: `Catálogo de tratamientos de ${brand.name}: ${categories.map((c) => c.name).join(', ')}. Explicados paso a paso, con duración y precio orientativo.`,
    ld: [breadcrumbLd([{ label: 'Tratamientos', path: 'tratamientos/' }])].filter(Boolean),
    body: (root) => `
${pageHero({ root, crumbs: [{ label: 'Tratamientos' }], eyebrow: 'Catálogo', title: `Todos nuestros <span class="accent">tratamientos</span>`, lead: 'Cada tratamiento tiene su ficha: qué es, para quién, cómo es la sesión, cuidados, contraindicaciones y precio orientativo.' })}
<section class="section" aria-label="Listado de tratamientos">
  <div class="container">
    <div class="filters js-only" role="group" aria-label="Filtrar por categoría" data-filter-bar>
      <button class="filter-btn" type="button" data-filter="all" aria-pressed="true">Todos</button>
      ${categories.filter((c) => byCat(c.id).length).map((c) => `<button class="filter-btn" type="button" data-filter="${esc(c.id)}" aria-pressed="false">${icon(ic(c.icon))}${esc(c.name)}</button>`).join('')}
    </div>
    <p id="filter-status" class="visually-hidden" role="status" aria-live="polite"></p>
    ${categories.filter((c) => byCat(c.id).length).map((c) => `<section class="cat-group" id="${esc(c.id)}" data-cat-group="${esc(c.id)}" aria-labelledby="h-${esc(c.id)}">
      <div class="cat-group__head"><span class="card__icon tone-2">${icon(ic(c.icon))}</span><div><h2 id="h-${esc(c.id)}">${esc(c.name)}</h2>${c.intro ? `<p>${esc(c.intro)}</p>` : ''}</div></div>
      <div class="grid grid--3">${byCat(c.id).map((t, i) => treatmentCard(t, root, i)).join('')}</div>
    </section>`).join('')}
    ${treatments.filter((t) => !catById[t.category]).length ? `<section class="cat-group" data-cat-group="otros" aria-labelledby="h-otros"><h2 id="h-otros">Otros</h2><div class="grid grid--3">${treatments.filter((t) => !catById[t.category]).map((t, i) => treatmentCard(t, root, i)).join('')}</div></section>` : ''}
  </div>
</section>`,
  });
  writePage('tratamientos/', html);
}

/* ---------- Ficha de tratamiento ---------- */
function pageTreatment(t) {
  const cat = catById[t.category];
  const path = `tratamientos/${t.id}/`;
  const img = treatmentImage(t);
  const pf = priceFromOf(t);
  const pain = Number(t.painLevel);
  const waText = waFor(t.name);
  const related = (() => {
    const same = treatments.filter((x) => x.category === t.category && x.id !== t.id);
    const rest = featured.filter((x) => x.id !== t.id && !same.includes(x));
    return [...same, ...rest].slice(0, 3);
  })();
  const S = []; // secciones presentes (para el subíndice)
  const sec = (id, title, iconName, inner, cls = '') => { S.push([id, title]); return `<section class="ficha-section reveal ${cls}" id="${id}" aria-labelledby="${id}-t"><h2 id="${id}-t"><span class="card__icon">${icon(iconName)}</span>${esc(title)}</h2>${inner}</section>`; };

  const prices = arr(t.prices);
  const priceRows = prices.length ? prices.map((p) => `<tr><th scope="row">${esc(p.label)}${p.note ? `<br><span class="small">${esc(p.note)}</span>` : ''}</th><td class="num">${isNum(p.oldPrice) && p.oldPrice > p.price ? `<del><span class="visually-hidden">Antes </span>${money(p.oldPrice)}</del>` : ''}<span class="price">${money(p.price)}</span>${saving(p.price, p.oldPrice) ? `<br>${savingHtml(saving(p.price, p.oldPrice))}` : ''}</td></tr>`).join('')
    : `<tr><th scope="row">${esc(t.name)}</th><td class="num"><span class="price">${isFinite(pf) ? `${UI.from} ${money(pf)}` : UI.consult}</span></td></tr>`;

  const sections = [
    t.whatIs ? sec('que-es', '¿Qué es?', 'info', `<div class="prose"><p>${esc(t.whatIs)}</p></div>`) : '',
    arr(t.benefits).length ? sec('beneficios', 'Beneficios y ventajas', 'sparkle', `<div class="grid grid--3">${arr(t.benefits).map((b, i) => `<article class="card tone-${(i % 5) + 1}"><span class="card__icon">${icon('check')}</span><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></article>`).join('')}</div>`) : '',
    arr(t.idealFor).length ? sec('para-quien', '¿Para quién es?', 'heart', `<div class="panel"><ul class="checklist">${arr(t.idealFor).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul></div>`) : '',
    arr(t.howItWorks).length ? sec('sesion', '¿Cómo es la sesión?', 'clock', `<ol class="steps">${arr(t.howItWorks).map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>`) : '',
    t.results ? sec('resultados', 'Resultados', 'star', `<div class="results">${icon('glow')}<div><p>${esc(t.results)}</p><p class="small" style="margin-top:.5rem">Los resultados varían según cada persona. Te lo explicamos en la valoración previa.</p></div></div>`) : '',
    (arr(t.aftercare).length || arr(t.contraindications).length) ? (() => {
      S.push(['cuidados', 'Cuidados y contraindicaciones']);
      return `<div class="ficha-section two-col reveal" id="cuidados">
        ${arr(t.aftercare).length ? `<section class="panel" aria-labelledby="cuidados-t"><h2 id="cuidados-t">${icon('leaf')}Cuidados posteriores</h2><ul class="dotlist">${arr(t.aftercare).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
        ${arr(t.contraindications).length ? `<section class="panel panel--warn" id="contraindicaciones" aria-labelledby="contra-t"><h2 id="contra-t">${icon('alert')}Contraindicaciones</h2><ul class="dotlist">${arr(t.contraindications).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="small" style="margin:1rem 0 0">Si tienes dudas sobre tu caso, consúltanos antes de reservar.</p></section>` : ''}
      </div>`;
    })() : '',
    arr(t.faq).length ? sec('preguntas', 'Preguntas frecuentes', 'info', faqList(t.faq)) : '',
    sec('precios', 'Precios', 'gift', `<div class="price-table"><div class="table-scroll"><table><caption class="visually-hidden">Precios de ${esc(t.name)}</caption><thead><tr><th scope="col">Opción</th><th scope="col" class="num">Precio</th></tr></thead><tbody>${priceRows}</tbody></table></div></div>
      <p class="disclaimer">${icon('info')}<span>${esc(t.priceNote ? `${t.priceNote}. ` : '')}${esc(legal.priceDisclaimer)}</span></p>
      <div class="btn-row" style="margin-top:1.25rem">${waBtn(waText, `Reservar ${t.name}`)}${bookingBtn()}${callBtn()}</div>`),
  ].join('\n');

  const facts = [
    t.duration ? ['clock', 'Duración', esc(t.duration)] : null,
    t.sessions ? ['calendar', 'Sesiones', esc(t.sessions)] : null,
    Number.isFinite(pain) ? ['heart', 'Molestia', `${esc(PAIN(pain))}<span class="pain" role="img" aria-label="${pain} de 5">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= pain ? 'on' : ''}"></span>`).join('')}</span>`] : null,
    isFinite(pf) ? ['gift', 'Precio', `${UI.from} ${money(pf)}`] : null,
  ].filter(Boolean);

  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'Service', name: t.name, description: t.whatIs || t.short,
      serviceType: cat?.name, url: SITE_URL ? new URL(path, SITE_URL).href : undefined,
      image: img ? abs(img) || undefined : undefined,
      provider: { '@type': 'BeautySalon', name: brand.name, '@id': SITE_URL ? `${SITE_URL}#negocio` : undefined },
      areaServed: contact.city && !/POR DEFINIR/i.test(contact.city) ? contact.city : undefined,
      offers: prices.filter((p) => isNum(p.price) && p.price > 0).map((p) => ({ '@type': 'Offer', name: p.label, price: p.price, priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url: SITE_URL ? new URL(path, SITE_URL).href : undefined })),
    },
    faqLd(t.faq),
    breadcrumbLd([{ label: 'Tratamientos', path: 'tratamientos/' }, { label: t.name, path }]),
  ].filter(Boolean);

  const html = layout({
    path, current: 'tratamientos/', title: t.name, ogType: 'article', ogImage: img && !ext(img) ? img : undefined,
    description: [t.short, t.hook].filter(Boolean).join(' ').slice(0, 160) || seo.defaultDescription,
    cta: { waText, title: `¿Reservamos tu sesión de ${t.name}?` },
    ld,
    body: (root) => {
      const hero = pageHero({
        root, id: 'ficha-title',
        crumbs: [{ label: 'Tratamientos', href: `${root}tratamientos/` }, ...(cat ? [{ label: cat.name, href: `${root}tratamientos/#${cat.id}` }] : []), { label: t.name }],
        eyebrow: cat?.name, title: esc(t.name),
        extra: '',
      });
      // Insertamos el bloque de ficha (hook, datos rápidos, CTA, imagen) dentro del hero
      const heroInner = `<div class="ficha-hero__grid">
        <div>
          ${t.hook ? `<p class="lead" style="font-family:var(--font-heading);font-style:italic;color:var(--c-ink);font-size:clamp(1.25rem,1.1rem + .8vw,1.65rem)">${esc(t.hook)}</p>` : ''}
          ${t.short ? `<p class="lead">${esc(t.short)}</p>` : ''}
          ${facts.length ? `<ul class="facts">${facts.map(([i, l, v]) => `<li class="fact"><span class="fact__label">${icon(i)}${l}</span><span class="fact__value">${v}</span></li>`).join('')}</ul>` : ''}
          <div class="btn-row">${waBtn(waText, 'Reservar por WhatsApp')}${bookingBtn()}<a class="btn btn--ghost" href="#precios">Ver precios</a></div>
        </div>
        <div class="media">${img ? `<img src="${esc(imgSrc(img, root))}" alt="${esc(t.imageAlt || t.name)}" fetchpriority="high">` : imgSlot(`static/src/assets/img/tratamientos/${t.id}.jpg`)}</div>
      </div>`;
      const heroHtml = hero.replace('</h1>', `</h1>${heroInner}`);
      const subnav = `<nav class="ficha-nav" aria-label="En esta ficha"><div class="container"><ul>${S.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></div></nav>`;
      const rel = related.length ? `<section class="section section--white" aria-labelledby="rel-title"><div class="container"><div class="section__head"><p class="eyebrow">Combina bien con</p><h2 id="rel-title">Tratamientos <span class="accent">relacionados</span></h2></div><div class="grid grid--3">${related.map((x, i) => treatmentCard(x, root, i)).join('')}</div></div></section>` : '';
      return `${heroHtml}\n${subnav}\n<div class="section"><div class="container">${sections}</div></div>\n${rel}`;
    },
  });
  writePage(path, html);
}

/* ---------- Precios ---------- */
function pagePrices() {
  const cats = categories.filter((c) => byCat(c.id).length);
  const table = (c) => {
    const rows = byCat(c.id).map((t) => {
      const ps = arr(t.prices).length ? arr(t.prices) : [{ label: t.priceFrom ? 'Desde' : '—', price: t.priceFrom }];
      return ps.map((p, i) => `<tr>${i === 0 ? `<th scope="rowgroup" rowspan="${ps.length}"><a href="../tratamientos/${esc(t.id)}/">${esc(t.name)}</a>${t.priceNote ? `<br><span class="small">${esc(t.priceNote)}</span>` : ''}</th>` : ''}<td>${esc(p.label)}${p.note ? `<br><span class="small">${esc(p.note)}</span>` : ''}</td><td class="num">${isNum(p.oldPrice) && p.oldPrice > p.price ? `<del><span class="visually-hidden">Antes </span>${money(p.oldPrice)}</del>` : ''}<span class="price">${money(p.price)}</span>${saving(p.price, p.oldPrice) ? `<br>${savingHtml(saving(p.price, p.oldPrice))}` : ''}</td></tr>`).join('');
    }).join('');
    return `<div class="price-table"><div class="table-scroll"><table><caption class="visually-hidden">Precios: ${esc(c.name)}</caption><thead><tr><th scope="col">Tratamiento</th><th scope="col">Opción</th><th scope="col" class="num">Precio</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  };
  const html = layout({
    path: 'precios/', current: 'precios/', title: 'Precios',
    description: `Precios orientativos de ${brand.name}: ${cats.map((c) => c.name).join(', ')}. Packs y bonos con descuento.`,
    ld: [breadcrumbLd([{ label: 'Precios', path: 'precios/' }])].filter(Boolean),
    body: (root) => `
${pageHero({ root, crumbs: [{ label: 'Precios' }], eyebrow: 'Tarifas', title: `Precios <span class="accent">claros</span>, sin sorpresas`, lead: legal.priceDisclaimer })}
<section class="section" aria-label="Tablas de precios">
  <div class="container">
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist" aria-label="Categorías de precios" hidden>
        ${cats.map((c, i) => `<button class="tabs__tab" type="button" role="tab" id="tab-${esc(c.id)}" aria-controls="precios-${esc(c.id)}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${icon(ic(c.icon))}${esc(c.name)}</button>`).join('')}
      </div>
      ${cats.map((c) => `<div class="tabs__panel" id="precios-${esc(c.id)}" aria-labelledby="tab-${esc(c.id)}">
        <h2 data-tab-heading>${esc(c.name)}</h2>
        ${table(c)}
      </div>`).join('')}
    </div>
    <p class="disclaimer">${icon('info')}<span>${esc(legal.priceDisclaimer)}</span></p>
    <p><a class="link-arrow" href="${root}packs/">Ahorra con packs y bonos ${icon('arrow')}</a></p>
  </div>
</section>`,
  });
  writePage('precios/', html);
}

/* ---------- Packs ---------- */
function pagePacks() {
  const list = arr(packs.packs);
  const bonos = arr(packs.bonos);
  const club = (k) => {
    const p = packs[k]; if (!p) return '';
    const img = findImage(p.image, k);
    return `<article class="club club--${k} reveal" id="${k}" aria-labelledby="${k}-t">
      ${k === 'aloha' ? palm('club__deco', 'white') : leaf('club__deco', 'white')}
      ${img ? `<div class="media"><img src="${esc(img.startsWith('http') ? img : '../' + img)}" alt="${esc(p.imageAlt || '')}" loading="lazy"></div>` : ''}
      <p class="club__subtitle">${esc(p.subtitle)}</p>
      <h2 class="club__name" id="${k}-t">${esc(p.name)}</h2>
      <p>${esc(p.description)}</p>
      ${arr(p.perks).length ? `<ul class="checklist">${arr(p.perks).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      ${p.conditions ? `<p class="club__conditions"><strong>Condiciones:</strong> ${esc(p.conditions)}</p>` : ''}
      <p>${waBtn(waFor(`pack ${p.name}`), p.cta || `Quiero ${p.name}`, 'btn btn--ink')}</p>
    </article>`;
  };
  const loyalty = mk.loyalty;
  const html = layout({
    path: 'packs/', current: 'packs/', title: 'Packs Aloha & Ohana, packs y bonos',
    description: `Packs Aloha y Ohana, packs combinados y bonos de sesiones con descuento en ${brand.name}.`,
    ld: [breadcrumbLd([{ label: 'Packs', path: 'packs/' }]), ...list.filter((p) => isNum(p.price)).map((p) => ({ '@context': 'https://schema.org', '@type': 'Offer', name: p.name, description: p.description, price: p.price, priceCurrency: 'EUR', seller: { '@type': 'BeautySalon', name: brand.name } }))].filter(Boolean),
    body: (root) => `
${pageHero({ root, crumbs: [{ label: 'Packs' }], eyebrow: 'Ahorra y disfruta', title: `Packs <span class="accent">Aloha</span> &amp; Ohana`, lead: 'Ventajas de bienvenida, planes para venir con tu gente, packs combinados y bonos de sesiones.' })}
<section class="section" aria-label="Aloha y Ohana"><div class="container"><div class="duo">${club('aloha')}${club('ohana')}</div></div></section>

${list.length ? `<section class="section section--white" aria-labelledby="packs-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Combina y ahorra</p><h2 id="packs-title">Nuestros <span class="accent">packs</span></h2></div>
    <div class="grid grid--3">${list.map((p, i) => { const s = saving(p.price, p.oldPrice); return `<article class="card pack reveal${p.highlight ? ' pack--highlight' : ''}" id="${esc(p.id)}" style="--i:${i % 3}">
      ${p.badge ? `<span class="pack__badge">${esc(p.badge)}</span>` : ''}
      <h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>
      ${arr(p.items).length ? `<ul class="checklist">${arr(p.items).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      <div class="pack__price">${isNum(p.oldPrice) && s ? `<del><span class="visually-hidden">Antes </span>${money(p.oldPrice)}</del>` : ''}<span class="now">${money(p.price)}</span>${savingHtml(s)}</div>
      ${waBtn(waFor(p.name), p.cta || 'Reservar pack', p.highlight ? 'btn btn--wa btn--block' : 'btn btn--ghost btn--block')}
    </article>`; }).join('')}</div>

    <div class="price-table reveal" style="margin-top:3rem"><div class="table-scroll"><table>
      <caption>Comparativa de packs</caption>
      <thead><tr><th scope="col">Pack</th><th scope="col">Incluye</th><th scope="col" class="num">Precio normal</th><th scope="col" class="num">Precio pack</th><th scope="col" class="num">Ahorro</th></tr></thead>
      <tbody>${list.map((p) => { const s = saving(p.price, p.oldPrice); return `<tr><th scope="row">${esc(p.name)}</th><td>${arr(p.items).map(esc).join(' + ')}</td><td class="num">${isNum(p.oldPrice) ? `<del>${money(p.oldPrice)}</del>` : '—'}</td><td class="num"><span class="price">${money(p.price)}</span></td><td class="num">${s ? savingHtml(s) : '—'}</td></tr>`; }).join('')}</tbody>
    </table></div></div>
  </div>
</section>` : ''}

${bonos.length ? `<section class="section" aria-labelledby="bonos-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Para constantes</p><h2 id="bonos-title">Bonos de <span class="accent">sesiones</span></h2><p>Los tratamientos por sesiones salen mejor de precio con bono.</p></div>
    <div class="price-table reveal"><div class="table-scroll"><table>
      <caption class="visually-hidden">Bonos de sesiones</caption>
      <thead><tr><th scope="col">Bono</th><th scope="col" class="num">Sesiones</th><th scope="col" class="num">Precio</th><th scope="col" class="num">Por sesión</th><th scope="col" class="num">Ahorro</th></tr></thead>
      <tbody>${bonos.map((b) => { const t = trById[b.treatmentId]; const s = saving(b.price, b.oldPrice); if (b.treatmentId && !t) warn(`Bono "${b.label}" apunta a tratamiento inexistente "${b.treatmentId}"`); return `<tr><th scope="row">${t ? `<a href="${root}tratamientos/${esc(t.id)}/">${esc(b.label || t.name)}</a>` : esc(b.label)}</th><td class="num">${esc(b.sessions)}</td><td class="num">${isNum(b.oldPrice) && s ? `<del><span class="visually-hidden">Antes </span>${money(b.oldPrice)}</del>` : ''}<span class="price">${money(b.price)}</span></td><td class="num">${isNum(b.price) && b.sessions ? money(+(b.price / b.sessions).toFixed(2)) : '—'}</td><td class="num">${s ? savingHtml(s) : '—'}</td></tr>`; }).join('')}</tbody>
    </table></div></div>
    <p class="disclaimer">${icon('info')}<span>${esc(legal.priceDisclaimer)}</span></p>
  </div>
</section>` : ''}

${activePromos.length ? `<section class="section section--white" aria-labelledby="promos-title"><div class="container"><div class="section__head"><p class="eyebrow">Ahora mismo</p><h2 id="promos-title">Promociones <span class="accent">activas</span></h2></div><div class="grid grid--3">${activePromos.map(promoCard).join('')}</div></div></section>` : ''}

${loyalty && loyalty.name ? `<section class="section section--ink" aria-labelledby="loyal-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">Fidelización</p><h2 id="loyal-title">${esc(loyalty.name)}</h2><p>${esc(loyalty.description)}</p></div>
    ${arr(loyalty.steps).length ? `<ol class="loyalty-steps">${arr(loyalty.steps).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
  </div>
</section>` : ''}`,
  });
  writePage('packs/', html);
}

/* ---------- Contacto ---------- */
function pageContact() {
  const html = layout({
    path: 'contacto/', current: 'contacto/', title: 'Contacto y reservas',
    description: `Pide cita en ${brand.name} por WhatsApp, teléfono o formulario. Dirección, horario y cómo llegar.`,
    ld: [breadcrumbLd([{ label: 'Contacto', path: 'contacto/' }])].filter(Boolean),
    cta: false,
    body: (root) => `
${pageHero({ root, crumbs: [{ label: 'Contacto' }], eyebrow: 'Hablemos', title: `Pide tu <span class="accent">cita</span>`, lead: 'Respondemos rápido. Si no sabes qué tratamiento elegir, te asesoramos gratis.', extra: `<div class="btn-row">${waBtn(contact.whatsappMessage, UI.whatsappLong)}${bookingBtn()}${callBtn()}</div>` })}
<section class="section" id="reservar" aria-label="Formulario y datos de contacto">
  <div class="container contact-grid">
    <div>${contactInfo(root)}${mapBlock()}</div>
    ${contactForm(root)}
  </div>
</section>`,
  });
  writePage('contacto/', html);
}

/* ---------- Legal (plantillas) ---------- */
function pageLegal(path, title, sectionsHtml) {
  const html = layout({
    path, title, description: `${title} de ${brand.name}.`, cta: false,
    body: (root) => `${pageHero({ root, crumbs: [{ label: title }], title: esc(title), lead: '' })}
<section class="section"><div class="container container--narrow legal">
  <div class="notice notice--warn" role="note">${icon('alert')}<p><strong>Plantilla orientativa.</strong> Los textos marcados como <span class="todo">[POR DEFINIR]</span> deben completarse y revisarse por un profesional antes de publicar.</p></div>
  ${sectionsHtml(root)}
  <p class="small">Última actualización: ${BUILD_DATE}</p>
</div></section>`,
  });
  writePage(path, html);
}
const titular = () => `<ul>
  <li><strong>Titular:</strong> ${fill(legal.companyName || '[POR DEFINIR]')}</li>
  <li><strong>NIF/CIF:</strong> ${fill(legal.nif || '[POR DEFINIR]')}</li>
  <li><strong>Domicilio:</strong> ${fill(contact.address)}, ${fill(contact.postalCode)} ${fill(contact.city)}</li>
  <li><strong>Email:</strong> ${fill(contact.email)}</li>
  <li><strong>Teléfono:</strong> ${fill(contact.phoneDisplay || contact.phone)}</li>
</ul>`;

function pagesLegal() {
  pageLegal('privacidad/', 'Política de privacidad', (root) => `
  <h2>1. Responsable del tratamiento</h2>${titular()}
  <h2>2. Qué datos tratamos y para qué</h2>
  <p>Tratamos los datos que nos facilitas a través del formulario de contacto, WhatsApp, teléfono o email (nombre, teléfono, email y el contenido de tu mensaje) con la finalidad de atender tu solicitud, gestionar citas y, si lo solicitas, enviarte la información pedida.</p>
  <h2>3. Base legal</h2>
  <p>Tu consentimiento al enviar la solicitud (art. 6.1.a RGPD) y, en su caso, la ejecución de la relación de servicio (art. 6.1.b RGPD).</p>
  <h2>4. Conservación</h2><p>Conservaremos los datos el tiempo necesario para atender tu solicitud y, después, durante los plazos legales aplicables. <span class="todo">[POR DEFINIR]</span></p>
  <h2>5. Destinatarios</h2>
  <p>No cedemos datos a terceros salvo obligación legal. Proveedores que pueden tratar datos por cuenta nuestra: alojamiento web (GitHub Pages), ${contact.formEndpoint ? 'servicio de formularios' : 'WhatsApp (Meta Platforms) si eliges ese canal'}, ${contact.bookingUrl ? 'software de reservas, ' : ''}<span class="todo">[POR DEFINIR]</span>.</p>
  <h2>6. Tus derechos</h2>
  <p>Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${fill(contact.email)}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>`);

  pageLegal('aviso-legal/', 'Aviso legal', () => `
  <h2>1. Datos identificativos</h2>
  <p>En cumplimiento de la Ley 34/2002 de Servicios de la Sociedad de la Información (LSSI-CE):</p>${titular()}
  <p>Datos registrales: <span class="todo">[POR DEFINIR]</span></p>
  <h2>2. Objeto</h2><p>Este sitio web informa sobre los servicios de ${esc(brand.name)}. Los precios mostrados son orientativos. ${esc(legal.priceDisclaimer)}</p>
  <h2>3. Información sanitaria y estética</h2><p>La información de cada tratamiento es divulgativa y no sustituye una valoración profesional individual. Los resultados pueden variar según cada persona.</p>
  <h2>4. Propiedad intelectual</h2><p>Los contenidos, marcas y diseños de este sitio pertenecen a su titular o se usan con autorización.</p>
  <h2>5. Responsabilidad</h2><p>El titular no se hace responsable del mal uso de los contenidos ni de los sitios enlazados de terceros.</p>
  <h2>6. Legislación aplicable</h2><p>Legislación española. Juzgados y tribunales de <span class="todo">[POR DEFINIR]</span>.</p>`);

  pageLegal('cookies/', 'Política de cookies', () => `
  <h2>1. ¿Qué son las cookies?</h2><p>Pequeños archivos que un sitio web guarda en tu navegador.</p>
  <h2>2. Cookies que usa este sitio</h2>
  <p>Este sitio <strong>no instala cookies propias de análisis ni de publicidad</strong>. Se cargan tipografías desde Google Fonts, lo que implica una conexión con servidores de Google (sin cookies de seguimiento por nuestra parte).</p>
  <p>Si en el futuro se añade analítica, mapas incrustados o un software de reservas que use cookies no esenciales, se incorporará un banner de consentimiento y se detallarán aquí. <span class="todo">[POR DEFINIR]</span></p>
  <h2>3. Cómo gestionarlas</h2><p>Puedes bloquear o borrar las cookies desde la configuración de tu navegador.</p>`);
}

/* ---------- 404 ---------- */
function page404() {
  const base = SITE_URL ? new URL(SITE_URL).pathname : '/'; // GitHub Pages sirve 404.html en cualquier ruta: rutas desde la base
  const html = layout({
    path: '404.html', title: 'Página no encontrada', description: 'La página que buscas no existe.', noindex: true, base, rootOverride: '', cta: false,
    body: (root) => `<section class="hero" aria-labelledby="nf-title">
  <div class="hero__layer" data-speed="0.2">${blob('deco-blob-a', 'pink', 'coral', 0)}</div>
  <div class="hero__layer" data-speed="0.4">${palm('deco-leaf-a', 'sage')}${sparkles('deco-sparkles', 8)}</div>
  <div class="container not-found"><div>
    <p class="big" aria-hidden="true">404</p>
    <h1 id="nf-title">Ups, esta página se fue de spa</h1>
    <p class="lead">No encontramos lo que buscas, pero seguro que algo de esto te encanta.</p>
    <div class="btn-row" style="justify-content:center"><a class="btn" href="${root || './'}">Volver al inicio</a><a class="btn btn--ghost" href="${root}tratamientos/">${UI.seeAll}</a></div>
  </div></div>
</section>`,
  });
  writePage('404.html', html, { sitemap: false, file: '404.html' });
}

/* ==========================================================================
   9. Recursos: tema, favicon, imagen OG (PNG generado), sitemap, robots
   ========================================================================== */
function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.pink}"/><stop offset=".6" stop-color="${C.coral}"/><stop offset="1" stop-color="${C.gold}"/></linearGradient></defs><path d="M32 3c18 0 29 11 29 29S50 61 32 61 3 50 3 32 14 3 32 3z" fill="url(#g)"/><text x="32" y="44" text-anchor="middle" font-family="Georgia,serif" font-size="34" font-weight="700" font-style="italic" fill="${C.ink}">${esc((brand.shortName || 'I').charAt(0))}</text></svg>`;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Imagen OG 1200x630 con degradado de marca (sustituible por una real en static/src/assets/). */
function ogPng() {
  const W = 1200, H = 630;
  const c1 = hex(C.cream) || [251, 244, 238], c2 = hex(C.pink) || [244, 182, 194], c3 = hex(C.coral) || [240, 124, 108], c4 = hex(C.sage) || [185, 205, 180], g = hex(C.gold) || [201, 162, 75];
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const t = (x / W) * 0.6 + (y / H) * 0.4;
      let c = t < 0.6 ? mix(c1, c2, t / 0.6) : mix(c2, c3, (t - 0.6) / 0.4);
      const d1 = Math.hypot(x - 150, y - 560) / 420; if (d1 < 1) c = mix(c, c4, (1 - d1) * 0.8);
      const d2 = Math.abs(Math.hypot(x - 900, y - 315) - 190); if (d2 < 3) c = mix(c, g, 1 - d2 / 3);
      const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function assets() {
  cpSync(join(SRC, 'css'), join(DIST, 'css'), { recursive: true });
  cpSync(join(SRC, 'js'), join(DIST, 'js'), { recursive: true });
  cpSync(join(SRC, 'assets'), join(DIST, 'assets'), { recursive: true, filter: (s) => !s.endsWith('.gitkeep') });
  writeFileSync(join(DIST, 'css', 'theme.css'), buildThemeCss());
  writeFileSync(join(DIST, 'assets', 'favicon.svg'), favicon());
  const og = seo.ogImage && !ext(seo.ogImage) ? seo.ogImage.replace(/^\/+/, '') : null;
  if (og && !existsSync(join(DIST, og)) && og.endsWith('.png')) {
    mkdirSync(dirname(join(DIST, og)), { recursive: true });
    writeFileSync(join(DIST, og), ogPng());
  }
  writeFileSync(join(DIST, '.nojekyll'), '');
}

function seoFiles() {
  if (SITE_URL) {
    writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${esc(new URL(p, SITE_URL).href)}</loc><lastmod>${BUILD_DATE}</lastmod><priority>${p === '' ? '1.0' : p.split('/').filter(Boolean).length > 1 ? '0.7' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`);
  } else {
    // Sin URL absoluta un sitemap no es válido: se deja una plantilla que indica cómo generarlo.
    writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<!-- Define seo.siteUrl en content/site.json o la variable SITE_URL al construir para generar las URLs absolutas.
     Páginas: ${pages.map((p) => p || '(inicio)').join(', ')} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>
`);
    warn('Sin seo.siteUrl ni SITE_URL: no hay canonical ni sitemap con URLs (el workflow de GitHub Pages lo define automáticamente).');
  }
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n${SITE_URL ? `\nSitemap: ${new URL('sitemap.xml', SITE_URL).href}\n` : ''}`);
}

/* ==========================================================================
   10. Ejecutar
   ========================================================================== */
const t0 = Date.now();
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
assets();
pageHome();
pageCatalog();
treatments.forEach(pageTreatment);
pagePrices();
pagePacks();
pageContact();
pagesLegal();
page404();
seoFiles();

console.log(`✔ static/dist generado en ${Date.now() - t0} ms — ${pages.length + 1} páginas (${treatments.length} fichas)`);
console.log(`  Datos: ${[siteSrc, trSrc, pkSrc, mkSrc].map((s) => s.source).join(' · ')}`);
if (SITE_URL) console.log(`  URL base: ${SITE_URL}`);
for (const w of warnings) console.warn(`  ⚠ ${w}`);
