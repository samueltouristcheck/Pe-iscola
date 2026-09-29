# Base de datos propia · Flux Vision (Invattur Smart Tourism CV)

Datos de movilidad turística de **Peñíscola Municipio** que el **INE no ofrece** y que sí da
**Flux Vision / Segitur** a través del cuadro de mando de Invattur (SIT-CV):
tipología de visitante, origen nacional/extranjero, país y provincia de origen, y **previsión**.

- Fuente: https://smarttourismcv.invattur.org → *Modelos IA y analítica avanzada → Previsión de visitantes*
- Disponibilidad del dato: **descriptivo** 2024-01-01 → 2026-05-31 · **predictivo** 2025-01-01 → 2026-12-31
- El cuadro es Power BI embebido, **sin API**. La extracción es manual (ver abajo).

## Cómo extraer (cada visual)

1. Abrir la sesión en Invattur (lo hace Samuel; el asistente solo lee/mueve lo ya logueado).
2. Fijar los slicers: **Selecciona un destino = Peñíscola Municipio**. Para series diarias
   descriptivas, poner **Periodo pasado** en el año que se quiera (un año por export; el export
   agrega por Mes+Día y **no lleva columna de año**, así que mezclar años colisiona).
3. Sobre el visual: pasar el ratón → aparece la barra → **⋯ (Más opciones)** →
   **Exportar datos** → **Datos resumidos** → formato **.xlsx** → **Exportar**.
   (*Datos subyacentes* está desactivado por el autor del informe.)
4. Guardar el .xlsx en `exports/` con un nombre normalizado (ver convención abajo).
5. Ejecutar `python generar_sit_cv.py` para regenerar `sit_cv.json`.

## Ficheros ya capturados (`exports/`)

| Fichero | Visual | Periodo | Dimensión (no-INE) |
|---|---|---|---|
| `prevision_visitantes_dia_semana_pasado_2025.xlsx` | Visión general · ¿Cuántos visitantes por día de la semana? | 2025 | tipo × día de semana (excursionista/habitualmente presente/residente/turista) |
| `receptor_evolucion_diaria_descriptivo_origen.xlsx` | ¿Evolución descriptiva según origen? | 2025 | serie diaria nacionales/extranjeros |
| `receptor_evolucion_mensual_predictivo_pais.xlsx` | Turismo receptor · evolución predictiva según país | 2026 (pronóstico) | serie diaria por país (FR/DE/IT/NL/UK) |
| `interno_evolucion_diaria_predictivo_provincia.xlsx` | Turismo interno · evolución predictiva según provincia | 2026 (pronóstico) | serie diaria por provincia (Madrid/Valencia/Alicante/Bizkaia) |

`sit_cv.json` = base normalizada que consume el dashboard (agregados mensuales + tipología semanal).

## Pendiente (dump histórico — paso 1 acordado con Samuel)

**Alcance temporal: desde enero de 2025** (Samuel, 29/09). Series descriptivas 2025 +
2026 parcial (hasta may-26); predictivo 2025-2026.

### Las 8 páginas que pidió Belén (correo bmiguel@peniscola.org, 28/09) — prioridad

1. [~] **Previsión de visitantes** — en marcha (Visión general, Turismo receptor, Turismo interno).
       Falta: descriptivo 2025 limpio de país y provincia; pestañas *Según género* y *Según edad* (interno); % barras.
2. [ ] **Oferta turística reglada**
3. [x] **Análisis vacacional online** (Alquiler vacacional online) — NÚCLEO HECHO: **7 series mensuales
       2025 vs 2024** en `sit_cv.json` → demanda (turistas), rentabilidad (ADR, RevPar, Revenue, ocupación)
       y oferta (apartamentos, plazas). Exports en `exports/alquiler_vacacional/`.
       Opcional (secundario): resto de DEMANDA (reservas, estancia, anticipación), OFERTA (habitaciones/camas,
       Según tipo), *Comparativa de destinos* y *Origen del turista* a año completo (slicer Mes en "Todas").
       Pestaña **Origen del turista (Ciudad)** LOCALIZADA: 4 barras por ciudad de origen del huésped OTA
       — cuota de turistas (Valencia 13,6%, Madrid 4,0%, Gandia 3,8%, Burriana/Castelló 2,6%, Alzira,
       Bulach, São Paulo, Almenara, Mataro, Paris, London, Los Angeles…), nº reservas, precio medio/noche
       y satisfacción (4,7–5,0). **OJO:** aquí el slicer "Mes" arranca en **Ene**; para el año hay que
       ponerlo en "Todas" (el desplegable Mes de Power BI cuesta abrirlo). Pendiente de exportar limpio.
4. [ ] **Rentabilidad · análisis por destino**
5. [ ] **Oferta · análisis por destino**
6. [ ] **Demanda · análisis por destino**
7. [ ] **Turismo interprovincial**
8. [ ] **Movilidad internacional vía móvil**

- [ ] Después del histórico: **rutina mensual** = reexportar solo el mes nuevo.

### Oferta turística reglada (INE) — Peñíscola SÍ está (nota 29/09)
Cuadro *Visualizaciones genéricas → Alojamiento → Hoteles/apartamentos/campings*
(`/api/alojamientos/hoteles-apartamentos-y-campings`, fuente **INE**: EOH/EOAP/EOC).
Tiene pestañas geográficas **CCAA | Provincia | Punto Turístico** → en "Punto Turístico" se puede
elegir **Peníscola/Peñíscola**. **Truco del selector que SÍ funciona:** abrir el desplegable, clic en
"Buscar", teclear `Pen` y **pulsar Intro** (filtra al pulsar Intro, no en vivo), luego clic en la opción.
OJO: cada sección (DEMANDA/OFERTA/RENTABILIDAD) resetea el destino a CCAA; hay que re-fijarlo por sección.
**Es dato INE que ya ingerimos directamente**, así que reproducirlo es de baja prioridad (Samuel: centrarse
en lo no-INE). Cifras de referencia leídas de Peñíscola (INE, 2025 vs 2024):
- Turistas: **Hoteles 393.629 (+4,4%)**, Campings 61.570 (−3,5%), Apartamentos 52.180 (−12,5%)
- Pernoctaciones: Hoteles 1.486.363, Campings 405.299, Apartamentos 394.299
- Estancia media (noches): Hoteles 3,8, Campings 6,6, Apartamentos 7,6
- Reparto de turistas: Hoteles 77,6% · Campings 12,1% · Apartamentos 10,3%
- (ADR/RevPAR de hoteles Peñíscola: pendiente; la sección Rentabilidad reinicia a CCAA y hay que re-fijar el punto turístico)

Nota para desbloquear género/edad y movilidad: el mismo **truco buscar+Intro** puede funcionar en esos
selectores; el problema antes fue que no pulsé Intro o la lista era demasiado larga. Merece reintento.

### Estado a 29/09 (sesión)
- Método de exportación probado en 3 tipos de visual y 3 páginas; 4 exports normalizados en `sit_cv.json`.
- Las 8 páginas de Belén localizadas en el cuadro de mando (mapa abajo).
- **Alquiler vacacional online confirmado para Peñíscola**: fijado destino Castellón→Peníscola,
  la demanda OTA existe y crece (nº turistas +5,4% y reservas +6,1% último año interanual).
  Export pendiente (a este nivel solo hay comparación *Anual*; *Mensual/Diario* aparecen deshabilitados).
- Buscador de slicers Power BI: es **sensible a acentos** (Peñíscola se busca como "Pen", no "Peni")
  y a veces el texto tecleado no entra al primer intento; el filtro se aplica con Intro.

### Exports capturados de Alquiler vacacional online (Peñíscola) → `exports/alquiler_vacacional/`
- `demanda_turistas_mensual_2025_vs_2024.xlsx` — nº turistas OTA por mes, 2025 vs 2024 (validado:
  suma 12 meses = 102.923 = KPI; el filtro `ORIGIN_CITY_DES=Valencia` que aparece en la cabecera
  **no** afecta a este visual). Peñíscola OTA 2025: **102.923 turistas (+5,4%)**, reservas 29.449
  (+6,1%), estancia media 6,8 noches, anticipación 56,4 días.
- **Trampa:** hay un slicer *Ciudad de origen* (por defecto Valencia) que SÍ afecta a los visuales
  de origen/plazas — ponerlo en "Todas" antes de exportar esos. Comparación de tiempo: Anual/**Mensual**/Diario;
  en Mensual el Año analizado ya sale 2025 (vs 2024), que es justo "desde 2025".

### Dónde vive cada página en Invattur (mapa localizado 29/09)

Base: `https://smarttourismcv.invattur.org`

| Página de Belén | Ubicación en el cuadro de mando | Ruta |
|---|---|---|
| Previsión de visitantes | Modelos IA → Previsión de visitantes (pestañas: Visión general, Turismo receptor, Turismo interno) | `/api/soluciones-ia-y-analitica-avanzada/prevision-de-visitantes` |
| Turismo interprovincial | Visualizaciones genéricas → Presencia y movilidad → **Movilidad diurna y nocturna** → pestaña *Turismo interprovincial* (subpáginas: mov. según pernoctación / según actividad diurna / comparativas) | `/api/visualizaciones-genericas/presencia-y-movilidad/movilidad-diurna-y-nocturna` |
| (Turismo intraprovincial) | mismo dashboard, pestaña *Turismo intraprovincial* | idem |

> **Movilidad interprovincial — nota 29/09:** la subpágina *Turismo interprovincial → Comparativa destinos
> (movilidad según pernoctación)* SÍ trae una **tabla limpia y exportable** ("Zonas en las que los
> visitantes durmieron la víspera / el día", Destino × Visitantes P.analizado/comparativo × %var,
> agrupada por provincia), no solo burbujas. **Pendiente:** fijar *Destino de visita = Peñíscola* y
> *Año = 2025*. Problema: ese slicer es **multi-selección** y su caja "Buscar" no coge el foco con los
> clics (queda con texto viejo y muestra solo los ya marcados: Alicante/Benidorm/Valencia Municipio).
> **Prueba 29/09 (concluyente sobre el método, no sobre el dato):** con triple-click SÍ se escribe en la
> caja "Buscar" del selector "Destino de visita" (multi-selección), pero al buscar **"scola" (Peñíscola),
> "Cast" (Castellón) y hasta "Gan" (Gandia, que existe con seguridad) NO se renderiza ninguna coincidencia**
> — la lista solo muestra los ya marcados (Alicante/Benidorm/Valencia Municipio). Es decir, **es una
> limitación de manejar ESE control por automatización**, NO prueba de que Peñíscola falte. **Lo tiene que
> fijar Samuel a mano** en su navegador (sus clics normales sí funcionan): abrir *Turismo interprovincial →
> Comparativa destinos (según pernoctación)*, en "Destino de visita" desmarcar y marcar **Peñíscola**, poner
> **Año = 2025**, y exportar la tabla ("Datos con diseño actual", que es tabla). Si Peñíscola aparece,
> tenemos la movilidad interprovincial; si no aparece ni marcándolo a mano, es que el cuadro no cubre
> Castellón. Dato del cuadro: W22-2022 → W22-2026, semanal; suma acumulada (no personas reales); se
> suprimen unidades con <20 registros.
| Movilidad internacional vía móvil | (por localizar — probablemente otra subpágina de Presencia y movilidad o de Movilidad diurna y nocturna) | — |
| Análisis vacacional online (demanda/oferta/rentabilidad + *análisis por destino*) | Visualizaciones genéricas → Alojamiento → **Alquiler vacacional online** (fuente **Lighthouse Intelligence**, OTA Airbnb/Booking/Vrbo; secciones DEMANDA/OFERTA/RENTABILIDAD) | `/api/visualizaciones-genericas/alojamientos/alquiler-vacacional-online` |
| Oferta turística reglada | Visualizaciones genéricas → Alojamiento → Hoteles/apartamentos/campings + Turismo rural (encuestas de ocupación INE) | `/api/alojamientos/hoteles-apartamentos-y-campings` · `/api/alojamientos/turismo-rural` |
| (Viviendas turísticas online) | Visualizaciones genéricas → Alojamiento → Viviendas turísticas online | `/api/visualizaciones-genericas/alojamientos/viviendas-turisticas-online` |

**OJO destino:** varias páginas arrancan en otro municipio (p.ej. Alquiler vacacional online abre en
**Elx/Elche, Alicante**). Hay que fijar **Provincia = Castellón/Castelló** y **Municipio = Peñíscola/Peníscola**
antes de exportar. Métrica ADR/Revenue/RevPAR/ocupación a nivel municipal (OTA), útil para complementar VUT.

Otros dashboards de **Presencia y movilidad** (movilidad, útiles para el módulo Movilidad):
`estancia-diurna`, `estancia-nocturna`, `movilidad-diurna-y-nocturna`,
`.../presencia-y-movilidad/comportamiento-de-llegadas-y-salidas-de-turistas`.

Nota: el dato de movilidad es **semanal a nivel municipio**, disponibilidad W22-2022 → W22-2026,
y lleva la advertencia de que "la suma por día no refleja personas reales sino el dato acumulado".

Truco de navegación: las pestañas del menú lateral tardan; el contenido del informe aparece
**al hacer scroll hacia abajo** (queda debajo de la portada "Sobre el análisis").
El calendario de los slicers de fecha se abre/cierra con el icono de calendario del propio campo.

## Nota de método

- Quitar `read_only` al leer los .xlsx con openpyxl: estos exports declaran mal el rango y
  en modo read_only se truncan a la primera fila.
- Meses en español abreviados: Ene…Dic → 01…12.
