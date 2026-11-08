# Traducciones (catalán `ca` e inglés `en`)

El español (`content/*.json`) es el idioma base y la **única fuente de precios, ids, enlaces, iconos y colores**.
Cada idioma tiene una carpeta con archivos de **solo textos**, con la misma estructura que el español:

```
content/i18n/ca/site.json  treatments.json  packs.json  marketing.json
content/i18n/en/site.json  treatments.json  packs.json  marketing.json
content/i18n/ui.json       ← textos fijos de la interfaz (botones, títulos de sección, páginas legales…) en es/ca/en
```

## Reglas de fusión (las aplica `static/build.mjs`)
1. **Objetos**: se fusionan clave a clave (recursivo). Lo que falte en la traducción se toma del español.
2. **Listas de objetos con `id`** (`categories`, `treatments`, `packs`, `promos`): se emparejan por `id`. Cada elemento traducido lleva su `id`.
3. **Listas de objetos sin `id`** (`prices`, `faq`, `benefits`, `howItWorks`, `hours`, `nav`, `stats`, `whyUs`, `testimonials.items`, `bonos`, …): se emparejan **por posición**. La traducción debe tener los mismos elementos y en el mismo orden.
4. **Listas de textos** (`idealFor`, `aftercare`, `contraindications`, `items`, `perks`, `tags`…): se sustituyen enteras (mismo número de elementos).
5. **Nunca** se traducen ni se incluyen: números, precios (`price`, `oldPrice`, `priceFrom`, `sessions` numérico de bonos), `id`, `treatmentId`, `category`, `href`, URLs, `icon`, colores, fuentes, booleanos (`featured`, `highlight`, `active`, `from`, `immersive`, `isPlaceholder`). Siempre salen del español.
6. El nombre de la marca (`brand.name`, `logoText`, `logoAccent`) y los nombres propios de packs **Aloha** y **Ohana** no se traducen. `[POR DEFINIR]` se deja tal cual.

Si cambias un precio, solo lo cambias en `content/treatments.json` / `packs.json` y vale para los tres idiomas.
Si cambias un texto en español, recuerda cambiarlo también en `ca` y `en` (si no, se verá la versión antigua traducida).

## Cómo lo aplica el build
- `node static/build.mjs` genera el sitio completo tres veces: `static/dist/` (es), `static/dist/ca/` y `static/dist/en/`, con los mismos slugs. CSS, JS e imágenes se comparten desde la raíz de `dist/`.
- Si falta un archivo de traducción, o no es JSON válido, se usa el español entero para ese archivo. Si falta un texto, se usa el texto español.
- Al final del build se muestra un **resumen por archivo** (no una línea por texto): `⚠ i18n en/treatments.json: 7 texto(s) sin traducir … p. ej.: treatments[manicura].whatIs, …`. También avisa de listas con distinto número de elementos, de `id` que no existen en el español y de tipos distintos (p. ej. un texto donde el español tiene una lista).
- Además de lo indicado en la regla 6, se toman siempre del español `brand.shortName` y `seo.titleSuffix` (son la marca), y los datos de contacto no textuales (`phone`, `whatsapp`, `email`, `postalCode`, `mapsUrl`, `mapsEmbed`, `bookingUrl`, `formEndpoint`), `social`, `image`, `ogImage`, `siteUrl` y `locale`. Sí se traducen `whatsappMessage`, `whatsappTreatmentMessage` (conserva `{treatment}`), `phoneDisplay`, `address`, `hours[].days/time`, `bookingLabel`, `hero.scrollHint`, `hero.bigWords`, `about`…

## `ui.json` — textos fijos de la interfaz
```jsonc
{
  "es": { "skip": "Saltar al contenido", "footer": { "explore": "Explora" }, "treatment": { "duration": "Duración" }, … },
  "ca": { … mismas claves … },
  "en": { … mismas claves … }
}
```
- Mismas claves en los tres idiomas; si falta una en `ca`/`en`, se usa la española (y el build lo avisa).
- `{variable}` se sustituye al construir (`{brand}`, `{name}`, `{n}`, `{amount}`, `{pct}`, `{date}`, `{email}`, `{providers}`, `{disclaimer}`, `{treatment}`…): **no se traduce** lo que va entre llaves.
- `*texto*` = palabra destacada en color de acento (títulos de sección). `**texto**` = negrita. `[POR DEFINIR]` se deja tal cual (se resalta como pendiente).
- `painLabels` es una lista de 6 textos (molestia 0 a 5).
- Grupos: raíz (botones y textos comunes, aria-labels, mensajes de WhatsApp), `footer`, `cta`, `contactInfo`, `form` (formularios, validación y estados), `homePage`, `catalog`, `treatment`, `prices`, `packs`, `contactPage`, `legal` (`privacy`, `terms`, `cookies`) y `notFound`.
- Los nombres de los idiomas del selector (Español, Català, English) son fijos en `static/build.mjs`.
