---
name: actualizar-datos
description: Actualización mensual del cuadro de mando de Peñíscola. Invócalo cuando el usuario diga "actualicemos esto", "actualizar datos", "toca actualizar el dashboard", "actualización mensual" o similar. Descarga/reprocesa todas las fuentes automáticas, verifica y sube a producción lo ligero.
---

# Actualización mensual del cuadro de mando (Peñíscola)

Objetivo: dejar el dashboard al día con el mínimo esfuerzo del usuario. Sigue estos pasos en orden.

## 1. Pregunta por los ficheros manuales (una vez)
Antes de ejecutar, recuerda al usuario que, si los tiene, deje en su carpeta:
- **Pesajes** (Excel del mes): `data/RESIDUOS/pesajes/<año>/MM - Pesajes <mes> YY.xlsx`
- **Cámaras** (CSV export de HikCentral): LPR en `data/camaras/Trafico_camaras/CSV/`, aforo en `data/camaras/Camaras_Multiobjeto/CSV/<cámara>/`

Si no los tiene a mano, sigue igual: se procesará lo que haya y el resto se actualiza solo.

## 2. Ejecuta la actualización automática
Lanza el orquestador (es idempotente; tarda unos minutos por el reprocesado):

```
npm run actualizar
```

Hace: descarga camión (Sigeus, mes anterior + actual parcial) → residuos (`preparar_datos.py`) → cámaras (`procesar_camaras.js`) → turismo INE (`procesar_turismo.js`) → viviendas GVA (`procesar_viviendas.js`), y termina con un RESUMEN de hasta qué mes llega cada fuente.

Córrelo en segundo plano si es largo y lee el log al terminar. Si un paso falla, continúa (el resumen lo marca) y dilo.

## 3. Verifica en local
- Arranca el server con Preview (puerto 7777) y comprueba rápido que Cámaras / Turismo / Residuos cargan sin errores de consola.
- Contrasta el RESUMEN del paso 2 (meses nuevos) con lo esperado.

## 4. Sube a producción (solo lo ligero)
- `git add` de los datos que cambien MENOS `data/RESIDUOS/camion/mapa_sample.json` (pesa >100 MB y GitHub lo rechaza). Incluye los `.xlsx` nuevos de pesajes si los hay.
- Verifica que nada staged supera ~100 MB antes de commitear.
- Commit con mensaje tipo `Datos: actualización mensual (camión, pesajes, turismo, viviendas, cámaras)` y push a `main`. Render despliega solo.

## 5. Informa y recuerda lo pendiente
Resume qué se actualizó (meses nuevos por fuente) y recuerda lo que NO es automático:
- **Google Analytics**: si el aviso marca `invalid_grant`, hay que reconectar OAuth (enlace `/api/redes/oauth/start`).
- **SIT CV** (gasto/búsquedas/reputación): pendiente de que Invat·tur dé un feed/API.
- **Agua**: pendiente del fichero del servicio municipal.

## Notas
- Credenciales de Sigeus (camión) están en `.env` (`SIGEUS_*`); no las eches por pantalla.
- El OPENAI_API_KEY del `.env` es real: nunca lo muestres.
- Los CSV de cámaras y el `mapa_sample.json` están gitignoreados o se excluyen a propósito.
