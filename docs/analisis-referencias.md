# Análisis de webs de referencia

Proyecto: Imperium Beauty Studio (nombre provisional)
Fecha del análisis: 8 de noviembre de 2026
Webs analizadas: centrospantera.com, coccoalaser.es, lorenabeautywellness.com

> Método: lectura del contenido con WebFetch y revisión del HTML de la home de Pantera para identificar efectos. Los patrones se describen con palabras propias y no se copian textos. Si un dato no se pudo ver, se indica. La tabla de bienvenida de Coccoa es una imagen; sus cifras se han leído de esa imagen.

---

## 0. Lo que no se pudo ver o no existe

- **Pantera no tiene fichas individuales por tratamiento.** No hay URL propia para maderoterapia, presoterapia ni micropuntura/dermapen. Todo está agrupado en páginas de categoría (`/servicios/tratamientos-estetica/`, `/servicios/depilacion-laser/`, `/servicios/pestanas/`…). En su lugar se analizaron tres páginas de categoría: estética, depilación láser y pestañas. La maderoterapia solo aparece como tarjeta de promoción y como bloque dentro de "Estética".
- **Coccoa no tiene una página de "precios", "bonos" ni "packs" como tal.** Su modelo es justo el contrario: sesiones sueltas, sin bonos. Los precios están repartidos en `/copia-de-zonas-sueltas` (zonas sueltas), `/copia-de-oferta-bienvenida-ellas` (bienvenida, publicada como **imagen**), `/pruebas` (servicios "Beauty") y `/sobre-mi` (Plan Amigo). La pestaña "Packs ellos" no mostró contenido legible. `/services-1` duplica la home y `/general-7` es la política de privacidad.
- **Lorena:** no hay páginas por tratamiento ni página de tarifas. Los precios están dentro de cada categoría (se revisó `/cuerpo/`). No se ven testimonios.
- No se ha podido medir rendimiento real (Lighthouse) ni ver la web renderizada. Los efectos visuales de Pantera se deducen de la configuración de Elementor en el HTML, no de verlos en pantalla.

---

## 1. Arquitectura de cada web

### 1.1 Centros Pantera (referencia principal de diseño)

Plataforma: WordPress + Elementor Pro. Tipografía propia de marca (sans display). Marca con personalidad fuerte (concepto "salvaje", lenguaje inclusivo, "templos" en vez de centros).

**Cabecera (dos niveles):**
- Banner superior para descargar la app.
- Barra de utilidades: dónde estamos, programa de fidelidad, franquicia y botón **Reserva** destacado.
- Logo centrado y menú de categorías: Depilación láser, Estética, Manicura, Pedicura, Cejas, Pestañas, Promociones.
- Enlace "Ir al contenido" (accesibilidad) y barra inferior fija en móvil con reserva.

**Home, en orden:**
1. Hero con titular partido en dos líneas, subtítulo de concepto, párrafo corto y CTA de reserva.
2. Banda tipo *marquee* con valores de marca separados por un símbolo decorativo.
3. "Experiencias": 6 tarjetas de categoría con "Más info".
4. Bloque de centros con CTA "encuentra el tuyo".
5. Contadores animados (reseñas, nota, clientes, recurrencia).
6. Galería de fotos con banda de lema.
7. Testimonios de Google por ciudad (carrusel).
8. Club de fidelidad (tarjeta digital).
9. Compromiso: 4 valores con icono.
10. "Sesiones sueltas": 3 tarjetas de precio gancho ("desde X €").
11. Formulario de reserva (nombre, email, teléfono, oferta, región, centro, privacidad).
12. Franquicia, app, footer completo y panel de cookies.

**Páginas de categoría:** hero + precios + explicación + garantía + centros + formulario + texto SEO. Detalle en el apartado 2.

**Promociones (`/promociones/`):** bloques temáticos (bienvenida, packs láser, estética, novedades) con tarjetas de categoría, nombre, precio y botón "Solicitar" que abre un formulario emergente. Condiciones con asterisco y fecha de caducidad al pie de cada bloque.

### 1.2 Coccoa Láser (referencia de precios y packs)

Plataforma: Wix. Estética sencilla con rosa pastel. Tres centros (Inca, Palma, Yecla).

- **Barra superior fija:** WhatsApp, banner del Plan Amigo (20 %) y teléfonos por centro.
- **Menú:** Inicio, Beauty, Dudas (Plan amigo, Preguntas frecuentes), Depilación láser (Hombre, Mujer), Contacto.
- **Home:** hero que es directamente un **formulario de captación** con la promesa de oferta de bienvenida → bloque de bienvenida con lema "sesiones sueltas sin bonos" y CTA de llamada → texto del modelo → centros → 3 diferenciales con icono (garantía, tecnología, ahorro) → contacto por centro → footer.
- **Depilación mujer/hombre:** página puente con dos accesos (Zonas sueltas y Ofertas) + bloque Bienvenida + contacto.
- **Zonas sueltas:** 5 tallas de zona (XS, S, M, L, XL) con la lista de partes del cuerpo y un precio por talla (de 5 € a 38 €).
- **Oferta de bienvenida:** tabla de combos con dos columnas de precio (ver apartado 3).
- **Beauty (`/pruebas`):** tarjetas de servicio (presoterapia, radiofrecuencia, facial, cejas y pestañas) + tabla de precios por sesión.
- **Plan Amigo (`/sobre-mi`):** página propia con imagen, mecánica en dos líneas y dos condiciones.
- **FAQ:** 6 preguntas en texto plano (sesiones, preparación, menstruación, sol, medicación, frecuencia).

### 1.3 Lorena Beauty & Wellness (referencia de catálogo)

Plataforma: WordPress + Elementor. Bilingüe ES/EN. Tono premium y tranquilo. Reserva externa en Booksy.

- **Menú corto:** Tratamientos (ancla), Aparatología, Nosotros, Contacto + botón Reserva.
- **Home:** hero con H1 local ("centro de belleza en Palma") y lema → intro → **5 tarjetas de categoría** (Cara, Cuerpo, Manos y pies, Ojos, Depilación) → tarjeta regalo → servicio a domicilio/villas/barcos → el espacio → repetición de las categorías → footer.
- **Página de categoría (`/cuerpo/`):** hero con migas → línea de beneficios con puntos medios → párrafo → lista de tratamientos con **nombre, beneficios en una línea, descripción corta, duración y precio** → tarjetas de otras categorías → footer.
- Página propia de **Aparatología** (explica la tecnología aparte de los tratamientos).

---

## 2. Patrón de ficha de tratamiento de Pantera

Pantera no tiene fichas individuales: su "ficha" es un **bloque dentro de una página de categoría**. Hay dos variantes.

### 2.1 Variante A: categoría con varios tratamientos (Estética)

Orden exacto de la página:
1. **Hero:** etiqueta pequeña de sección, H1, subtítulo, **3 atributos cortos** (tipo "tecnología / resultados / sin cirugía") y CTA "Solicita información". Migas de pan.
2. **Intro del grupo corporal:** H2 + párrafo de unas 60 palabras + lista de 5 beneficios.
3. **Bloques de tratamiento corporal** (2).
4. **Intro del grupo facial:** misma estructura.
5. **Bloques de tratamiento facial** (4).
6. Banda de lemas.
7. Formulario (ancla `#solicita`).

Cada bloque de tratamiento (70-90 palabras):
- Imagen (sin texto alternativo).
- Nombre (H3).
- **Qué es:** 40-50 palabras, segunda persona, técnico ligero (colágeno, microcirculación).
- **Beneficios:** 3-4 viñetas.
- CTA "Solicita información" al formulario de la misma página.

**Faltan:** para quién, contraindicaciones, duración, nº de sesiones, resultados esperados, precio y FAQ.

### 2.2 Variante B: servicio estrella (Depilación láser), la más completa

1. **Hero:** titular con juego de marca + promesa con plazo ("en un año") + CTA de reserva.
2. **Precios de sesión suelta:** 3 tarjetas por tamaño de zona, con las zonas incluidas.
3. **Packs personalizados:** 6 tarjetas de combinaciones por precio (mujer y hombre).
4. **Qué es y cómo funciona** (unas 250 palabras, el bloque más largo): tecnología, tipos de piel, dolor, edad mínima. Aquí va implícito el "para quién".
5. **Antes de tu sesión:** 4 recomendaciones con subtítulo (afeitado, sol, medicación, consentimiento).
6. **Garantía de marca:** imagen + explicación (repasos gratuitos durante 12 meses) + botón.
7. **Centros:** puente visual hacia el formulario.
8. **Formulario** con selector de oferta de bienvenida (solo clientes nuevos).
9. **Texto SEO** (unas 300 palabras): tratamiento, historia, beneficios, resultados + botón de reserva.

Sin FAQ ni testimonios en la página. Sin acordeones ni pestañas.

### 2.3 Variante C: tarifa (Pestañas)

Hero → titular gráfico sobre precios → lista de 6 servicios con nombre, precio ("desde") y a veces una línea → centros → formulario → contenido educativo por técnica → CTA.

### 2.4 Tono y longitud

- Tuteo, enérgico, juegos de palabras con la marca, negritas en las ventajas.
- Frases cortas en la parte comercial; párrafos más largos solo en el bloque explicativo y en el SEO del final.
- Precio arriba (primera pantalla tras el hero) en los servicios de precio bajo; explicación después.

### 2.5 Ficha recomendada para Imperium (Pantera mejorado)

Una **URL propia por tratamiento** (SEO local + enlace directo desde redes/WhatsApp), con este orden:

1. Hero: nombre, promesa en una línea, 3 atributos (duración · sesiones recomendadas · desde X €), CTA reservar + CTA WhatsApp.
2. Qué es (50-80 palabras, lenguaje claro).
3. Beneficios (4-6 viñetas con icono).
4. Para quién es / para quién no (contraindicaciones básicas, remitir a valoración).
5. Cómo es la sesión (3-4 pasos numerados con duración).
6. Sesiones y resultados (cuántas, cada cuánto, cuándo se nota; sin promesas médicas).
7. Precio: sesión suelta + bono + entrada al pack Aloha si aplica, con ahorro visible.
8. Antes y después de la sesión (cuidados).
9. Combínalo con… (2-3 tratamientos relacionados).
10. FAQ en acordeón (5-6 preguntas, con datos estructurados FAQPage).
11. CTA final + garantía/compromiso.

Longitud objetivo: 500-800 palabras útiles, sin texto SEO de relleno al final.

---

## 3. Patrón de precios, packs y bonos de Coccoa

### 3.1 Modelo comercial

- Mensaje central: **sesiones sueltas, sin bonos ni packs obligatorios**. El ahorro se plantea como "pagas solo lo que usas", no como descuento por volumen.
- Diferenciales en tres iconos: garantía (repaso sin coste si no hay resultado), tecnología, ahorro.

### 3.2 Zonas sueltas

- Agrupación por **tallas de zona** (XS, S, M, L, XL) en lugar de "cara/cuerpo".
- Cada talla lista las zonas que incluye y lleva un precio único. Ancla de precio: "desde 5 € la zona".
- Ventaja: con 5 precios se cubre todo el cuerpo y el cliente se ubica rápido.
- Defecto: en el texto los precios no están asociados visualmente a su talla (bloques y cifras separados) y las tallas no salen en orden (XS, M, XL, S, L).

### 3.3 Pack bienvenida ("Aloha" en nuestro proyecto)

- Tabla de **combos de zonas** acumulativos (axilas + ingles + pubis, y se van añadiendo intergluteo, medias piernas, piernas completas, cuerpo sencillo y cuerpo completo).
- **Dos columnas:** "Oferta bienvenida" (cifra en una pastilla rosa con asterisco) frente a "PVP normal" (cifra negra, no tachada).
- El ahorro **no se calcula ni se escribe**: el cliente compara las dos columnas. Por la tabla, va de cerca del 50 % en el combo pequeño (10 € frente a 21 €) a cerca del 25 % en cuerpo completo (58 € frente a 79 €).
- Letra pequeña con asterisco: válido solo en la primera sesión en el centro.
- Se capta con formulario en el hero de la home ("rellena y te damos la oferta").
- Defectos: la tabla es una **imagen** (no se indexa, no la lee un lector de pantalla y no escala bien en móvil); cifras blancas sobre rosa claro con muy poco contraste; la sección se titula "mujer" pero el bloque dice "packs ellos".

### 3.4 Pack amigo ("Ohana" en nuestro proyecto)

- Presencia constante: **banner fijo en todas las páginas** con el porcentaje (20 %).
- Página propia con imagen de amigos, mecánica en una frase (20 % en tu próxima sesión por cada amigo nuevo que venga de tu parte) y dos condiciones: no acumulable en la misma sesión y no combinable con otras promociones.
- No indica caducidad, límite de amigos, si el amigo también recibe algo ni cómo se acredita.
- El enlace del menú apunta a una URL sin sentido (`/sobre-mi`).

### 3.5 Beauty (otros servicios)

- Tabla con columnas servicio / programa / precio por sesión. Un mismo servicio puede tener varios precios por objetivo (radiofrecuencia por zona) o un precio único con varios programas (presoterapia).
- Sin bonos ni ahorro visible.

### 3.6 Comparativa rápida con Pantera

Pantera sí trabaja con **packs de zonas** en tarjetas con precio grande y con promociones de bienvenida (una compra por cliente, con fecha de caducidad). Sin embargo, tampoco tacha precios ni muestra porcentajes, y tiene incoherencias: "desde 9 €" en un sitio y "desde 5 €" en otro, fechas de caducidad distintas entre bloques y dos nombres para el programa de referidos.

### 3.7 Patrón recomendado para Imperium

- Tarjetas de precio en **HTML** (nunca imagen), con: precio de pack grande, **PVP tachado**, chip de ahorro en euros **y** porcentaje ("Ahorras 15 € · 30 %"), y precio por sesión equivalente en los bonos.
- Tres niveles por tratamiento: sesión suelta / bono (p. ej. 5 o 10) / pack combinado, con el del medio destacado como "más elegido".
- **Aloha (bienvenida):** tabla de combos al estilo Coccoa (escalera de zonas o tratamientos), con columnas "Aloha" y "Precio habitual" + columna de ahorro calculado. Condición clara junto a la tabla, no en el pie.
- **Ohana (amigos):** banner fijo descartable + página propia con 3 pasos ilustrados (compartes → tu amigo reserva → los dos ganáis), condiciones completas en una lista corta (acumulable o no, caducidad, límite, cómo se aplica).
- Letra pequeña junto al precio, legible (mínimo 14 px y buen contraste), con fecha de validez si existe.

---

## 4. Efectos visuales del hero y parallax (Pantera)

Deducidos de la configuración de Elementor Pro (*Motion Effects*) en el HTML de la home:

- **Scroll effects (`motion_fx`), unos 40 elementos configurados.** No es un parallax de fondo clásico, sino capas que reaccionan al scroll:
  - Desplazamiento vertical lento (velocidad baja) de un elemento del hero + **desenfoque progresivo** (hasta unos 7 px) al salir de pantalla, solo en escritorio.
  - **Dos elementos que se mueven en horizontal en direcciones opuestas** con una ligera rotación, escala y desenfoque: efecto de "apertura" al hacer scroll (probablemente las imágenes laterales o el titular partido del hero).
  - Fundidos de opacidad *in-out* en tramos concretos del scroll.
  - En tablet y móvil hay una versión distinta: escala + desenfoque *out-in* según el viewport (adaptan el efecto en lugar de quitarlo).
- **Animaciones de entrada:** `fadeIn`, `fadeInUp`, `zoomIn` y `rotateIn` con retrasos escalonados (300, 600 y 900 ms) para las tarjetas.
- **Carruseles Swiper:** testimonios (4 por vista en escritorio, 2 en tablet, 1 en móvil, autoplay, bullets) y otro de 3 elementos con autoplay rápido.
- **Contadores animados** (se ven a 0 si no se ejecuta el JS: riesgo para SEO y sin JS).
- **Marquee** de valores de marca entre secciones.
- Hay una animación Lottie cargada y tipografía propia.

**Cómo imitarlo mejor:** hero con 2-3 capas (fondo, foto recortada, titular) movidas con `transform: translate3d` a distinta velocidad; titular partido que se separa al hacer scroll; desenfoque o fundido suave al salir; respetar siempre `prefers-reduced-motion` (desactivar todo) y no animar el texto del H1 por debajo de un contraste legible. Contadores con el valor final en el HTML, animados solo como mejora.

---

## 5. Ideas a imitar

1. **Pantera:** identidad de marca fuerte y coherente (vocabulario propio, lema repetido, juegos de palabras). Para Imperium, un vocabulario equivalente (estudio, ritual, Ohana, Aloha).
2. **Pantera:** precio gancho en la home ("sesiones sueltas desde…") en 3 tarjetas.
3. **Pantera:** garantía de resultado como bloque propio con imagen; genera confianza.
4. **Pantera:** bloque "Antes de tu sesión" con 4 consejos con subtítulo.
5. **Pantera:** barra de reserva fija en móvil y CTA repetido cada 2-3 secciones.
6. **Pantera:** testimonios reales de Google en carrusel y contadores de confianza.
7. **Coccoa:** tabla "oferta frente a precio normal" en dos columnas: se entiende al instante.
8. **Coccoa:** tallas de zona (XS-XL) para simplificar una tarifa larga.
9. **Coccoa:** banner fijo del programa de amigos y WhatsApp siempre visible.
10. **Coccoa:** FAQ centrada en dudas prácticas reales (menstruación, sol, medicación, frecuencia).
11. **Lorena:** cada tratamiento con **duración y precio** visibles y beneficios en una línea con puntos medios.
12. **Lorena:** catálogo por zona del cuerpo (Cara, Cuerpo, Manos y pies, Ojos, Depilación) con tarjetas de imagen; página aparte de aparatología; tarjeta regalo como sección de la home.

---

## 6. Puntos débiles a superar

**Arquitectura y SEO**
- Ninguna de las tres tiene páginas individuales por tratamiento: pierden búsquedas del tipo "maderoterapia en [ciudad]". **Nosotros: una URL por tratamiento.**
- Coccoa: URLs sin sentido (`/copia-de-dudas`, `/sobre-mi` para el Plan Amigo, `/pruebas` para Beauty).
- Pantera: varias URLs de promociones de campañas pasadas aún enlazadas (enero, Navidad).
- Lorena: catálogo repetido dos veces en la home.

**Claridad comercial**
- Ninguna muestra el ahorro calculado ni tacha precios.
- Pantera: precios contradictorios ("desde 9 €" y "desde 5 €"), fechas de caducidad distintas, dos nombres para el programa de referidos y un formulario de pestañas que ofrece promociones de otros servicios.
- Coccoa: precios de bienvenida en imagen; condiciones del Plan Amigo incompletas; títulos incoherentes ("mujer" frente a "ellos").
- Pantera y Lorena: en los tratamientos faciales y corporales faltan duración, sesiones, para quién, resultados y FAQ (Lorena sí da duración y precio).

**Accesibilidad**
- Pantera: unas 10 de 14 imágenes de la home sin texto alternativo; panel de cookies con variables sin rellenar (`{title}`, `{vendor_count}`).
- Coccoa: texto blanco sobre rosa pastel (contraste muy bajo); tabla como imagen.
- Efectos de scroll sin evidencia de respetar `prefers-reduced-motion`.

**Rendimiento**
- Pantera: HTML de la home de unos 250 KB solo de marcado, con Elementor Pro, Swiper, Lottie y unos 40 efectos de scroll; además, la cabecera aparece duplicada. Probable penalización en LCP y CLS en móvil.
- Coccoa (Wix): unos 650 KB de HTML con mucho JS en línea.

**Conversión**
- Pantera: los CTA de tratamiento llevan a "solicitar información", no a reservar una hora concreta.
- Coccoa: casi todo depende de llamar por teléfono; no hay reserva online.
- Lorena: no hay CTA por tratamiento (solo el botón global a Booksy) ni testimonios.

**Objetivo para Imperium:** fichas individuales completas, precios en HTML con ahorro explícito, Ohana/Aloha con condiciones claras, reserva directa por tratamiento, parallax ligero (CSS/JS propio) con modo de movimiento reducido, y contraste AA en toda la paleta.
