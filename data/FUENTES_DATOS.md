# Fuentes de datos - Peñíscola Dashboard

## Flujo mensual (actualizar datos)

1. **Sube** los archivos nuevos en las carpetas correspondientes
2. **Ejecuta** `npm run preparar` (procesa residuos + cámaras)
3. **Recarga** la web (http://localhost:7777)

## Estructura

```
data/
├── RESIDUOS/                 ← Todo lo de residuos
│   ├── pesajes/
│   │   ├── entrada/          ← Excels de pesajes (por año)
│   │   └── todos.json        ← Generado por preparar_datos.py
│   └── camion/
│       ├── JSON/             ← Residus_2022.json, Residus_2023.json, etc.
│       ├── todos.json        ← Generado por preparar_datos.py
│       └── mapa.json         ← Generado por preparar_datos.py
│
└── camaras/                  ← Todo lo de cámaras
    ├── Trafico_camaras/CSV/  ← LPR: matrículas (2511 Matriculas Nov 25.csv, etc.)
    ├── Camaras_Multiobjeto/CSV/  ← Multiobjeto: personas, vehículos (por cámara)
    ├── entrada/              ← CSV/Excel genérico (opcional)
    └── todos.json            ← Generado por procesar_camaras.js
```

---

## Módulo CÁMARAS DE ACCESOS

### Dónde poner los datos

| Tipo | Carpeta | Formato |
|------|---------|---------|
| **LPR** (matrículas) | `data/camaras/Trafico_camaras/CSV/` | CSV con 6 filas cabecera, col ; |
| **Multiobjeto** (personas, vehículos) | `data/camaras/Camaras_Multiobjeto/CSV/<nombre_camara>/` | CSV por cámara y mes |
| Genérico | `data/camaras/entrada/` | CSV o Excel |

### Cómo procesar

1. **Todo (residuos + cámaras):** `npm run preparar`
2. **Solo cámaras:** `npm run procesar-camaras`
3. **Botón en el dashboard:** En Cámaras, pulsa "Procesar archivos"

### Columnas esperadas (CSV/Excel)

El sistema acepta columnas con nombres flexibles. Se mapean así:

| Tu columna (ejemplos) | Se usa como |
|-----------------------|-------------|
| fecha, Fecha, FECHA, date | fecha (formato YYYY-MM o YYYY-MM-DD) |
| hora, Hora, time | hora |
| camara, cámara, Camara, nombre | camara |
| ubicacion, ubicación, lugar, zona | ubicacion |
| evento, tipo, Evento | evento |
| matricula, matrícula, coche, vehiculo | matricula |
| observaciones, notas | observaciones |

**Mínimo necesario:** `fecha` y al menos una de: `camara`, `ubicacion`, `evento`.

Si tu CSV/Excel tiene otras columnas, se guardan tal cual. El sistema es flexible.

### Formato de fecha

- `2025-03` (año-mes)
- `2025-03-15` (año-mes-día)
- `15/03/2025` (se intenta convertir)

---

## Módulo RESIDUOS

### Fuentes actuales

| Archivo | Descripción |
|---------|-------------|
| `data/RESIDUOS/pesajes/todos.json` | Pesajes (kg por zona/tipo) |
| `data/RESIDUOS/camion/todos.json` | Datos camión RFID |
| `data/RESIDUOS/camion/mapa.json` | Puntos para el mapa |

### Formato JSON esperado (pesajes)

```json
[
  { "fecha": "2024-01", "zona": "Zona Norte", "tipo": "RSU", "kg": 1500 },
  ...
]
```

### Formato JSON esperado (camión)

```json
[
  { "fecha": "2024-01", "zona": "Zona Norte", "tipo": "RSU", "kg": 200, "establecimiento": "Hotel X" },
  ...
]
```

---

## Resumen rápido

| Módulo | Qué subes | Dónde | Cómo procesar |
|--------|-----------|-------|---------------|
| **Cámaras** | CSV o Excel | `data/camaras/entrada/` | Botón "Procesar" o `node procesar_camaras.js` |
| **Residuos** | JSON (o Excel) | `data/RESIDUOS/camion/JSON/`, `data/RESIDUOS/pesajes/entrada/` | `python preparar_datos.py` |
