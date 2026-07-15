---
name: actualizar-datos
description: Actualización mensual del cuadro de mando de Peñíscola. Invócalo cuando el usuario diga "actualicemos esto", "actualizar datos", "toca actualizar el dashboard", "actualización mensual" o similar. Descarga/reprocesa todas las fuentes automáticas, verifica y sube a producción lo ligero.
---

# Actualización mensual del cuadro de mando (Peñíscola)

Objetivo: dejar el dashboard al día con el mínimo esfuerzo del usuario. Sigue estos pasos en orden.

## 1. Pregunta por los ficheros manuales (una vez)
Antes de ejecutar, recuerda al usuario que, si los tiene, deje en su carpeta:
- **Pesajes** (Excel del mes): `data/RESIDUOS/pesajes/<año>/MM - Pesajes <mes> YY.xlsx`
- **Grandes productores** (Excel FOBESA por hotel/camping): `data/RESIDUOS/grandes_productores/<año>/`. Se descargan del SharePoint **Centro de Control de Datos Peñíscola › Documentos › Ciudad › Residuos › Grandes Productores › Datos FOBESA <año>** (el usuario abre su sesión de SharePoint; puedes conducir el navegador y bajar los meses nuevos como en la sesión de julio 2026). El procesador tolera columnas desplazadas y nombres de fracción distintos, pero conviene mantener una hoja "Hoja1" con Establecimiento + Envases/Orgánica/Papel.
- **Cámaras** (CSV export de HikCentral): LPR en `data/camaras/Trafico_camaras/CSV/`, aforo en `data/camaras/Camaras_Multiobjeto/CSV/<cámara>/`

Si no los tiene a mano, sigue igual: se procesará lo que haya y el resto se actualiza solo.

## 2. Ejecuta la actualización automática
Lanza el orquestador (es idempotente; tarda unos minutos por el reprocesado):

```
npm run actualizar
```

Hace: descarga camión (Sigeus, mes anterior + actual parcial) → residuos (`preparar_datos.py`) → grandes productores FOBESA (`procesar_grandes_productores.js`) → cámaras (`procesar_camaras.js`) → turismo INE (`procesar_turismo.js`) → viviendas GVA (`procesar_viviendas.js`), y termina con un RESUMEN de hasta qué mes llega cada fuente.

Córrelo en segundo plano si es largo y lee el log al terminar. Si un paso falla, continúa (el resumen lo marca) y dilo.

## 3. Verifica en local
- Arranca el server con Preview (puerto 7777) y comprueba rápido que Cámaras / Turismo / Residuos cargan sin errores de consola.
- Contrasta el RESUMEN del paso 2 (meses nuevos) con lo esperado.

## 4. Sube a producción (solo lo ligero)
- `git add` de los datos que cambien MENOS `data/RESIDUOS/camion/mapa_sample.json` (pesa >100 MB y GitHub lo rechaza). Incluye los `.xlsx` nuevos de pesajes si los hay.
- Verifica que nada staged supera ~100 MB antes de commitear.
- Commit con mensaje tipo `Datos: actualización mensual (camión, pesajes, turismo, viviendas, cámaras)` y push a `main`. Render despliega solo.

## 4b. Cámaras nuevas
El orquestador ejecuta `scripts/detectar_camaras_nuevas.js`, que compara las cámaras de los datos con `data/camaras/camaras_conocidas.json` y avisa de **LPR/aforo nuevas o desaparecidas**. Si aparece una **LPR nueva** (está previsto que instalen más):
1. Confírmalo con el usuario.
2. Añade sus coordenadas en `data/camaras/camaras_coordenadas.json` (para que salga en el mapa).
3. Fija la nueva referencia: `node scripts/detectar_camaras_nuevas.js --guardar`.

## 4c. SIT CV (gasto, demanda online, reputación) — extracción manual guiada
El SIT-CV de Invat·tur es un **Power BI embebido cross-origin (sin API pública)**: los datos se leen a mano de la pantalla. Cuando el usuario tenga su sesión abierta en `smarttourismcv.invattur.org` (él hace el login, nunca metas tú credenciales), condúcelo tú con el navegador (mcp__claude-in-chrome) y refresca estos tres ficheros:

- **Gasto** → `data/TURISMO/sit_gasto_manual.json`. Ruta: Visualizaciones genéricas → Gasto por tarjeta. Municipio de destino = **Peñíscola**. Copia KPIs (gasto total, ticket medio, nº tickets, nº tarjetas, % nacional/extranjero) y sus variaciones.
- **Demanda online** → `data/TURISMO/sit_busquedas_manual.json`. Ruta: Visualizaciones genéricas → Alojamientos → Alquiler vacacional online → DEMANDA → Análisis por destino. Slicers: provincia = **Castellón/Castelló**, municipio = **Peníscola/Peñíscola**. Pasa el ratón por la última barra para leer el valor exacto de **turistas** y de **reservas** (y su var. interanual) del último año cerrado.
- **Reputación** → `data/TURISMO/sit_reputacion_manual.json`. Ruta: Visualizaciones genéricas → Escucha activa del destino. Destino = **Peñíscola**. Copia menciones, impresiones, alcance y el desglose de sentimiento (muy positiva/positiva/neutra/muy negativa) + % positivas.

Patrón fiable del slicer Power BI: abre el desplegable → clic en el campo "Buscar" → escribe "Peñíscola" → clic en el radio del resultado → clic fuera → espera ~6 s a que recargue. Actualiza `actualizado` y `periodo` en cada JSON. Estos ficheros son ligeros: se commitean con el resto. Verifica en local que las tres secciones de Turismo (Gasto / Demanda online / Reputación) muestran los nuevos números.

## 5. Informa y recuerda lo pendiente
Resume qué se actualizó (meses nuevos por fuente) y recuerda lo que NO es automático:
- **Google Analytics**: si el aviso marca `invalid_grant`, hay que reconectar OAuth (enlace `/api/redes/oauth/start`).
- **SIT CV** (gasto/demanda online/reputación): extracción manual guiada del paso 4c (mientras Invat·tur no dé un feed/API).
- **Agua**: pendiente del fichero del servicio municipal.

## Notas
- Credenciales de Sigeus (camión) están en `.env` (`SIGEUS_*`); no las eches por pantalla.
- El OPENAI_API_KEY del `.env` es real: nunca lo muestres.
- Los CSV de cámaras y el `mapa_sample.json` están gitignoreados o se excluyen a propósito.
