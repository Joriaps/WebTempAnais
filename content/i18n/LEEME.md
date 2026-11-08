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
