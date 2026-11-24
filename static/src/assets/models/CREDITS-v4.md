# figure-v4.glb — créditos y licencia

- **Qué es**: evolución de `figure-v3.glb` (ver `CREDITS-v2.md` y `CREDITS-v3.md`, mismas fuentes y autores) con pelo esculpido (raya lateral, nacimiento afinado hasta la piel, sin hebras sueltas) y seis clips de pose (`pose_reposo`, `pose_brazos`, `pose_manos`, `pose_rostro`, `pose_espalda`, `pose_piernas`). Nodos: `body`, `hair`, `brows`, `lashes`. La pose de enlace (bind pose) es la de `figure.glb`.
- **Esqueleto y pesos**: derivados de `default.mhskel` y `default_weights.mhw` de MakeHuman (campo `"license": "CC0"` en ambos archivos; © 2020/2021 Data Collection AB, Joel Palmius, Jonas Hauquier). Se fusionan huesos (parte del tronco, hombro, cara, metacarpos, dedos del pie) y se suavizan los pesos del hombro.
  - https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/rigs/default.mhskel
  - https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/rigs/default_weights.mhw
- **Malla, targets y línea de pestañas**: MakeHuman, CC0 (URL en `CREDITS-v2.md`). **Pelo, cejas, hebras de pestañas y poses**: trabajo propio.
- **Licencia**: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/ — https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md (sección C).
- **Procesado (2026-11)**: Blender 5.2 con `tools/figure/build_figure_v4.py`; compresión
  `gltf-transform meshopt entrada.glb figure-v4.glb --level medium --quantize-position 16 --quantize-normal 10 --quantize-color 8` (@gltf-transform/cli 4.1.1).
