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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONTENT = process.env.CONTENT_DIR ? resolve(process.env.CONTENT_DIR) : join(ROOT, 'content');
const FIXTURES = join(HERE, 'fixtures');
const SRC = join(HERE, 'src');
const DIST = join(HERE, 'dist');
const warnings = new Set(); // sin duplicados (cada idioma repetiría los mismos avisos)
const warn = (m) => warnings.add(m);

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
// Mapa corporal (opcional): sin archivo o con JSON inválido, la portada no muestra la sección
let bodymapData = {};
if (existsSync(join(CONTENT, 'bodymap.json'))) {
  try { bodymapData = readJson(join(CONTENT, 'bodymap.json')); } catch (e) { warn(`content/bodymap.json no es JSON válido (${e.message}); no se muestra el mapa corporal`); }
}
const BASE = { site: siteSrc.data ?? {}, treatments: trSrc.data ?? {}, packs: pkSrc.data ?? {}, marketing: mkSrc.data ?? {}, bodymap: bodymapData };

/* Idiomas: el español es la base (raíz /); ca y en en subcarpetas con los mismos slugs. */
const LANGS = [
  { code: 'es', prefix: '', name: 'Español', short: 'ES', locale: 'es_ES', intl: 'es-ES' },
  { code: 'ca', prefix: 'ca/', name: 'Català', short: 'CA', locale: 'ca_ES', intl: 'ca-ES' },
  { code: 'en', prefix: 'en/', name: 'English', short: 'EN', locale: 'en_GB', intl: 'en-GB' },
];

// Datos que nunca se traducen (content/i18n/LEEME.md, regla 5-6)
const theme = BASE.site.theme ?? { colors: {}, fonts: {} };
const baseContact = BASE.site.contact ?? {};
const social = BASE.site.social ?? {};

for (const t of BASE.treatments.treatments ?? []) {
  if (!t || !t.id) continue;
  if (!(BASE.treatments.categories ?? []).some((c) => c.id === t.category)) warn(`Tratamiento "${t.id}" usa categoría inexistente "${t.category}"`);
  if (!/^[a-z0-9-]+$/.test(t.id)) warn(`Tratamiento "${t.id}": el id debería ser un slug (a-z, 0-9, guiones)`);
}

let SITE_URL = (BASE.site.seo?.siteUrl || process.env.SITE_URL || '').trim(); // site.json manda; SITE_URL (CI) si está vacío
if (SITE_URL && !SITE_URL.endsWith('/')) SITE_URL += '/';
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const VERSION = Date.now().toString(36);

/* ==========================================================================
   2. Traducciones (content/i18n/) — reglas de fusión de content/i18n/LEEME.md
   ========================================================================== */
const I18N = join(CONTENT, 'i18n');
const NEVER_KEYS = new Set([
  'id', 'treatmentId', 'category', 'href', 'icon', 'price', 'oldPrice', 'priceFrom', 'order', 'painLevel', 'combinesWith',
  'featured', 'highlight', 'active', 'from', 'immersive', 'isPlaceholder',
  'theme', 'colors', 'fonts', 'image', 'ogImage', 'siteUrl', 'locale',
  'phone', 'whatsapp', 'email', 'postalCode', 'mapsUrl', 'mapsEmbed', 'bookingUrl', 'formEndpoint',
]);
const NEVER_PATHS = new Set(['brand.name', 'brand.shortName', 'seo.titleSuffix', 'brand.logoText', 'brand.logoAccent', 'aloha.name', 'ohana.name', 'social']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasText = (s) => typeof s === 'string' && /\p{L}/u.test(s.replace(/\[POR[ -]DEFINIR\]/gi, ''));

/**
 * Fusiona la traducción `tr` sobre la base española `base`.
 * - Objetos: clave a clave. Listas con `id`: por id. Listas de objetos sin id: por posición.
 * - Listas de textos: se sustituyen enteras. Números, booleanos y claves protegidas: siempre del español.
 * `st` acumula lo que falta para el resumen de consola. `protect=false` (ui.json) no aplica NEVER_KEYS.
 */
function mergeI18n(base, tr, path, st, protect = true) {
  if (Array.isArray(base)) {
    if (tr !== undefined && !Array.isArray(tr)) { st.type.push(path); tr = undefined; }
    const objs = base.some(isObj);
    if (objs && base.some((b) => isObj(b) && 'id' in b)) {
      const byId = new Map((tr || []).filter(isObj).map((x) => [x.id, x]));
      for (const id of byId.keys()) if (!base.some((b) => isObj(b) && b.id === id)) st.unknown.push(`${path}[${id}]`);
      return base.map((b) => (isObj(b) ? mergeI18n(b, byId.get(b.id), `${path}[${b.id}]`, st, protect) : b));
    }
    if (objs) {
      if (tr && tr.length !== base.length) st.len.push(`${path} (${tr.length} de ${base.length})`);
      return base.map((b, i) => mergeI18n(b, tr ? tr[i] : undefined, `${path}[${i}]`, st, protect));
    }
    // Lista de textos: se sustituye entera
    if (tr && tr.length && tr.every((x) => typeof x === 'string')) {
      if (tr.length !== base.length) st.len.push(`${path} (${tr.length} de ${base.length})`);
      return tr;
    }
    if (base.some(hasText)) st.missing.push(path);
    return base;
  }
  if (isObj(base)) {
    if (tr !== undefined && !isObj(tr)) { st.type.push(path); tr = undefined; }
    const out = {};
    for (const [k, v] of Object.entries(base)) {
      const p = path ? `${path}.${k}` : k;
      // bodymap.json → zones[].treatments es una lista de ids (no se traduce)
      const skip = protect && (NEVER_KEYS.has(k) || NEVER_PATHS.has(p) || (k === 'treatments' && Array.isArray(v) && v.every((x) => typeof x === 'string')));
      out[k] = skip ? v : mergeI18n(v, tr ? tr[k] : undefined, p, st, protect);
    }
    return out;
  }
  if (typeof base === 'string') {
    if (typeof tr === 'string' && tr.trim()) return tr;
    if (hasText(base)) st.missing.push(path);
    return base;
  }
  return base; // números, booleanos, null: siempre del español
}

const sample = (list, n = 4) => list.slice(0, n).join(', ') + (list.length > n ? `, … (+${list.length - n})` : '');
function reportI18n(label, st) {
  if (st.missing.length) warn(`i18n ${label}: ${st.missing.length} texto(s) sin traducir (se usa el español), p. ej.: ${sample(st.missing)}`);
  if (st.len.length) warn(`i18n ${label}: ${st.len.length} lista(s) con distinto nº de elementos que el español: ${sample(st.len)}`);
  if (st.unknown.length) warn(`i18n ${label}: id(s) que no existen en el español (se ignoran): ${sample(st.unknown)}`);
  if (st.type.length) warn(`i18n ${label}: tipo distinto al español (se ignora): ${sample(st.type)}`);
}
const newStats = () => ({ missing: [], len: [], unknown: [], type: [] });

/** Contenido de un idioma: el español fusionado con content/i18n/<lang>/<archivo>.json. */
function loadLangContent(lang) {
  if (lang === 'es') return BASE;
  const out = {};
  for (const name of Object.keys(BASE)) {
    const file = join(I18N, lang, `${name}.json`);
    if (!existsSync(file)) { warn(`i18n ${lang}: falta content/i18n/${lang}/${name}.json → se usa el español`); out[name] = BASE[name]; continue; }
    let tr;
    try { tr = readJson(file); } catch (e) { warn(`i18n ${lang}: content/i18n/${lang}/${name}.json no es JSON válido (${e.message}) → se usa el español`); out[name] = BASE[name]; continue; }
    const st = newStats();
    out[name] = mergeI18n(BASE[name], tr, '', st);
    reportI18n(`${lang}/${name}.json`, st);
  }
  return out;
}

/* Textos fijos de la interfaz: content/i18n/ui.json → { es: {...}, ca: {...}, en: {...} } */
const UI_FILE = join(I18N, 'ui.json');
if (!existsSync(UI_FILE)) throw new Error('Falta content/i18n/ui.json (textos fijos de la interfaz)');
const UI_ALL = readJson(UI_FILE);
if (!isObj(UI_ALL.es)) throw new Error('content/i18n/ui.json no tiene la sección "es"');
function loadUi(lang) {
  if (lang === 'es') return UI_ALL.es;
  if (!isObj(UI_ALL[lang])) { warn(`i18n ui.json: falta la sección "${lang}" → se usa el español`); return UI_ALL.es; }
  const st = newStats();
  const out = mergeI18n(UI_ALL.es, UI_ALL[lang], '', st, false);
  reportI18n(`ui.json (${lang})`, st);
  return out;
}

/* Estado del idioma en curso (lo fija setLang antes de generar cada idioma) */
let L, LP = '', LANG_UP = '', UI = {};
let site, brand, contact, seo, legal, categories, treatments, packs, mk, catById, trById, featured, activePromos, bodymap;
function setLang(lang) {
  L = LANGS.find((x) => x.code === lang);
  LP = L.prefix;
  LANG_UP = LP ? '../' : ''; // de la raíz del idioma a la raíz de dist (css, js, assets compartidos)
  UI = loadUi(lang);
  const D = loadLangContent(lang);
  site = D.site; brand = site.brand ?? {}; contact = site.contact ?? {}; seo = site.seo ?? {}; legal = site.legal ?? {};
  categories = [...(D.treatments.categories ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  treatments = (D.treatments.treatments ?? []).filter((t) => t && t.id);
  packs = D.packs ?? {};
  mk = D.marketing ?? {};
  bodymap = D.bodymap ?? {};
  catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  trById = Object.fromEntries(treatments.map((t) => [t.id, t]));
  featured = (() => { const f = treatments.filter((t) => t.featured); return (f.length ? f : treatments).slice(0, 6); })();
  activePromos = arr(mk.promos).filter((p) => p.active !== false);
}
const byCat = (id) => treatments.filter((t) => t.category === id);

/** Texto de interfaz (plano, sin escapar). `key` con puntos: 'form.name'. {var} se sustituye. */
const uiGet = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), UI);
const sub = (s, vars = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
function tx(key, vars) {
  const v = uiGet(key);
  if (v === undefined) { warn(`ui.json: falta la clave "${key}"`); return key; }
  return sub(v, vars);
}
/** Texto de interfaz escapado para HTML (vars en texto plano). */
const u = (key, vars) => esc(tx(key, vars));
/** Texto de interfaz enriquecido: **negrita**, *acento*, [POR DEFINIR] resaltado. Las vars deben ser HTML ya escapado. */
function rich(key, vars = {}) {
  const v = uiGet(key);
  if (v === undefined) { warn(`ui.json: falta la clave "${key}"`); return esc(key); }
  const html = esc(v).replace(/\[POR[ -]DEFINIR\]/gi, (m) => `<span class="todo">${m}</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<span class="accent">$1</span>');
  return sub(html, vars);
}
const PAIN = (n) => arr(UI.painLabels)[Math.max(0, Math.min(5, Number(n) || 0))] ?? '';

/* ==========================================================================
   3. Utilidades
   ========================================================================== */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Escapa y resalta los "[POR DEFINIR]" para que se vean como pendientes. */
const fill = (s) => esc(s).replace(/\[POR[ -]DEFINIR\]/gi, (m) => `<span class="todo">${m}</span>`);
const arr = (x) => (Array.isArray(x) ? x.filter((v) => v !== null && v !== undefined && v !== '') : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => {
  if (isNum(v) && v > 0) return new Intl.NumberFormat(L.intl, { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
  if (typeof v === 'string' && v.trim()) return esc(v);
  return u('consult');
};
const saving = (price, old) => (isNum(price) && isNum(old) && old > price ? { amount: +(old - price).toFixed(2), pct: Math.round(((old - price) / old) * 100) } : null);
const savingHtml = (s) => (s ? `<span class="save">${sub(esc(tx('saving')), { amount: money(s.amount), pct: s.pct })}</span>` : '');
const priceFromOf = (t) => (isNum(t.priceFrom) && t.priceFrom > 0 ? t.priceFrom : Math.min(...arr(t.prices).map((p) => p.price).filter((p) => isNum(p) && p > 0), Infinity));
const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${esc(name)}"></use></svg>`;
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const WA = digits(baseContact.whatsapp);
const waUrl = (text) => `https://wa.me/${WA}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
const waFor = (name) => (contact.whatsappTreatmentMessage || tx('waTreatment')).replace('{treatment}', name);
const tel = baseContact.phone ? `tel:${String(baseContact.phone).replace(/[^\d+]/g, '')}` : '';
const abs = (p) => (SITE_URL ? new URL(p, SITE_URL).href : null);
/** URL absoluta de una página del idioma en curso (path sin prefijo de idioma). */
const pageUrl = (path, lang = L) => (SITE_URL ? new URL(lang.prefix + path, SITE_URL).href : null);
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
/** Ruta de un recurso compartido (assets/, css/, js/ viven en la raíz de dist para los tres idiomas). */
const imgSrc = (src, root) => (ext(src) ? src : root + LANG_UP + src);

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
  return `<div class="img-slot" aria-hidden="true">${palm('img-slot__art', 'white')}<span class="img-slot__label">${icon('image')} ${u('imageSlot')} ·${esc(pathHint)}</span></div>`;
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
    url: pageUrl('') || undefined, telephone: contact.phone || undefined, email: contact.email || undefined,
    image: seo.ogImage ? abs(seo.ogImage) || undefined : undefined,
    priceRange: '€€', currenciesAccepted: 'EUR',
    address: { '@type': 'PostalAddress', streetAddress: contact.address, addressLocality: contact.city, postalCode: contact.postalCode, addressCountry: 'ES' },
    hasMap: contact.mapsUrl || undefined,
    sameAs: Object.values(social).filter(Boolean),
  };
}

function waBtn(text, label = tx('whatsapp'), cls = 'btn btn--wa') {
  return `<a class="${cls}" href="${esc(waUrl(text))}" target="_blank" rel="noopener">${icon('whatsapp')}<span>${esc(label)}</span><span class="visually-hidden"> ${u('newTab')}</span></a>`;
}
function callBtn(cls = 'btn btn--ghost') {
  return tel ? `<a class="${cls}" href="${tel}">${icon('phone')}<span>${u('call')}</span></a>` : '';
}
function bookingBtn(cls = 'btn btn--green') {
  return contact.bookingUrl ? `<a class="${cls}" href="${esc(contact.bookingUrl)}" target="_blank" rel="noopener">${icon('calendar')}<span>${esc(contact.bookingLabel || tx('bookOnline'))}</span><span class="visually-hidden"> ${u('newTab')}</span></a>` : '';
}

/**
 * Selector de idioma: enlaza a la MISMA página en cada idioma.
 * `here` = { root (raíz del sitio relativa a la página), path (sin prefijo) }.
 */
function langSwitch(here, cls = '') {
  const items = LANGS.map((x) => {
    const cur = x.code === L.code;
    const href = here.siteRoot + x.prefix + here.path || './';
    return `<li><a href="${esc(href)}" lang="${x.code}" hreflang="${x.code}"${cur ? ' aria-current="true"' : ''}><abbr title="${esc(x.name)}" aria-hidden="true">${x.short}</abbr><span class="visually-hidden">${esc(x.name)}</span></a></li>`;
  }).join('<li aria-hidden="true" class="lang-switch__sep">·</li>');
  return `<nav class="lang-switch ${cls}" aria-label="${u('langNav')}"><ul>${items}</ul></nav>`;
}

/** Elementos del menú: «Quiénes somos» (ancla de portada, si existe site.about) + site.nav. */
function navEntries(root, current) {
  const list = [];
  if (site.about) list.push({ label: tx('navAbout'), href: current === '#home' ? '#quienes-somos' : `${root || './'}#quienes-somos`, cur: false, ext: false });
  for (const n of arr(site.nav)) list.push({ label: n.label, href: link(n.href, root), cur: !!current && n.href.replace(/^\/+/, '') === current, ext: ext(n.href) });
  return list;
}

function header(root, current, hasReservar = true, here) {
  const a = mk.announcement;
  const announce = a && a.active && a.text
    ? `<div class="announce"><div class="container">${icon('sparkle')}<p style="margin:0">${a.href ? `<a href="${esc(link(a.href, root))}"${extAttrs(a.href)}>${esc(a.text)}</a>` : esc(a.text)}</p></div></div>` : '';
  const navItems = navEntries(root, current).map((n) => `<li><a class="nav__link" href="${esc(n.href)}"${n.cur ? ' aria-current="page"' : ''}${n.ext ? ' target="_blank" rel="noopener"' : ''}>${esc(n.label)}</a></li>`).join('');
  const cta = contact.bookingUrl ? bookingBtn('btn btn--sm header-cta') : `<a class="btn btn--sm header-cta" href="${hasReservar ? '#reservar' : root + 'contacto/'}">${icon('calendar')}<span>${u('bookCta')}</span></a>`;
  return `${announce}
<header class="site-header">
  <div class="container site-header__bar">
    <a class="logo" href="${root || './'}" aria-label="${esc(brand.name)} — ${u('home')}">${logoMark()}<span><span class="logo__text">${esc(brand.logoText || brand.name)}</span><span class="logo__accent">${esc(brand.logoAccent || '')}</span></span></a>
    <nav id="site-nav" class="nav" aria-label="${u('navMain')}">
      <ul class="nav__list">${navItems}</ul>
      ${langSwitch(here, 'lang-switch--mobile')}
      <div class="nav__mobile-cta">${waBtn(contact.whatsappMessage, tx('whatsappLong'), 'btn btn--wa btn--block')}${callBtn('btn btn--ghost btn--block')}${bookingBtn('btn btn--green btn--block')}</div>
    </nav>
    <div class="header-actions">
      ${langSwitch(here, 'lang-switch--desktop')}
      ${cta}
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="${u('menuOpen')}" data-label-open="${u('menuOpen')}" data-label-close="${u('menuClose')}">${icon('menu', 'icon-open')}${icon('close', 'icon-close')}</button>
    </div>
  </div>
</header>`;
}

function hoursDl(cls = 'hours') {
  const h = arr(contact.hours);
  return h.length ? `<dl class="${cls}">${h.map((x) => `<dt>${esc(x.days)}</dt><dd>${esc(x.time)}</dd>`).join('')}</dl>` : '';
}

function footer(root, current, here) {
  const soc = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook']].filter(([k]) => social[k])
    .map(([k, l]) => `<a href="${esc(social[k])}" target="_blank" rel="noopener" aria-label="${l} ${u('newTab')}">${icon(k)}</a>`).join('');
  return `<footer class="site-footer">
  ${leaf('footer-deco', 'sage')}
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="logo" href="${root || './'}" aria-label="${esc(brand.name)} — ${u('home')}">${logoMark()}<span><span class="logo__text">${esc(brand.logoText || brand.name)}</span><span class="logo__accent">${esc(brand.logoAccent || '')}</span></span></a>
        <p style="margin-top:1rem">${esc(brand.tagline)}</p>
        ${soc ? `<div class="social">${soc}</div>` : ''}
      </div>
      <div><h2>${u('footer.explore')}</h2><ul class="footer-list">${navEntries(root, current).map((n) => `<li><a href="${esc(n.href)}">${esc(n.label)}</a></li>`).join('')}</ul></div>
      <div><h2>${u('footer.contact')}</h2><ul class="footer-list">
        ${tel ? `<li><a href="${tel}">${icon('phone')}${fill(contact.phoneDisplay || contact.phone)}</a></li>` : ''}
        ${WA ? `<li><a href="${esc(waUrl(contact.whatsappMessage))}" target="_blank" rel="noopener">${icon('whatsapp')}${u('whatsapp')}<span class="visually-hidden"> ${u('newTab')}</span></a></li>` : ''}
        ${contact.email ? `<li><a href="mailto:${esc(contact.email)}">${icon('mail')}${fill(contact.email)}</a></li>` : ''}
        <li><span style="display:inline-flex;gap:.45rem;padding-block:.6rem">${icon('pin')}<span>${fill(contact.address)}${contact.city ? `, ${fill(contact.city)}` : ''}</span></span></li>
      </ul></div>
      <div><h2>${u('footer.hours')}</h2>${hoursDl()}</div>
    </div>
    <div class="footer-bottom">
      <p style="margin:0">© <span data-year>${new Date().getFullYear()}</span> ${esc(brand.name)}${legal.companyName ? ` · ${fill(legal.companyName)}` : ''}</p>
      ${langSwitch(here, 'lang-switch--footer')}
      <ul class="footer-list" style="display:flex;flex-wrap:wrap;gap:0 1.25rem">
        <li><a href="${root}privacidad/">${u('footer.privacy')}</a></li><li><a href="${root}aviso-legal/">${u('footer.legal')}</a></li><li><a href="${root}cookies/">${u('footer.cookies')}</a></li>
      </ul>
    </div>
  </div>
</footer>`;
}

function fabs() {
  return `<div class="fab-stack">
  ${tel ? `<a class="fab fab--call" href="${tel}" aria-label="${u('call')} ${esc(contact.phoneDisplay || contact.phone)}">${icon('phone')}</a>` : ''}
  ${WA ? `<a class="fab fab--wa" href="${esc(waUrl(contact.whatsappMessage))}" target="_blank" rel="noopener" aria-label="${u('whatsappLong')} ${u('newTab')}">${icon('whatsapp')}<span class="fab__label" aria-hidden="true">${u('whatsapp')}</span></a>` : ''}
</div>`;
}

function ctaReservar(root, { waText, title, text } = {}) {
  return `<section class="section" id="reservar" aria-labelledby="reservar-title">
  <div class="container">
    <div class="cta-band reveal">
      ${leaf('cta-band__deco cta-band__deco--l', 'sage')}${palm('cta-band__deco cta-band__deco--r', 'pink')}
      <p class="eyebrow">${u('cta.eyebrow')}</p>
      <h2 id="reservar-title">${esc(title || tx('cta.title'))}</h2>
      <p>${esc(text || tx('cta.text'))}</p>
      <div class="btn-row">
        ${waBtn(waText || contact.whatsappMessage, tx('whatsappLong'))}
        ${bookingBtn()}
        ${callBtn()}
        <a class="btn btn--ghost" href="${root}contacto/">${icon('mail')}<span>${u('formLink')}</span></a>
      </div>
    </div>
  </div>
</section>`;
}

/* ==========================================================================
   7. Layout
   ========================================================================== */
const pages = new Set(); // rutas (sin prefijo de idioma) para el sitemap; las mismas en los tres idiomas
function layout({ path, title, description, body, ld = [], current = '', ogType = 'website', noindex = false, base = '', cta = {}, ogImage, rootOverride }) {
  const depth = path ? path.split('/').filter(Boolean).length : 0;
  const root = rootOverride ?? '../'.repeat(depth);   // raíz del idioma (enlaces a páginas)
  const aroot = rootOverride ?? root + LANG_UP;         // raíz de dist (css, js, assets compartidos)
  const here = { siteRoot: aroot, path: path === '404.html' ? '' : path }; // selector de idioma (404 → portadas)
  const fullTitle = title ? `${title}${seo.titleSuffix || ''}` : `${brand.name} — ${brand.tagline}`;
  const desc = (description || seo.defaultDescription || brand.description || '').slice(0, 300);
  const url = noindex ? '' : pageUrl(path) || '';
  const og = ogImage || seo.ogImage;
  const ogAbs = og ? (ext(og) ? og : abs(og) || aroot + og) : '';
  const fontsUrl = theme.fonts?.googleFontsUrl;
  // hreflang: URL absoluta si hay SITE_URL; si no, relativa (sirve en local y la valida check-links)
  const alt = (x) => (SITE_URL ? pageUrl(here.path, x) : aroot + x.prefix + here.path || './');
  const alternates = noindex ? '' : [...LANGS.map((x) => `<link rel="alternate" hreflang="${x.code}" href="${esc(alt(x))}">`), `<link rel="alternate" hreflang="x-default" href="${esc(alt(LANGS[0]))}">`].join('\n') + '\n';
  const pageLd = { '@context': 'https://schema.org', '@type': 'WebPage', name: fullTitle, description: desc || undefined, inLanguage: L.code, url: url || undefined, isPartOf: { '@type': 'WebSite', name: brand.name, url: pageUrl('') || undefined, inLanguage: L.code } };
  return `<!doctype html>
<html lang="${L.code}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base ? `<base href="${esc(base)}">\n` : ''}<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}${url ? `<link rel="canonical" href="${esc(url)}">\n` : ''}${alternates}<meta name="theme-color" content="${esc(C.cream)}">
<link rel="icon" href="${aroot}assets/favicon.svg" type="image/svg+xml">
${fontsUrl ? `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${esc(fontsUrl)}">\n` : ''}<link rel="stylesheet" href="${aroot}css/theme.css?v=${VERSION}">
<link rel="stylesheet" href="${aroot}css/main.css?v=${VERSION}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(brand.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:locale" content="${L.locale}">
${LANGS.filter((x) => x !== L).map((x) => `<meta property="og:locale:alternate" content="${x.locale}">\n`).join('')}${url ? `<meta property="og:url" content="${esc(url)}">\n` : ''}${ogAbs ? `<meta property="og:image" content="${esc(ogAbs)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<script>(function(d){d.className=d.className.replace('no-js','js');try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)d.className+=' motion-ok';}catch(e){}})(document.documentElement);</script>
${[businessLd(), pageLd, ...ld].map(jsonLd).join('\n')}
</head>
<body>
${SPRITE}
<a class="skip-link" href="#main">${u('skip')}</a>
${header(root, current, cta !== false || path === '' || path === 'contacto/', here)}
<main id="main" tabindex="-1">
${body(root)}
${cta === false ? '' : ctaReservar(root, cta)}
</main>
${footer(root, current, here)}
${fabs()}
<script src="${aroot}js/main.js?v=${VERSION}" defer></script>
</body>
</html>
`;
}

function writePage(path, html, { sitemap = true, file } = {}) {
  const out = file ? join(DIST, file) : join(DIST, LP, path, 'index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  if (sitemap) pages.add(path);
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
  const all = [{ label: tx('home'), href: root || './' }, ...crumbs];
  return `<nav class="breadcrumbs" aria-label="${u('breadcrumbs')}"><ol>${all.map((c, i) => i === all.length - 1 ? `<li><span aria-current="page">${esc(c.label)}</span></li>` : `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`).join('')}</ol></nav>`;
}
function breadcrumbLd(crumbs) {
  if (!SITE_URL) return null;
  const all = [{ label: tx('home'), path: '' }, ...crumbs];
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: all.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, item: pageUrl(c.path) })) };
}
function faqLd(items) {
  const f = arr(items).filter((x) => x.q && x.a);
  return f.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: L.code, mainEntity: f.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) } : null;
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
  <div class="card__meta">${t.duration ? `<span>${icon('clock')}${esc(t.duration)}</span>` : ''}${isFinite(pf) ? `<span class="card__price">${u('from')} ${money(pf)}</span>` : ''}</div>
  <span class="card__more" aria-hidden="true">${u('seeFicha')} ${icon('arrow')}</span>
</article>`;
}

function contactInfo(root) {
  return `<ul class="info-list">
    <li><span class="card__icon tone-1">${icon('pin')}</span><span><strong>${u('contactInfo.address')}</strong>${fill(contact.address)}${contact.postalCode ? `, ${fill(contact.postalCode)}` : ''} ${fill(contact.city)}${contact.mapsUrl ? `<br><a href="${esc(contact.mapsUrl)}" target="_blank" rel="noopener">${u('contactInfo.directions')}<span class="visually-hidden"> ${u('newTab')}</span></a>` : ''}</span></li>
    ${tel ? `<li><span class="card__icon tone-2">${icon('phone')}</span><span><strong>${u('contactInfo.phone')}</strong><a href="${tel}">${fill(contact.phoneDisplay || contact.phone)}</a></span></li>` : ''}
    ${WA ? `<li><span class="card__icon tone-3">${icon('whatsapp')}</span><span><strong>${u('contactInfo.whatsapp')}</strong><a href="${esc(waUrl(contact.whatsappMessage))}" target="_blank" rel="noopener">${u('writeUs')}<span class="visually-hidden"> ${u('newTab')}</span></a></span></li>` : ''}
    ${contact.email ? `<li><span class="card__icon tone-4">${icon('mail')}</span><span><strong>${u('contactInfo.email')}</strong><a href="mailto:${esc(contact.email)}">${fill(contact.email)}</a></span></li>` : ''}
    <li><span class="card__icon tone-5">${icon('clock')}</span><span><strong>${u('contactInfo.hours')}</strong>${hoursDl()}</span></li>
  </ul>`;
}
function mapBlock(root) {
  if (contact.mapsEmbed) return `<div class="map"><iframe src="${esc(contact.mapsEmbed)}" title="${u('contactInfo.map', { brand: brand.name })}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
  const img = findImage(contact.image, 'local');
  return `<div class="map">${img ? `<img src="${esc(imgSrc(img, root))}" alt="${esc(contact.imageAlt || tx('contactInfo.facade', { brand: brand.name }))}" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : imgSlot('static/src/assets/img/local.jpg (o contact.mapsEmbed)')}</div>`;
}

/** Formulario: POST a contact.formEndpoint si existe; si no, abre WhatsApp con los datos.
    Los mensajes de estado viajan en data-msg-* (main.js no lleva textos propios). */
function formAttrs(kind, intro) {
  const ep = contact.formEndpoint;
  const common = `data-form="${kind}" data-wa="${WA}" data-wa-intro="${esc(intro)}" data-msg-invalid="${u('form.invalid')}" data-msg-ok="${u('form.ok')}" data-msg-error="${u('form.error')}" data-msg-wa="${u('form.wa')}" data-msg-sending="${u('form.sending')}" novalidate`;
  return ep ? `action="${esc(ep)}" method="post" data-endpoint="${esc(ep)}" ${common}` : `action="https://wa.me/${WA}" method="get" target="_blank" ${common}`;
}
function privacyCheck(root, id) {
  return `<div class="check"><input type="checkbox" id="${id}" name="privacidad" value="acepto" required aria-required="true"><label for="${id}">${esc(legal.privacyText || tx('form.privacyDefault'))} <a href="${root}privacidad/">${u('form.privacyLink')}</a>. <span aria-hidden="true">*</span></label></div>`;
}
function contactForm(root, preselect = '') {
  const ep = contact.formEndpoint;
  const opt = `<span class="opt">${u('form.optional')}</span>`;
  const opts = categories.map((c) => {
    const ts = byCat(c.id); if (!ts.length) return '';
    return `<optgroup label="${esc(c.name)}">${ts.map((x) => `<option${x.name === preselect ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`;
  }).join('');
  return `<form class="form form--card" ${formAttrs('contact', contact.whatsappMessage || tx('form.hello'))} aria-labelledby="form-title">
    <h2 id="form-title" style="font-size:1.6rem">${u('form.title')}</h2>
    <p class="form__hint">${u('form.hint')}</p>
    <div class="form__row">
      <div class="field"><label for="f-name">${u('form.name')} *</label><input id="f-name" name="nombre" autocomplete="name" required aria-required="true" data-wa-label="${u('form.name')}"></div>
      <div class="field"><label for="f-tel">${u('form.phone')} *</label><input id="f-tel" name="telefono" type="tel" autocomplete="tel" inputmode="tel" required aria-required="true" data-wa-label="${u('form.phone')}"></div>
    </div>
    <div class="form__row">
      <div class="field"><label for="f-email">${u('form.email')} ${opt}</label><input id="f-email" name="email" type="email" autocomplete="email" data-wa-label="${u('form.email')}"></div>
      <div class="field"><label for="f-pref">${u('form.pref')} ${opt}</label><select id="f-pref" name="preferencia" data-wa-label="${u('form.waPref')}"><option value="">${u('form.prefAny')}</option><option>${u('form.prefMorning')}</option><option>${u('form.prefAfternoon')}</option></select></div>
    </div>
    <div class="field"><label for="f-tr">${u('form.treatment')} ${opt}</label><select id="f-tr" name="tratamiento" data-wa-label="${u('form.waTreatment')}"><option value="">${u('form.treatmentNone')}</option>${opts}</select></div>
    <div class="field"><label for="f-msg">${u('form.message')} ${opt}</label><textarea id="f-msg" name="${ep ? 'mensaje' : 'text'}" data-wa-label="${u('form.message')}"></textarea></div>
    <div class="hp" aria-hidden="true"><label for="f-gotcha">${u('form.honeypot')}</label><input id="f-gotcha" name="_gotcha" tabindex="-1" autocomplete="off"></div>
    ${privacyCheck(root, 'f-priv')}
    <button class="btn btn--block" type="submit">${icon(ep ? 'mail' : 'whatsapp')}<span>${ep ? u('form.submit') : u('form.submitWa')}</span></button>
    <p class="form__status" role="status" aria-live="polite"></p>
  </form>`;
}

/* ==========================================================================
   8. Páginas
   ========================================================================== */

/* ---------- Inicio: hero inmersivo ----------
   HTML completo y legible sin JS (hero normal). Con JS y sin reduced-motion, main.js
   añade .hx-on: escena fijada (sticky) cuyo progreso de scroll dirige la coreografía. */
const wordsOf = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);
const bare = (w) => String(w ?? '').replace(/[^\p{L}\p{N}'’-]/gu, '');
/** Divide un texto en palabras (sin cortes) y letras para la máscara de entrada. Siempre aria-hidden fuera. */
function splitChars(text, start = 0) {
  let i = start;
  const html = wordsOf(text).map((w) => `<span class="hx-w">${[...w].map((c) => `<span class="hx-ch" style="--i:${i++}">${esc(c)}</span>`).join('')}</span>`).join(' ');
  return { html, next: i };
}
function heroImmersive(root, h, heroImg) {
  const stats = arr(site.stats);
  const big = arr(h.bigWords).length ? arr(h.bigWords).slice(0, 2) : [bare(wordsOf(h.title)[0]), bare(wordsOf(h.titleAccent || h.title).slice(-1)[0])].filter(Boolean);
  const l1 = splitChars(h.title);
  const l2 = h.titleAccent ? splitChars(h.titleAccent, l1.next) : null;
  const L = (cls, z, fly, depth, rot, d, inner) => `<div class="hx__layer ${cls}" data-z="${z}" data-fly="${fly}" data-depth="${depth}" data-rot="${rot}" style="--d:${d}"><div class="hx__in">${inner}</div></div>`;
  let r = 0; // índice de revelado escalonado
  const rv = () => ` data-hx-reveal="${r++}"`;
  return `<section class="hero hero--immersive" aria-labelledby="hero-title" data-immersive>
  <div class="hx__track">
    <div class="hx__stage">
      <div class="hx__bg hx__bg--1" aria-hidden="true"></div>
      <div class="hx__bg hx__bg--2" aria-hidden="true"></div>
      <div class="hx__bg hx__bg--3" aria-hidden="true"></div>
      <div class="hx__glow" aria-hidden="true"></div>
      <div class="hx__words" aria-hidden="true">${big.map((w, i) => `<span class="hx__word hx__word--${i ? 'r' : 'l'}"><span class="hx__in">${esc(w)}</span></span>`).join('')}</div>
      <div class="hx__scene" aria-hidden="true"><div class="hx__rig">
        ${L('hx-l--blob-a', -320, 760, 0.35, 8, 0, blob('', 'pink', 'coral', 0))}
        ${L('hx-l--blob-b', -220, 900, 0.45, -10, 1, blob('', 'sage', 'cream', 1))}
        ${L('hx-l--leaf-far hx-d', -420, -650, 0.25, 14, 2, leaf('', 'sage'))}
        ${L('hx-l--ring-a', -160, 820, 0.7, 0, 3, '<span class="hx-ring"></span>')}
        ${L('hx-l--ring-b hx-d', -60, 640, 0.9, 0, 4, '<span class="hx-ring hx-ring--thin"></span>')}
        ${L('hx-l--dot-a', 40, 700, 1.1, 0, 5, '<span class="hx-dot"></span>')}
        ${L('hx-l--dot-b hx-d', -260, 980, 0.55, 0, 6, '<span class="hx-dot hx-dot--sm"></span>')}
        ${L('hx-l--blob-c', 0, 560, 0.85, 20, 7, blob('', 'gold', 'pink', 1))}
        ${L('hx-l--palm-a', 120, 700, 1.25, -12, 8, palm('', 'sage'))}
        ${L('hx-l--palm-b', 160, 780, 1.35, 10, 9, palm('', 'green'))}
        ${L('hx-l--sparkles', 60, 420, 1.5, 0, 10, sparkles('deco-sparkles', 10))}
      </div></div>
      <canvas class="hx__particles" aria-hidden="true"></canvas>
      <div class="container hx__content">
        ${h.eyebrow ? `<p class="eyebrow hx__eyebrow"${rv()}>${esc(h.eyebrow)}</p>` : ''}
        <h1 id="hero-title" class="hx-title"><span class="visually-hidden">${esc([h.title, h.titleAccent].filter(Boolean).join(' '))}</span><span class="hx-title__line hx-title__line--1" aria-hidden="true">${l1.html}</span>${l2 ? ` <span class="hx-title__line hx-title__line--2 accent" aria-hidden="true">${l2.html}</span>` : ''}</h1>
        <div class="hx__body">
          ${h.subtitle ? `<p class="hero__subtitle"${rv()}>${esc(h.subtitle)}</p>` : ''}
          <div class="btn-row"${rv()}>
            ${h.ctaPrimary ? `<a class="btn" href="${esc(link(h.ctaPrimary.href, root))}"${extAttrs(h.ctaPrimary.href)}>${icon('calendar')}<span>${esc(h.ctaPrimary.label)}</span></a>` : ''}
            ${h.ctaSecondary ? `<a class="btn btn--ghost" href="${esc(link(h.ctaSecondary.href, root))}"${extAttrs(h.ctaSecondary.href)}><span>${esc(h.ctaSecondary.label)}</span>${icon('arrow')}</a>` : ''}
          </div>
          ${stats.length ? `<ul class="hx-stats"${rv()}>${stats.map((s) => `<li><span class="hx-stats__value">${esc(s.value)}</span><span class="hx-stats__label">${esc(s.label)}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="hx__visual">
          <div class="arch__ring" aria-hidden="true"></div>
          <div class="arch">${heroImg ? `<img src="${esc(imgSrc(heroImg, root))}" alt="${esc(h.imageAlt || '')}" fetchpriority="high">` : imgSlot('static/src/assets/img/hero.jpg')}</div>
        </div>
      </div>
      <p class="hx__hint" aria-hidden="true"><span>${esc(h.scrollHint || tx('scrollHint'))}</span><span class="hx__hint-line"></span></p>
    </div>
  </div>
</section>`;
}

/* ---------- Inicio ---------- */
/* ==========================================================================
   Mapa corporal (content/bodymap.json): recorrido por zonas del cuerpo.
   El HTML es completo sin JS (silueta SVG + acordeón con textos y enlaces).
   js/bodymap.js lo convierte en una escena 3D fijada (Three.js, cargado solo
   cuando la sección se acerca) si hay WebGL y no hay prefers-reduced-motion.
   ========================================================================== */
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const { PRIMS: BM_PRIMS, expand: bmExpand } = await import(pathToFileURL(join(SRC, 'js', 'bodymap-figure.js')).href);
const bmNum = (v, d = 0) => (isNum(v) ? v : d);
function bodymapSilhouette(zones) {
  // Proyección frontal de la misma figura procedural que usa la escena 3D
  const S = 200, X = (x) => +(100 + x * S).toFixed(1), Y = (y) => +((1.84 - y) * S).toFixed(1), f = (v) => v.toFixed(1);
  const shapes = bmExpand(BM_PRIMS).map((p) => {
    if (p.t === 'e') return `<ellipse cx="${X(p.c[0])}" cy="${Y(p.c[1])}" rx="${f(p.r[0] * S)}" ry="${f(p.r[1] * S)}"/>`;
    const ax = X(p.a[0]), ay = Y(p.a[1]), bx = X(p.b[0]), by = Y(p.b[1]), ra = p.ra * S, rb = p.rb * S;
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const pts = [[ax + nx * ra, ay + ny * ra], [bx + nx * rb, by + ny * rb], [bx - nx * rb, by - ny * rb], [ax - nx * ra, ay - ny * ra]].map((q) => q.map(f).join(',')).join(' ');
    return `<circle cx="${ax}" cy="${ay}" r="${f(ra)}"/><circle cx="${bx}" cy="${by}" r="${f(rb)}"/><polygon points="${pts}"/>`;
  }).join('');
  const marks = zones.map((z, i) => (Array.isArray(z.anchor) && z.anchor.length === 3
    ? `<g class="bm-sil__mark" transform="translate(${X(bmNum(z.anchor[0]))} ${Y(bmNum(z.anchor[1]))})"><circle r="6.5"/><text y="2.6">${i + 1}</text></g>` : '')).join('');
  return `<svg class="bm-sil" viewBox="22 6 156 370" aria-hidden="true" focusable="false"><defs><linearGradient id="bm-sil-g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" style="stop-color:var(--c-cream)"/><stop offset="1" style="stop-color:var(--c-nude)"/></linearGradient><g id="bm-sil-shape">${shapes}</g></defs><ellipse class="bm-sil__floor" cx="100" cy="369" rx="46" ry="5"/><use href="#bm-sil-shape" class="bm-sil__line"/><use href="#bm-sil-shape" class="bm-sil__fill"/>${marks}</svg>`;
}
function bodymapSection(root) {
  const bm = bodymap || {};
  const zones = arr(bm.zones).filter((z) => isObj(z) && z.id && z.label);
  if (!zones.length) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const items = zones.map((z, i) => {
    const trs = arr(z.treatments).map((id) => {
      if (!trById[id]) warn(`bodymap.json: la zona "${z.id}" usa el tratamiento inexistente "${id}" (se ignora)`);
      return trById[id];
    }).filter(Boolean);
    const v = isObj(z.view) ? z.view : {};
    const a = Array.isArray(z.anchor) ? z.anchor : [0, 0.95, 0];
    return `<li class="bm-zone" id="bm-z-${esc(z.id)}" data-zone="${esc(z.id)}" data-view="${bmNum(v.azimuth)},${bmNum(v.elevation, 5)},${bmNum(v.zoom, 1.5)}" data-anchor="${[0, 1, 2].map((k) => bmNum(a[k])).join(',')}">
      <details class="bm-zone__details"${i === 0 ? ' open' : ''}>
        <summary><span class="bm-zone__num" aria-hidden="true">${pad(i + 1)}</span><h3 class="bm-zone__title">${esc(z.label)}</h3><span class="bm-zone__chev" aria-hidden="true"></span></summary>
        <div class="bm-zone__body">
          ${z.text ? `<p class="bm-zone__text">${esc(z.text)}</p>` : ''}
          ${trs.length ? `<p class="bm-zone__tlabel">${u('bodymap.treatments')}</p>
          <ul class="bm-zone__list">${trs.map((t) => { const pf = priceFromOf(t); return `<li><a href="${root}tratamientos/${esc(t.id)}/"><span class="bm-zone__tname">${esc(t.name)}</span>${isFinite(pf) ? `<span class="bm-zone__price">${u('from')} ${money(pf)}</span>` : ''}${icon('arrow')}</a></li>`; }).join('')}</ul>` : ''}
        </div>
      </details>
    </li>`;
  }).join('\n    ');
  return `<section class="section bm" id="zonas" aria-labelledby="bm-title" data-bodymap data-three="${esc(THREE_URL)}" data-nav="${u('bodymap.nav')}" data-goto="${u('bodymap.goTo')}" data-counter="${u('bodymap.counter')}" data-hint="${u('bodymap.hint')}" data-overview="${u('bodymap.overview')}">
  <a class="bm__skip" href="#bm-end">${u('bodymap.skip')}</a>
  <div class="container">
    <div class="section__head section__head--center bm__head">${bm.eyebrow ? `<p class="eyebrow">${esc(bm.eyebrow)}</p>` : ''}<h2 id="bm-title">${esc(bm.title)}${bm.titleAccent ? ` <span class="accent">${esc(bm.titleAccent)}</span>` : ''}</h2>${bm.intro ? `<p class="bm__intro">${esc(bm.intro)}</p>` : ''}<p class="bm__jump"><a class="link-arrow" href="#bm-end">${u('bodymap.jump')} ${icon('arrow')}</a></p></div>
    <div class="bm__static">
      <div class="bm__figure">${bodymapSilhouette(zones)}</div>
      <div class="bm__zones">
        <p class="bm__hint-static">${u('bodymap.staticHint')}</p>
        <ol class="bm-list" role="list">
    ${items}
        </ol>
      </div>
    </div>
  </div>
  <span class="bm__end" id="bm-end" tabindex="-1"></span>
  <script type="module" src="${root}${LANG_UP}js/bodymap.js?v=${VERSION}"></script>
</section>`;
}

function pageHome() {
  const h = site.hero || {};
  const heroImg = findImage(h.image, 'hero');
  const testi = site.testimonials || {};
  const lm = mk.leadMagnet;
  const immersive = h.immersive !== false;
  const statsHtml = !immersive && arr(site.stats).length ? `<div class="container stats"><ul class="stats__list reveal">${arr(site.stats).map((s) => `<li class="stat"><span class="stat__value">${esc(s.value)}</span><span class="stat__label">${esc(s.label)}</span></li>`).join('')}</ul></div>` : '';
  const body = (root) => `
${immersive ? heroImmersive(root, h, heroImg) : `<section class="hero" aria-labelledby="hero-title" data-parallax-scope>
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
</section>`}
${statsHtml}

${categories.length ? `<section class="section" aria-labelledby="cats-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('homePage.catsEyebrow')}</p><h2 id="cats-title">${rich('homePage.catsTitle')}</h2><p>${u('homePage.catsText')}</p></div>
    <div class="grid grid--3">${categories.map((c, i) => `<article class="card cat-card reveal tone-${(i % 5) + 1}" style="--i:${i % 3}">
      <span class="card__icon">${icon(ic(c.icon))}</span>
      <h3><a class="card__link" href="${root}tratamientos/#${esc(c.id)}">${esc(c.name)}</a></h3>
      ${c.intro ? `<p>${esc(c.intro)}</p>` : ''}
      <span class="cat-card__count">${u(byCat(c.id).length === 1 ? 'countOne' : 'countMany', { n: byCat(c.id).length })}</span>
    </article>`).join('')}</div>
  </div>
</section>` : ''}

${featured.length ? `<section class="section section--white" aria-labelledby="feat-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('homePage.featEyebrow')}</p><h2 id="feat-title">${rich('homePage.featTitle')}</h2></div>
    <div class="grid grid--3">${featured.map((t, i) => treatmentCard(t, root, i)).join('')}</div>
    <p style="margin-top:2rem"><a class="link-arrow" href="${root}tratamientos/">${u('seeAll')} ${icon('arrow')}</a></p>
  </div>
</section>` : ''}

${aboutSection()}

${arr(site.whyUs).length ? `<section class="section" aria-labelledby="why-title">
  <div class="container">
    <div class="section__head section__head--center"><p class="eyebrow">${u('homePage.whyEyebrow')}</p><h2 id="why-title">${rich('homePage.whyTitle')}</h2></div>
    <div class="grid grid--4">${arr(site.whyUs).map((w, i) => `<article class="card why reveal" style="--i:${i}"><span class="card__icon">${icon(ic(w.icon))}</span><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></article>`).join('')}</div>
  </div>
</section>` : ''}

${packs.aloha || packs.ohana ? `<section class="section section--nude" aria-labelledby="clubs-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('homePage.clubsEyebrow')}</p><h2 id="clubs-title">${rich('homePage.clubsTitle')}</h2></div>
    <div class="duo">${['aloha', 'ohana'].filter((k) => packs[k]).map((k) => { const p = packs[k]; return `<article class="club club--${k} reveal">
      ${k === 'aloha' ? palm('club__deco', 'white') : leaf('club__deco', 'white')}
      <p class="club__subtitle">${esc(p.subtitle)}</p>
      <h3 class="club__name">${esc(p.name)}</h3>
      <p>${esc(p.description)}</p>
      ${arr(p.perks).length ? `<ul class="checklist">${arr(p.perks).slice(0, 3).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      <p><a class="btn btn--ink" href="${root}packs/#${k}">${esc(p.cta || tx('seeMore'))} ${icon('arrow')}</a></p>
    </article>`; }).join('')}</div>
  </div>
</section>` : ''}

${activePromos.length ? `<section class="section" aria-labelledby="promos-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('homePage.promosEyebrow')}</p><h2 id="promos-title">${rich('homePage.promosTitle')}</h2></div>
    <div class="grid grid--3">${activePromos.map(promoCard).join('')}</div>
  </div>
</section>` : ''}

${arr(testi.items).length ? `<section class="section section--white" aria-labelledby="reviews-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('homePage.reviewsEyebrow')}</p><h2 id="reviews-title">${rich('homePage.reviewsTitle')}</h2></div>
    ${testi.isPlaceholder ? `<div class="notice" role="note">${icon('info')}<p>${rich('reviewsNotice')}</p></div>` : ''}
    <div class="grid grid--3">${arr(testi.items).map((r, i) => `<figure class="card review reveal${testi.isPlaceholder ? ' review--placeholder' : ''}" style="--i:${i}">
      ${testi.isPlaceholder ? `<span class="tag-example">${u('example')}</span>` : `<span class="stars" role="img" aria-label="${u('stars')}">${icon('star').repeat(5)}</span>`}
      <blockquote><p style="margin:0">${esc(r.text)}</p></blockquote>
      <figcaption><strong>${esc(r.name)}</strong>${r.treatment ? esc(r.treatment) : ''}</figcaption>
    </figure>`).join('')}</div>
  </div>
</section>` : ''}

${lm && lm.title ? `<section class="section" aria-labelledby="lead-title">
  <div class="container">
    <div class="lead-box reveal">
      ${sparkles('lead-box__deco', 6)}
      <div><p class="eyebrow">${u('homePage.leadEyebrow')}</p><h2 id="lead-title">${esc(lm.title)}</h2><p>${esc(lm.text)}</p></div>
      <form class="form" ${formAttrs('lead', lm.title)} aria-labelledby="lead-title">
        <div class="field"><label for="l-email">${u('form.leadEmail')} *</label><input id="l-email" name="email" type="email" autocomplete="email" required aria-required="true" data-wa-label="${u('form.email')}"></div>
        <div class="hp" aria-hidden="true"><label for="l-gotcha">${u('form.honeypot')}</label><input id="l-gotcha" name="_gotcha" tabindex="-1" autocomplete="off"></div>
        <input type="hidden" name="origen" value="lead-magnet">
        ${privacyCheck(root, 'l-priv')}
        <button class="btn" type="submit">${icon('gift')}<span>${esc(lm.cta || tx('form.leadCta'))}</span></button>
        <p class="form__status" role="status" aria-live="polite"></p>
      </form>
    </div>
  </div>
</section>` : ''}

${arr(mk.faqGeneral).length ? `<section class="section section--sage" aria-labelledby="faq-title">
  <div class="container container--narrow">
    <div class="section__head section__head--center"><p class="eyebrow">${u('homePage.faqEyebrow')}</p><h2 id="faq-title">${rich('homePage.faqTitle')}</h2></div>
    ${faqList(mk.faqGeneral)}
  </div>
</section>` : ''}
`;
  const contactSection = (root) => `<section class="section section--white" id="contacto" aria-labelledby="contact-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('homePage.contactEyebrow')}</p><h2 id="contact-title">${rich('homePage.contactTitle')}</h2></div>
    <div class="contact-grid"><div>${contactInfo(root)}<div class="btn-row">${waBtn(contact.whatsappMessage, tx('whatsappLong'))}${callBtn()}</div></div>${mapBlock(root)}</div>
  </div>
</section>`;
  // En portada: CTA reservar antes del bloque de contacto
  const html = layout({
    path: '', title: '', description: seo.defaultDescription, current: '#home',
    body: (root) => body(root) + ctaReservar(root) + contactSection(root), cta: false,
    ld: [faqLd(mk.faqGeneral)].filter(Boolean),
  });
  writePage('', html);
}

/** «Quiénes somos» (site.about): texto + claves destacadas. Si no hay `about`, no se muestra. */
function aboutSection() {
  const a = site.about;
  if (!a || !(a.title || arr(a.paragraphs).length)) return '';
  const hl = arr(a.highlights);
  return `<section class="section section--white about" id="quienes-somos" aria-labelledby="about-title">
  ${leaf('about__deco', 'sage')}
  <div class="container about__grid">
    <div class="about__text reveal">
      ${a.eyebrow ? `<p class="eyebrow">${esc(a.eyebrow)}</p>` : ''}
      <h2 id="about-title">${esc(a.title)}${a.titleAccent ? ` <span class="accent">${esc(a.titleAccent)}</span>` : ''}</h2>
      <div class="prose">${arr(a.paragraphs).map((p) => `<p>${fill(p)}</p>`).join('')}</div>
    </div>
    ${hl.length ? `<ul class="about__highlights">${hl.map((x, i) => `<li class="card about__item reveal tone-${(i % 5) + 1}" style="--i:${i}"><span class="card__icon">${icon(ic(x.icon))}</span><div><h3>${esc(x.title)}</h3>${x.text ? `<p>${esc(x.text)}</p>` : ''}</div></li>`).join('')}</ul>` : ''}
  </div>
</section>`;
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
    path: 'tratamientos/', current: 'tratamientos/', title: tx('catalog.title'),
    description: tx('catalog.description', { brand: brand.name, cats: categories.map((c) => c.name).join(', ') }),
    ld: [breadcrumbLd([{ label: tx('catalog.title'), path: 'tratamientos/' }])].filter(Boolean),
    body: (root) => `
${pageHero({ root, crumbs: [{ label: tx('catalog.title') }], eyebrow: tx('catalog.eyebrow'), title: rich('catalog.heading'), lead: tx('catalog.lead') })}
${bodymapSection(root)}
<section class="section" aria-label="${u('catalog.listLabel')}">
  <div class="container">
    <div class="filters js-only" role="group" aria-label="${u('catalog.filterLabel')}" data-filter-bar data-count-one="${u('countOne')}" data-count-many="${u('countMany')}">
      <button class="filter-btn" type="button" data-filter="all" aria-pressed="true">${u('catalog.all')}</button>
      ${categories.filter((c) => byCat(c.id).length).map((c) => `<button class="filter-btn" type="button" data-filter="${esc(c.id)}" aria-pressed="false">${icon(ic(c.icon))}${esc(c.name)}</button>`).join('')}
    </div>
    <p id="filter-status" class="visually-hidden" role="status" aria-live="polite"></p>
    ${categories.filter((c) => byCat(c.id).length).map((c) => `<section class="cat-group" id="${esc(c.id)}" data-cat-group="${esc(c.id)}" aria-labelledby="h-${esc(c.id)}">
      <div class="cat-group__head"><span class="card__icon tone-2">${icon(ic(c.icon))}</span><div><h2 id="h-${esc(c.id)}">${esc(c.name)}</h2>${c.intro ? `<p>${esc(c.intro)}</p>` : ''}</div></div>
      <div class="grid grid--3">${byCat(c.id).map((t, i) => treatmentCard(t, root, i)).join('')}</div>
    </section>`).join('')}
    ${treatments.filter((t) => !catById[t.category]).length ? `<section class="cat-group" data-cat-group="otros" aria-labelledby="h-otros"><h2 id="h-otros">${u('catalog.others')}</h2><div class="grid grid--3">${treatments.filter((t) => !catById[t.category]).map((t, i) => treatmentCard(t, root, i)).join('')}</div></section>` : ''}
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
  // «Combina con»: ids de `combinesWith` que existan (se ignoran los desconocidos con aviso)
  const combines = arr(t.combinesWith).map((id) => {
    const x = treatments.find((y) => y.id === id && y.id !== t.id);
    if (!x) warn(`"${t.id}": combinesWith apunta a un tratamiento inexistente "${id}"`);
    return x;
  }).filter(Boolean);
  const related = (() => {
    const same = treatments.filter((x) => x.category === t.category && x.id !== t.id && !combines.includes(x));
    const rest = featured.filter((x) => x.id !== t.id && !same.includes(x) && !combines.includes(x));
    return [...same, ...rest].slice(0, 3);
  })();
  const ROOT_PLACEHOLDER = '\u0000ROOT\u0000'; // se sustituye por `root` en body() (enlaces de «Combina con»)
  const S = []; // secciones presentes (para el subíndice)
  const T = (k, v) => tx(`treatment.${k}`, v); // `t` es el tratamiento en esta función
  const sec = (id, title, iconName, inner, cls = '') => { S.push([id, title]); return `<section class="ficha-section reveal ${cls}" id="${id}" aria-labelledby="${id}-t"><h2 id="${id}-t"><span class="card__icon">${icon(iconName)}</span>${esc(title)}</h2>${inner}</section>`; };

  const prices = arr(t.prices);
  const priceRows = prices.length ? prices.map((p) => `<tr><th scope="row">${esc(p.label)}${p.note ? `<br><span class="small">${esc(p.note)}</span>` : ''}</th><td class="num">${isNum(p.oldPrice) && p.oldPrice > p.price ? `<del><span class="visually-hidden">${u('before')} </span>${money(p.oldPrice)}</del>` : ''}<span class="price">${p.from ? `${u('from')} ` : ''}${money(p.price)}</span>${saving(p.price, p.oldPrice) ? `<br>${savingHtml(saving(p.price, p.oldPrice))}` : ''}</td></tr>`).join('')
    : `<tr><th scope="row">${esc(t.name)}</th><td class="num"><span class="price">${isFinite(pf) ? `${u('from')} ${money(pf)}` : u('consult')}</span></td></tr>`;

  const sections = [
    t.whatIs ? sec('que-es', T('whatIs'), 'info', `<div class="prose"><p>${esc(t.whatIs)}</p></div>`) : '',
    t.mechanism ? sec('como-actua', T('mechanism'), 'glow', `<div class="mechanism"><span class="mechanism__eyebrow">${esc(T('mechanismEyebrow'))}</span><p>${esc(t.mechanism)}</p></div>`, 'ficha-section--mechanism') : '',
    arr(t.benefits).length ? sec('beneficios', T('benefits'), 'sparkle', `<div class="grid grid--3">${arr(t.benefits).map((b, i) => `<article class="card tone-${(i % 5) + 1}"><span class="card__icon">${icon('check')}</span><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></article>`).join('')}</div>`) : '',
    arr(t.idealFor).length ? sec('para-quien', T('idealFor'), 'heart', `<div class="panel"><ul class="checklist">${arr(t.idealFor).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul></div>`) : '',
    arr(t.howItWorks).length ? sec('sesion', T('session'), 'clock', `<ol class="steps">${arr(t.howItWorks).map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>`) : '',
    t.results ? sec('resultados', T('results'), 'star', `<div class="results">${icon('glow')}<div><p>${esc(t.results)}</p><p class="small" style="margin-top:.5rem">${esc(T('resultsNote'))}</p></div></div>`) : '',
    combines.length ? sec('combina', T('combines'), 'heart', `<p class="combina__intro">${esc(T('combinesIntro'))}</p><ul class="combina" role="list">${combines.map((x) => `<li><a class="combina__card" href="${ROOT_PLACEHOLDER}tratamientos/${esc(x.id)}/"><span class="card__icon">${icon(ic(x.icon || catById[x.category]?.icon))}</span><span class="combina__text"><span class="combina__name">${esc(x.name)}</span>${x.short ? `<span class="combina__short">${esc(x.short)}</span>` : ''}</span><span class="combina__arrow" aria-hidden="true">${icon('arrow')}</span></a></li>`).join('')}</ul>`) : '',
    (arr(t.aftercare).length || arr(t.contraindications).length) ? (() => {
      S.push(['cuidados', T('careAndContra')]);
      return `<div class="ficha-section two-col reveal" id="cuidados">
        ${arr(t.aftercare).length ? `<section class="panel" aria-labelledby="cuidados-t"><h2 id="cuidados-t">${icon('leaf')}${esc(T('aftercare'))}</h2><ul class="dotlist">${arr(t.aftercare).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
        ${arr(t.contraindications).length ? `<section class="panel panel--warn" id="contraindicaciones" aria-labelledby="contra-t"><h2 id="contra-t">${icon('alert')}${esc(T('contraindications'))}</h2><ul class="dotlist">${arr(t.contraindications).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="small" style="margin:1rem 0 0">${esc(T('contraNote'))}</p></section>` : ''}
      </div>`;
    })() : '',
    arr(t.faq).length ? sec('preguntas', T('faq'), 'info', faqList(t.faq)) : '',
    sec('precios', T('prices'), 'gift', `<div class="price-table"><div class="table-scroll"><table><caption class="visually-hidden">${esc(T('pricesCaption', { name: t.name }))}</caption><thead><tr><th scope="col">${esc(T('option'))}</th><th scope="col" class="num">${esc(T('price'))}</th></tr></thead><tbody>${priceRows}</tbody></table></div></div>
      <p class="disclaimer">${icon('info')}<span>${esc(t.priceNote ? `${t.priceNote}. ` : '')}${esc(legal.priceDisclaimer)}</span></p>
      <div class="btn-row" style="margin-top:1.25rem">${waBtn(waText, T('book', { name: t.name }))}${bookingBtn()}${callBtn()}</div>`),
  ].join('\n');

  const facts = [
    t.duration ? ['clock', esc(T('duration')), esc(t.duration)] : null,
    t.sessions ? ['calendar', esc(T('sessions')), esc(t.sessions)] : null,
    Number.isFinite(pain) ? ['heart', esc(T('pain')), `${esc(PAIN(pain))}<span class="pain" role="img" aria-label="${u('painOf', { n: pain })}">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= pain ? 'on' : ''}"></span>`).join('')}</span>`] : null,
    isFinite(pf) ? ['gift', esc(T('price')), `${u('from')} ${money(pf)}`] : null,
  ].filter(Boolean);

  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'Service', name: t.name, description: t.whatIs || t.short,
      serviceType: cat?.name, url: pageUrl(path) || undefined,
      image: img ? abs(img) || undefined : undefined,
      provider: { '@type': 'BeautySalon', name: brand.name, '@id': SITE_URL ? `${SITE_URL}#negocio` : undefined },
      areaServed: contact.city && !/POR DEFINIR/i.test(contact.city) ? contact.city : undefined,
      offers: prices.filter((p) => isNum(p.price) && p.price > 0).map((p) => ({ '@type': 'Offer', name: p.label, price: p.price, priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url: pageUrl(path) || undefined })),
    },
    faqLd(t.faq),
    breadcrumbLd([{ label: tx('catalog.title'), path: 'tratamientos/' }, { label: t.name, path }]),
  ].filter(Boolean);

  const html = layout({
    path, current: 'tratamientos/', title: t.name, ogType: 'article', ogImage: img && !ext(img) ? img : undefined,
    description: [t.short, t.hook].filter(Boolean).join(' ').slice(0, 160) || seo.defaultDescription,
    cta: { waText, title: tx('cta.treatmentTitle', { name: t.name }) },
    ld,
    body: (root) => {
      const hero = pageHero({
        root, id: 'ficha-title',
        crumbs: [{ label: tx('catalog.title'), href: `${root}tratamientos/` }, ...(cat ? [{ label: cat.name, href: `${root}tratamientos/#${cat.id}` }] : []), { label: t.name }],
        eyebrow: cat?.name, title: esc(t.name),
        extra: '',
      });
      // Insertamos el bloque de ficha (hook, datos rápidos, CTA, imagen) dentro del hero
      const heroInner = `<div class="ficha-hero__grid">
        <div>
          ${t.hook ? `<p class="lead" style="font-family:var(--font-heading);font-style:italic;color:var(--c-ink);font-size:clamp(1.25rem,1.1rem + .8vw,1.65rem)">${esc(t.hook)}</p>` : ''}
          ${t.short ? `<p class="lead">${esc(t.short)}</p>` : ''}
          ${facts.length ? `<ul class="facts">${facts.map(([i, l, v]) => `<li class="fact"><span class="fact__label">${icon(i)}${l}</span><span class="fact__value">${v}</span></li>`).join('')}</ul>` : ''}
          <div class="btn-row">${waBtn(waText, T('bookWa'))}${bookingBtn()}<a class="btn btn--ghost" href="#precios">${esc(T('seePrices'))}</a></div>
        </div>
        <div class="media">${img ? `<img src="${esc(imgSrc(img, root))}" alt="${esc(t.imageAlt || t.name)}" fetchpriority="high">` : imgSlot(`static/src/assets/img/tratamientos/${t.id}.jpg`)}</div>
      </div>`;
      const heroHtml = hero.replace('</h1>', `</h1>${heroInner}`);
      const subnav = `<nav class="ficha-nav" aria-label="${esc(T('subnav'))}"><div class="container"><ul>${S.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></div></nav>`;
      const rel = related.length ? `<section class="section section--white" aria-labelledby="rel-title"><div class="container"><div class="section__head"><p class="eyebrow">${esc(T('relEyebrow'))}</p><h2 id="rel-title">${rich('treatment.relTitle')}</h2></div><div class="grid grid--3">${related.map((x, i) => treatmentCard(x, root, i)).join('')}</div></div></section>` : '';
      return `${heroHtml}\n${subnav}\n<div class="section"><div class="container">${sections.split(ROOT_PLACEHOLDER).join(root)}</div></div>\n${rel}`;
    },
  });
  writePage(path, html);
}

/* ---------- Precios ---------- */
function pagePrices() {
  const cats = categories.filter((c) => byCat(c.id).length);
  const table = (c) => {
    const rows = byCat(c.id).map((t) => {
      const ps = arr(t.prices).length ? arr(t.prices) : [{ label: t.priceFrom ? tx('prices.fromLabel') : '—', price: t.priceFrom }];
      return ps.map((p, i) => `<tr>${i === 0 ? `<th scope="rowgroup" rowspan="${ps.length}"><a href="../tratamientos/${esc(t.id)}/">${esc(t.name)}</a>${t.priceNote ? `<br><span class="small">${esc(t.priceNote)}</span>` : ''}</th>` : ''}<td>${esc(p.label)}${p.note ? `<br><span class="small">${esc(p.note)}</span>` : ''}</td><td class="num">${isNum(p.oldPrice) && p.oldPrice > p.price ? `<del><span class="visually-hidden">${u('before')} </span>${money(p.oldPrice)}</del>` : ''}<span class="price">${p.from ? `${u('from')} ` : ''}${money(p.price)}</span>${saving(p.price, p.oldPrice) ? `<br>${savingHtml(saving(p.price, p.oldPrice))}` : ''}</td></tr>`).join('');
    }).join('');
    return `<div class="price-table"><div class="table-scroll"><table><caption class="visually-hidden">${u('prices.caption', { name: c.name })}</caption><thead><tr><th scope="col">${u('prices.treatment')}</th><th scope="col">${u('prices.option')}</th><th scope="col" class="num">${u('prices.price')}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  };
  const html = layout({
    path: 'precios/', current: 'precios/', title: tx('prices.title'),
    description: tx('prices.description', { brand: brand.name, cats: cats.map((c) => c.name).join(', ') }),
    ld: [breadcrumbLd([{ label: tx('prices.title'), path: 'precios/' }])].filter(Boolean),
    body: (root) => `
${pageHero({ root, crumbs: [{ label: tx('prices.title') }], eyebrow: tx('prices.eyebrow'), title: rich('prices.heading'), lead: legal.priceDisclaimer })}
<section class="section" aria-label="${u('prices.tablesLabel')}">
  <div class="container">
    <div class="tabs" data-tabs>
      <div class="tabs__list" role="tablist" aria-label="${u('prices.tabsLabel')}" hidden>
        ${cats.map((c, i) => `<button class="tabs__tab" type="button" role="tab" id="tab-${esc(c.id)}" aria-controls="precios-${esc(c.id)}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${icon(ic(c.icon))}${esc(c.name)}</button>`).join('')}
      </div>
      ${cats.map((c) => `<div class="tabs__panel" id="precios-${esc(c.id)}" aria-labelledby="tab-${esc(c.id)}">
        <h2 data-tab-heading>${esc(c.name)}</h2>
        ${table(c)}
      </div>`).join('')}
    </div>
    <p class="disclaimer">${icon('info')}<span>${esc(legal.priceDisclaimer)}</span></p>
    <p><a class="link-arrow" href="${root}packs/">${u('prices.packsLink')} ${icon('arrow')}</a></p>
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
      ${img ? `<div class="media"><img src="${esc(imgSrc(img, '../'))}" alt="${esc(p.imageAlt || '')}" loading="lazy"></div>` : ''}
      <p class="club__subtitle">${esc(p.subtitle)}</p>
      <h2 class="club__name" id="${k}-t">${esc(p.name)}</h2>
      <p>${esc(p.description)}</p>
      ${arr(p.perks).length ? `<ul class="checklist">${arr(p.perks).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      ${p.conditions ? `<p class="club__conditions"><strong>${u('packs.conditions')}</strong> ${esc(p.conditions)}</p>` : ''}
      <p>${waBtn(waFor(tx('waPack', { name: p.name })), p.cta || tx('packs.want', { name: p.name }), 'btn btn--ink')}</p>
    </article>`;
  };
  const loyalty = mk.loyalty;
  const html = layout({
    path: 'packs/', current: 'packs/', title: tx('packs.title'),
    description: tx('packs.description', { brand: brand.name }),
    ld: [breadcrumbLd([{ label: tx('packs.crumb'), path: 'packs/' }]), ...list.filter((p) => isNum(p.price)).map((p) => ({ '@context': 'https://schema.org', '@type': 'Offer', name: p.name, description: p.description, price: p.price, priceCurrency: 'EUR', seller: { '@type': 'BeautySalon', name: brand.name } }))].filter(Boolean),
    body: (root) => `
${pageHero({ root, crumbs: [{ label: tx('packs.crumb') }], eyebrow: tx('packs.eyebrow'), title: rich('packs.heading'), lead: tx('packs.lead') })}
<section class="section" aria-label="${u('packs.clubsLabel')}"><div class="container"><div class="duo">${club('aloha')}${club('ohana')}</div></div></section>

${list.length ? `<section class="section section--white" aria-labelledby="packs-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('packs.packsEyebrow')}</p><h2 id="packs-title">${rich('packs.packsTitle')}</h2></div>
    <div class="grid grid--3">${list.map((p, i) => { const s = saving(p.price, p.oldPrice); return `<article class="card pack reveal${p.highlight ? ' pack--highlight' : ''}" id="${esc(p.id)}" style="--i:${i % 3}">
      ${p.badge ? `<span class="pack__badge">${esc(p.badge)}</span>` : ''}
      <h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>
      ${arr(p.items).length ? `<ul class="checklist">${arr(p.items).map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      <div class="pack__price">${isNum(p.oldPrice) && s ? `<del><span class="visually-hidden">${u('before')} </span>${money(p.oldPrice)}</del>` : ''}<span class="now">${money(p.price)}</span>${savingHtml(s)}</div>
      ${waBtn(waFor(p.name), p.cta || tx('packs.bookPack'), p.highlight ? 'btn btn--wa btn--block' : 'btn btn--ghost btn--block')}
    </article>`; }).join('')}</div>

    <div class="price-table reveal" style="margin-top:3rem"><div class="table-scroll"><table>
      <caption>${u('packs.compare')}</caption>
      <thead><tr><th scope="col">${u('packs.colPack')}</th><th scope="col">${u('packs.colIncludes')}</th><th scope="col" class="num">${u('packs.colNormal')}</th><th scope="col" class="num">${u('packs.colPackPrice')}</th><th scope="col" class="num">${u('packs.colSaving')}</th></tr></thead>
      <tbody>${list.map((p) => { const s = saving(p.price, p.oldPrice); return `<tr><th scope="row">${esc(p.name)}</th><td>${arr(p.items).map(esc).join(' + ')}</td><td class="num">${isNum(p.oldPrice) ? `<del>${money(p.oldPrice)}</del>` : '—'}</td><td class="num"><span class="price">${money(p.price)}</span></td><td class="num">${s ? savingHtml(s) : '—'}</td></tr>`; }).join('')}</tbody>
    </table></div></div>
  </div>
</section>` : ''}

${bonos.length ? `<section class="section" aria-labelledby="bonos-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('packs.bonosEyebrow')}</p><h2 id="bonos-title">${rich('packs.bonosTitle')}</h2><p>${u('packs.bonosText')}</p></div>
    <div class="price-table reveal"><div class="table-scroll"><table>
      <caption class="visually-hidden">${u('packs.bonosCaption')}</caption>
      <thead><tr><th scope="col">${u('packs.colBono')}</th><th scope="col" class="num">${u('packs.colSessions')}</th><th scope="col" class="num">${u('packs.colPrice')}</th><th scope="col" class="num">${u('packs.colPerSession')}</th><th scope="col" class="num">${u('packs.colSaving')}</th></tr></thead>
      <tbody>${bonos.map((b) => { const t = trById[b.treatmentId]; const s = saving(b.price, b.oldPrice); if (b.treatmentId && !t) warn(`Bono "${b.label}" apunta a tratamiento inexistente "${b.treatmentId}"`); return `<tr><th scope="row">${t ? `<a href="${root}tratamientos/${esc(t.id)}/">${esc(b.label || t.name)}</a>` : esc(b.label)}</th><td class="num">${esc(b.sessions)}</td><td class="num">${isNum(b.oldPrice) && s ? `<del><span class="visually-hidden">${u('before')} </span>${money(b.oldPrice)}</del>` : ''}<span class="price">${money(b.price)}</span></td><td class="num">${isNum(b.price) && b.sessions ? money(+(b.price / b.sessions).toFixed(2)) : '—'}</td><td class="num">${s ? savingHtml(s) : '—'}</td></tr>`; }).join('')}</tbody>
    </table></div></div>
    <p class="disclaimer">${icon('info')}<span>${esc(legal.priceDisclaimer)}</span></p>
  </div>
</section>` : ''}

${activePromos.length ? `<section class="section section--white" aria-labelledby="promos-title"><div class="container"><div class="section__head"><p class="eyebrow">${u('packs.promosEyebrow')}</p><h2 id="promos-title">${rich('packs.promosTitle')}</h2></div><div class="grid grid--3">${activePromos.map(promoCard).join('')}</div></div></section>` : ''}

${loyalty && loyalty.name ? `<section class="section section--ink" aria-labelledby="loyal-title">
  <div class="container">
    <div class="section__head"><p class="eyebrow">${u('packs.loyaltyEyebrow')}</p><h2 id="loyal-title">${esc(loyalty.name)}</h2><p>${esc(loyalty.description)}</p></div>
    ${arr(loyalty.steps).length ? `<ol class="loyalty-steps">${arr(loyalty.steps).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
  </div>
</section>` : ''}`,
  });
  writePage('packs/', html);
}

/* ---------- Contacto ---------- */
function pageContact() {
  const html = layout({
    path: 'contacto/', current: 'contacto/', title: tx('contactPage.title'),
    description: tx('contactPage.description', { brand: brand.name }),
    ld: [breadcrumbLd([{ label: tx('contactPage.crumb'), path: 'contacto/' }])].filter(Boolean),
    cta: false,
    body: (root) => `
${pageHero({ root, crumbs: [{ label: tx('contactPage.crumb') }], eyebrow: tx('contactPage.eyebrow'), title: rich('contactPage.heading'), lead: tx('contactPage.lead'), extra: `<div class="btn-row">${waBtn(contact.whatsappMessage, tx('whatsappLong'))}${bookingBtn()}${callBtn()}</div>` })}
<section class="section" id="reservar" aria-label="${u('contactPage.sectionLabel')}">
  <div class="container contact-grid">
    <div>${contactInfo(root)}${mapBlock(root)}</div>
    ${contactForm(root)}
  </div>
</section>`,
  });
  writePage('contacto/', html);
}

/* ---------- Legal (plantillas; textos en content/i18n/ui.json → legal) ---------- */
function pageLegal(path, title, sectionsHtml) {
  const html = layout({
    path, title, description: tx('legal.description', { title, brand: brand.name }), cta: false,
    body: (root) => `${pageHero({ root, crumbs: [{ label: title }], title: esc(title), lead: '' })}
<section class="section"><div class="container container--narrow legal">
  <div class="notice notice--warn" role="note">${icon('alert')}<p>${rich('legal.notice')}</p></div>
  ${sectionsHtml(root)}
  <p class="small">${u('legal.updated', { date: BUILD_DATE })}</p>
</div></section>`,
  });
  writePage(path, html);
}
const titular = () => `<ul>
  <li><strong>${u('legal.holder')}:</strong> ${fill(legal.companyName || '[POR DEFINIR]')}</li>
  <li><strong>${u('legal.nif')}:</strong> ${fill(legal.nif || '[POR DEFINIR]')}</li>
  <li><strong>${u('legal.domicile')}:</strong> ${fill(contact.address)}, ${fill(contact.postalCode)} ${fill(contact.city)}</li>
  <li><strong>${u('legal.email')}:</strong> ${fill(contact.email)}</li>
  <li><strong>${u('legal.phone')}:</strong> ${fill(contact.phoneDisplay || contact.phone)}</li>
</ul>`;
const h2 = (k) => `<h2>${u(k)}</h2>`;
const pp = (k, v) => `<p>${rich(k, v)}</p>`;

function pagesLegal() {
  const providers = [contact.formEndpoint ? u('legal.privacy.provForm') : u('legal.privacy.provWa'), contact.bookingUrl ? u('legal.privacy.provBooking') : ''].filter(Boolean).join(', ');
  pageLegal('privacidad/', tx('legal.privacy.title'), () => `
  ${h2('legal.privacy.s1')}${titular()}
  ${h2('legal.privacy.s2')}${pp('legal.privacy.p2')}
  ${h2('legal.privacy.s3')}${pp('legal.privacy.p3')}
  ${h2('legal.privacy.s4')}${pp('legal.privacy.p4')}
  ${h2('legal.privacy.s5')}${pp('legal.privacy.p5', { providers })}
  ${h2('legal.privacy.s6')}${pp('legal.privacy.p6', { email: fill(contact.email) })}`);

  pageLegal('aviso-legal/', tx('legal.terms.title'), () => `
  ${h2('legal.terms.s1')}${pp('legal.terms.p1')}${titular()}
  ${pp('legal.terms.registry')}
  ${h2('legal.terms.s2')}${pp('legal.terms.p2', { brand: esc(brand.name), disclaimer: esc(legal.priceDisclaimer) })}
  ${h2('legal.terms.s3')}${pp('legal.terms.p3')}
  ${h2('legal.terms.s4')}${pp('legal.terms.p4')}
  ${h2('legal.terms.s5')}${pp('legal.terms.p5')}
  ${h2('legal.terms.s6')}${pp('legal.terms.p6')}`);

  pageLegal('cookies/', tx('legal.cookies.title'), () => `
  ${h2('legal.cookies.s1')}${pp('legal.cookies.p1')}
  ${h2('legal.cookies.s2')}${pp('legal.cookies.p2')}${pp('legal.cookies.p2b')}
  ${h2('legal.cookies.s3')}${pp('legal.cookies.p3')}`);
}

/* ---------- 404 (solo en español, en la raíz; con enlaces a las portadas de ca y en) ---------- */
function page404() {
  const base = SITE_URL ? new URL(SITE_URL).pathname : '/'; // GitHub Pages sirve 404.html en cualquier ruta: rutas desde la base
  const others = LANGS.filter((x) => x.code !== L.code).map((x) => {
    const nf = UI_ALL[x.code]?.notFound ?? UI_ALL.es.notFound;
    return `<li lang="${x.code}">${esc(nf.title)} · <a href="${x.prefix}" hreflang="${x.code}">${esc(nf.back)} <span class="visually-hidden">(${esc(x.name)})</span></a></li>`;
  }).join('');
  const html = layout({
    path: '404.html', title: tx('notFound.title'), description: tx('notFound.description'), noindex: true, base, rootOverride: '', cta: false,
    body: (root) => `<section class="hero" aria-labelledby="nf-title">
  <div class="hero__layer" data-speed="0.2">${blob('deco-blob-a', 'pink', 'coral', 0)}</div>
  <div class="hero__layer" data-speed="0.4">${palm('deco-leaf-a', 'sage')}${sparkles('deco-sparkles', 8)}</div>
  <div class="container not-found"><div>
    <p class="big" aria-hidden="true">404</p>
    <h1 id="nf-title">${u('notFound.heading')}</h1>
    <p class="lead">${u('notFound.lead')}</p>
    <div class="btn-row" style="justify-content:center"><a class="btn" href="${root || './'}">${u('notFound.back')}</a><a class="btn btn--ghost" href="${root}tratamientos/">${u('seeAll')}</a></div>
    <ul class="not-found__langs">${others}</ul>
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
  const list = [...pages];
  if (SITE_URL) {
    // Una <url> por página e idioma, con sus alternativas hreflang (xhtml:link)
    const prio = (p) => (p === '' ? '1.0' : p.split('/').filter(Boolean).length > 1 ? '0.7' : '0.8');
    const alts = (p) => [...LANGS.map((x) => `<xhtml:link rel="alternate" hreflang="${x.code}" href="${esc(pageUrl(p, x))}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(pageUrl(p, LANGS[0]))}"/>`].join('');
    writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.flatMap((x) => list.map((p) => `  <url><loc>${esc(pageUrl(p, x))}</loc>${alts(p)}<lastmod>${BUILD_DATE}</lastmod><priority>${prio(p)}</priority></url>`)).join('\n')}
</urlset>
`);
  } else {
    // Sin URL absoluta un sitemap no es válido: se deja una plantilla que indica cómo generarlo.
    writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<!-- Define seo.siteUrl en content/site.json o la variable SITE_URL al construir para generar las URLs absolutas.
     Idiomas: ${LANGS.map((x) => `${x.code} (/${x.prefix})`).join(', ')}
     Páginas (en cada idioma): ${list.map((p) => p || '(inicio)').join(', ')} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>
`);
    warn('Sin seo.siteUrl ni SITE_URL: no hay canonical ni sitemap con URLs (el workflow de GitHub Pages lo define automáticamente).');
  }
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n${SITE_URL ? `\nSitemap: ${new URL('sitemap.xml', SITE_URL).href}\n` : ''}`);
}

/* ==========================================================================
   10. Ejecutar: el sitio completo una vez por idioma (es en dist/, ca en dist/ca/, en en dist/en/)
   ========================================================================== */
const t0 = Date.now();
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const lang of LANGS) {
  setLang(lang.code);
  if (lang.code === 'es') assets();
  pageHome();
  pageCatalog();
  treatments.forEach(pageTreatment);
  pagePrices();
  pagePacks();
  pageContact();
  pagesLegal();
  if (lang.code === 'es') page404();
}
seoFiles();

console.log(`✔ static/dist generado en ${Date.now() - t0} ms — ${pages.size} páginas × ${LANGS.length} idiomas (${LANGS.map((x) => `${x.code}: /${x.prefix}`).join(', ')}) + 404 · ${treatments.length} fichas`);
console.log(`  Datos: ${[siteSrc, trSrc, pkSrc, mkSrc].map((s) => s.source).join(' · ')}`);
if (SITE_URL) console.log(`  URL base: ${SITE_URL}`);
for (const w of warnings) console.warn(`  ⚠ ${w}`);
