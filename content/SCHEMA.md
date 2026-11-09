# Esquema de contenido — Imperium Beauty Studio (nombre provisional)

**Todo** el texto, precio, nombre, color y dato de contacto de la web vive en estos JSON.
La versión estática (`static/`) y el tema WordPress (`wordpress/`) se generan / importan desde aquí.
Para cambiar algo: edita el JSON y vuelve a generar (`node static/build.mjs`).

Valores con `"[POR DEFINIR]"` = dato real pendiente del negocio.

## `site.json` — marca, contacto, tema, portada
```jsonc
{
  "brand": { "name": "", "shortName": "", "tagline": "", "description": "", "logoText": "", "logoAccent": "" },
  "contact": {
    "phone": "", "phoneDisplay": "", "whatsapp": "34XXXXXXXXX", "whatsappMessage": "",
    "email": "", "address": "", "city": "", "postalCode": "", "mapsUrl": "", "mapsEmbed": "",
    "hours": [ { "days": "Lunes a viernes", "time": "10:00 – 20:00" } ],
    "bookingUrl": "", "bookingLabel": "", "formEndpoint": ""
  },
  "social": { "instagram": "", "tiktok": "", "facebook": "" },
  "theme": {
    "colors": { "cream": "", "nude": "", "pink": "", "coral": "", "sage": "", "green": "", "gold": "", "ink": "", "white": "" },
    "fonts": { "heading": "", "body": "", "googleFontsUrl": "" }
  },
  "nav": [ { "label": "", "href": "" } ],
  "hero": { "eyebrow": "", "title": "", "titleAccent": "", "subtitle": "", "ctaPrimary": { "label": "", "href": "" }, "ctaSecondary": { "label": "", "href": "" } },
  "stats": [ { "value": "", "label": "" } ],
  "whyUs": [ { "icon": "", "title": "", "text": "" } ],
  "testimonials": { "isPlaceholder": true, "items": [ { "name": "", "text": "", "treatment": "" } ] },
  "seo": { "titleSuffix": "", "defaultDescription": "", "ogImage": "", "locale": "es_ES", "siteUrl": "" },
  "legal": { "companyName": "", "nif": "", "privacyText": "", "priceDisclaimer": "" }
}
```

## `treatments.json` — categorías y tratamientos (también alimenta la página de precios)
```jsonc
{
  "categories": [
    { "id": "manos-pies", "name": "Manos y pies", "icon": "nail", "intro": "", "order": 1 }
  ],
  "treatments": [
    {
      "id": "slug-unico",              // se usa en la URL: /tratamientos/slug-unico/
      "category": "manos-pies",        // id de categoría
      "name": "",
      "short": "",                     // 1 frase para tarjetas (≤ 120 caracteres)
      "hook": "",                      // titular con gancho para la ficha
      "icon": "",                      // nombre de icono (ver lista abajo)
      "featured": false,               // aparece en la portada
      "whatIs": "",                    // ¿Qué es? 2-4 frases claras
      "mechanism": "",                 // (opcional) «Cómo actúa»: 3-5 frases sobre qué estimula en piel/tejido
      "benefits": [ { "title": "", "text": "" } ],   // pros y ventajas (4-6)
      "idealFor": [ "" ],              // ¿Para quién es?
      "howItWorks": [ { "title": "", "text": "" } ], // pasos de la sesión (3-5)
      "duration": "45 min",
      "sessions": "",                  // nº recomendado / frecuencia
      "results": "",                   // cuándo y qué se nota (sin prometer)
      "painLevel": 1,                  // 0-5 sensación / molestia
      "aftercare": [ "" ],             // cuidados posteriores
      "contraindications": [ "" ],
      "faq": [ { "q": "", "a": "" } ],
      "priceFrom": 0,                  // número en € (para "desde X €")
      "prices": [ { "label": "", "price": 0, "priceHim": 0, "oldPrice": null, "note": "", "noDiscount": false } ],
      "priceNote": "Precio orientativo",
      "tags": [ "" ],
      "combinesWith": [ "id-de-otro-tratamiento" ]   // (opcional) 2-4 ids con los que combina bien
    }
  ]
}
```
Iconos disponibles: `nail`, `foot`, `polish`, `laser`, `wax`, `lash`, `brow`, `tint`, `massage`, `drain`, `wood`, `pressure`, `device`, `face`, `body`, `needle`, `hair`, `glow`, `lips`, `sparkle`, `leaf`, `heart`, `gift`, `star`, `clock`, `shield`.

## `packs.json` — Aloha, Ohana, packs y bonos
```jsonc
{
  "aloha": { "name": "Aloha", "subtitle": "", "discount": 15, "description": "", "perks": [ "" ], "conditions": "", "cta": "" },
  "ohana": { "name": "Ohana", "subtitle": "", "description": "", "perks": [ "" ], "conditions": "", "cta": "" },
  "packs": [
    { "id": "", "name": "", "badge": "", "description": "", "items": [ "" ], "price": 0, "oldPrice": 0, "highlight": false, "cta": "" }
  ],
  "bonos": [
    { "treatmentId": "", "label": "", "sessions": 6, "price": 0, "oldPrice": 0 }
  ]
}
```

## `marketing.json` — ganchos y promociones
```jsonc
{
  "announcement": { "active": true, "text": "", "href": "" },
  "promos": [ { "id": "", "title": "", "text": "", "badge": "", "validity": "", "active": true } ],
  "loyalty": { "name": "", "subtitle": "", "description": "", "steps": [ "" ], "conditions": "", "cta": "" },
  "leadMagnet": { "title": "", "text": "", "cta": "" },
  "faqGeneral": [ { "q": "", "a": "" } ]
}
```

## Campos opcionales añadidos por la versión estática
Todos son **opcionales**: si faltan, la web funciona igual.

| Dónde | Campo | Uso |
|---|---|---|
| `site.json → contact` | `whatsappTreatmentMessage` | Mensaje prefijado de WhatsApp en fichas y packs. `{treatment}` se sustituye por el nombre. Por defecto: `¡Hola! Me gustaría información y cita para: {treatment}` |
| `site.json → contact` | `image`, `imageAlt` | Foto del local (se muestra en contacto si no hay `mapsEmbed`). |
| `site.json → theme.colors` | `whatsapp` | Color de los botones de WhatsApp (por defecto `#25D366`). |
| `site.json → hero` | `image`, `imageAlt` | Foto principal de la portada (arco del hero). |
| `treatments.json → treatments[]` | `image`, `imageAlt` | Foto de la ficha y de la tarjeta. |
| `treatments.json → treatments[]` | `mechanism` | Texto «Cómo actúa» (3-5 frases, tono profesional y sin promesas médicas: colágeno, elastina, renovación celular, microcirculación, drenaje, adipocitos, folículo…). Se muestra en la ficha justo después de «¿Qué es?», en un bloque destacado, y aparece en el subíndice de la ficha. Si falta, no se muestra. |
| `treatments.json → treatments[]` | `combinesWith` | Lista de 2-4 `id` de otros tratamientos que combinan bien. Se muestran como tarjetas enlazadas en el bloque «Combina con» (tras «Resultados»). Los ids inexistentes se ignoran con aviso en el build. Los tratamientos listados aquí no se repiten en «Tratamientos relacionados» al final de la ficha. Son ids: no se traducen (en `content/i18n/<ca\|en>/treatments.json` no hace falta incluir este campo). |

Títulos de esos bloques (en `content/i18n/ui.json → treatment`): `mechanism`, `mechanismEyebrow`, `combines`, `combinesIntro`.
| `packs.json → aloha / ohana` | `image`, `imageAlt` | Foto de cada club. |

### Imágenes (huecos para fotos)
- Las fotos van en `static/src/assets/img/`. El campo `image` es una ruta **relativa a `static/src/assets/`** (p. ej. `"img/tratamientos/bb-glow.webp"`) o una URL `https://…`.
- **Sin tocar el JSON**: basta con dejar el archivo con el nombre esperado y se detecta solo (extensiones `webp`, `avif`, `jpg`, `jpeg`, `png`):
  - Portada: `img/hero.jpg`
  - Fichas: `img/tratamientos/<id>.jpg`
  - Clubs: `img/aloha.jpg`, `img/ohana.jpg`
  - Local: `img/local.jpg`
- Mientras no hay foto se muestra un hueco decorativo con la etiqueta «Foto pendiente · ruta». Si la ruta de `image` no existe, el build avisa.
- Recomendado: WebP, 1200 px de ancho (fichas 1:1 o 4:3, hero 4:5), < 200 KB. `imageAlt` describe la foto; si es decorativa, déjalo vacío.
- Imagen para redes (`seo.ogImage`): si `static/src/assets/og-image.png` no existe, el build genera una provisional de 1200×630 con la paleta.

### Construir
```bash
npm run build      # = node static/build.mjs → static/dist/
npm run serve      # http://localhost:4321
npm run check      # enlaces internos, anclas, un <h1> por página, alt en <img>
```
`seo.siteUrl` (o la variable `SITE_URL`) activa canonical, `og:url`, sitemap con URLs absolutas y JSON-LD con URL. En GitHub Pages el workflow la rellena sola si `seo.siteUrl` está vacío.
Si `content/treatments.json`, `packs.json` o `marketing.json` no existen o no son JSON válido, se usan los datos de prueba de `static/fixtures/`.

## Hero inmersivo de la portada (`site.json → hero`)
Campos **opcionales** añadidos para el inicio inmersivo. Si faltan, se usan los valores por defecto.

| Campo | Por defecto | Uso |
|---|---|---|
| `immersive` | `true` | `true`: inicio inmersivo (escena fijada de ~2,5–3 pantallas de scroll, titular gigante que se divide, capas en profundidad, partículas doradas que reaccionan al cursor/toque). `false`: vuelve al hero clásico de dos columnas con parallax suave. |
| `bigWords` | 1.ª palabra de `title` y última de `titleAccent` (p. ej. `["Brilla", "imperio"]`) | Hasta 2 palabras decorativas gigantes que se abren en horizontal al hacer scroll. Son decorativas (ocultas a lectores de pantalla): el texto real es `title` + `titleAccent`. Mejor palabras cortas (≤ 8 letras). |
| `scrollHint` | `"Desliza para descubrir"` | Texto pequeño que invita a hacer scroll al inicio de la escena (decorativo). |

Notas:
- El `h1` sigue siendo `title` + `titleAccent` (texto accesible intacto; las letras animadas están ocultas a lectores de pantalla).
- `subtitle`, `ctaPrimary`, `ctaSecondary` y `stats` aparecen al final del recorrido con entrada escalonada. Con el teclado, al llegar a los botones la escena salta directamente al final.
- Con `prefers-reduced-motion` o sin JavaScript se muestra un hero estático (sin escena fijada ni partículas) con todo el contenido visible.
- La foto del arco sigue siendo `image` / `imageAlt` (o `static/src/assets/img/hero.jpg`).

### Líneas de precio "desde"
En `treatments[].prices[]` se puede añadir `"from": true` para mostrar "desde X €" (p. ej. decoraciones con precio según diseño).

**Precios ella / él.** Si una línea de `prices` lleva `"priceHim"`, la tabla de ese tratamiento (y la de su categoría en /precios/) muestra dos columnas: **Ella** (`price`) y **Él** (`priceHim`). Las líneas sin `priceHim` ocupan las dos columnas (mismo precio para todos). `"priceHim": null` muestra «Consultar».

**Columnas Aloha / Ohana.** Las tablas de precios calculan solas el precio con `aloha.discount` y `ohana.discount` (porcentaje, en `packs.json`). No se aplica a líneas ya rebajadas (con `oldPrice`) ni a las que lleven `"noDiscount": true` (bonos, combos…). Si se borra `discount`, desaparece esa columna.

**Ocultar sin borrar.** Packs y bonos con `"active": false` no se muestran.

**Tarjeta de fidelidad** (`marketing.json → loyalty`): sale como tercera tarjeta junto a Aloha y Ohana (portada y /packs/#fidelidad) y como banner bajo las tablas de /precios/. `steps` son los pasos; `[POR DEFINIR]` se resalta.

## «Quiénes somos» (`site.json → about`, opcional)
Sección de la portada con id `quienes-somos`, situada antes de «Por qué nosotras» (`whyUs`). Si `about` no existe, no se muestra la sección ni el enlace del menú.
```jsonc
"about": {
  "eyebrow": "Quiénes somos",
  "title": "Más de 10 años cuidándote,", "titleAccent": "y aprendiendo cada día",   // titleAccent sale en color de acento
  "paragraphs": [ "", "", "" ],                                                     // párrafos del texto
  "highlights": [ { "icon": "star", "title": "", "text": "" } ]                     // tarjetas destacadas (icono del sprite)
}
```
El menú (cabecera, menú móvil y pie) añade automáticamente «Quiénes somos» como primer elemento, enlazando a `#quienes-somos` de la portada del idioma en curso (funciona desde cualquier página). Su texto está en `content/i18n/ui.json → navAbout`; no hace falta tocar `nav`.

## Idiomas (es · ca · en)
- El español es la base y se publica en la raíz (`/`); el catalán en `/ca/` y el inglés en `/en/`, **con los mismos slugs** (p. ej. `/ca/tratamientos/bb-glow/`). Los `id` nunca se traducen.
- Traducciones de contenido: `content/i18n/<ca|en>/{site,treatments,packs,marketing}.json`, fusionadas sobre el español con las reglas de `content/i18n/LEEME.md`. Si falta un archivo o un texto, se usa el español y el build lo resume en consola (`⚠ i18n …`).
- Textos fijos de la interfaz (botones, títulos de sección, etiquetas de la ficha, formularios y validación, aria-labels, páginas legales, 404…): `content/i18n/ui.json` → `{ "es": {…}, "ca": {…}, "en": {…} }`. Ver formato en `content/i18n/LEEME.md`.
- Cada página lleva `<html lang>`, `<link rel="alternate" hreflang="es|ca|en|x-default">`, canonical de su idioma (con `seo.siteUrl`/`SITE_URL`), `og:locale` (`es_ES`, `ca_ES`, `en_GB`) y JSON-LD `WebPage` con `inLanguage`. El `sitemap.xml` lista las URLs de los tres idiomas con sus alternativas.
- Selector de idioma ES · CA · EN en la cabecera (escritorio), el menú móvil y el pie: enlaza a la misma página en el otro idioma. No hay redirección automática por idioma del navegador.
- `404.html` (GitHub Pages) está en español y enlaza a las portadas de `ca` y `en`.
- `seo.locale` de `site.json` ya no se usa: el `og:locale` sale del idioma de cada página.
- Precios: mismo número en los tres idiomas; solo cambia el formato (`25 €` en es/ca, `€25` en en).

## `bodymap.json` — mapa corporal de la portada (opcional)
Sección «Recorrido por zonas» (`#zonas`) de la portada, entre las categorías y los tratamientos destacados. Si el archivo no existe o no tiene `zones`, la sección no aparece.
```jsonc
{
  "eyebrow": "Recorrido por zonas", "title": "Tu cuerpo, zona a zona,", "titleAccent": "con el tratamiento justo",
  "intro": "",
  "model": "assets/models/figure.glb",      // opcional: modelo 3D (.glb, ruta relativa a static/src/). Sin él o si no existe: el de por defecto
  "zones": [
    {
      "id": "rostro",                       // slug único (no se traduce)
      "label": "Rostro",                    // nombre de la zona
      "text": "",                           // 2-3 frases
      "treatments": ["higiene-facial"],     // ids de treatments.json (orden = orden de la lista). Los inexistentes se ignoran con aviso en el build
      "view": { "azimuth": 15, "elevation": 4, "zoom": 4.2 },  // cámara 3D al llegar a la zona
      "anchor": [0, 1.6, 0.1]               // punto de la zona en la figura (x, y, z en metros)
    }
  ]
}
```
- **Orden**: el de `zones` es el del recorrido (scroll) y el de la lista numerada.
- **`view`**: `azimuth` en grados alrededor de la figura (0 = de frente, 90 = lado izquierdo de la figura / derecha de pantalla, 180 = espalda). Se interpola **sin dar la vuelta corta**: para seguir girando en el mismo sentido usa valores continuos (p. ej. 210 → 320 → 345 → 380). `elevation` en grados (positivo = desde arriba). `zoom` 1 = cuerpo entero; 4-6 = primer plano de la cara.
- **`anchor`**: punto en la superficie de la figura normalizada: 1,74 de alto, pies en y = 0, centro de la caja envolvente en x = z = 0 (ojos ~1,63, hombros ~1,38, manos ~1,03 en postura en A); x positivo = lado izquierdo de la figura; z positivo = delante (cara ≈ 0,05), negativo = espalda (≈ −0,17). Ahí va el punto dorado pulsante (y el número en la silueta estática).
- **`model`**: figura 3D de cuerpo completo. Por defecto `assets/models/figure.glb` (maniquí de la malla base CC0 de MakeHuman, comprimido con meshopt; créditos y licencia en `static/src/assets/models/CREDITS.md`). Se puede cambiar por otro .glb de una figura humana **de pie, Y arriba, mirando a +Z** (convención glTF): `js/bodymap.js` lo normaliza por su caja envolvente (1,74 de alto, pies en y = 0, centrado en x/z) y le aplica su propio material, así que `anchor` y `view` siguen valiendo si las proporciones y la postura son parecidas (si no, revisa las anclas). Admite meshopt (EXT_meshopt_compression); Draco no. No se traduce.
- Si el modelo no carga (sin red, navegador sin import maps, archivo roto), se usa la figura procedural (`static/src/js/bodymap-figure.js`, maniquí neutro en la misma postura en A) como nube de puntos dorada. Esa misma geometría dibuja la silueta SVG de la versión estática.
- Funcionamiento: sin JS, sin WebGL o con `prefers-reduced-motion` se ve la versión estática (silueta + acordeón con los textos y enlaces). Si no, `js/bodymap.js` carga Three.js y GLTFLoader (versión fijada desde jsDelivr, solo al acercarse a la sección; el HTML trae un import map para `three`) y monta la escena fijada: ~0,4 pantallas de scroll por zona, panel con la zona activa (aria-live), puntos de progreso y puntos de la figura clicables.
- Traducción: `content/i18n/<ca|en>/bodymap.json` con `eyebrow`, `title`, `titleAccent`, `intro` y `zones` (`id`, `label`, `text`; se emparejan por `id`). `treatments`, `view` y `anchor` salen siempre del español. Textos fijos (botones, aria-labels, «Zona {n} de {total}»…): `content/i18n/ui.json → bodymap`.
