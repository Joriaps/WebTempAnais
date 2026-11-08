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
      "prices": [ { "label": "", "price": 0, "oldPrice": null, "note": "" } ],
      "priceNote": "Precio orientativo",
      "tags": [ "" ]
    }
  ]
}
```
Iconos disponibles: `nail`, `foot`, `polish`, `laser`, `wax`, `lash`, `brow`, `tint`, `massage`, `drain`, `wood`, `pressure`, `device`, `face`, `body`, `needle`, `hair`, `glow`, `lips`, `sparkle`, `leaf`, `heart`, `gift`, `star`, `clock`, `shield`.

## `packs.json` — Aloha, Ohana, packs y bonos
```jsonc
{
  "aloha": { "name": "Aloha", "subtitle": "", "description": "", "perks": [ "" ], "conditions": "", "cta": "" },
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
  "loyalty": { "name": "", "description": "", "steps": [ "" ] },
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
