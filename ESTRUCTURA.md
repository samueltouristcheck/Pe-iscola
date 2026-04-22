# Estructura de datos Peñíscola Residuos

## Carpetas

```
Peñiscola_Cursor/
├── PESAJES/                    # Vertedero (tara, más exacto)
│   ├── 2018/ ... 2026/        # Por año
│   │   └── 01 - Pesajes enero YY.xlsx   # Formato unificado
├── JSON/                       # Camión (RFID, kilos por contenedor)
│   ├── 2022/ ... 2026/        # Por año
│   │   └── Residus_YYYY.json  # Formato unificado
│   └── Residus_Con_Zona.json
└── data/                       # Salida para el dashboard
    ├── pesajes/todos.json
    ├── camion/todos.json
    └── archivos.json
```

## Nombres unificados

- **PESAJES**: `01 - Pesajes enero 24.xlsx` (mes minúscula, año 2 dígitos)
- **JSON**: `Residus_2024.json`

## Fuentes de datos

| Fuente | Origen | Columnas clave |
|--------|--------|----------------|
| **Pesajes** | Vertedero (pesa tara) | Fecha, Carga (kg), Residuo, Población |
| **Camión** | RFID en camión | FullDate, Weight (kg), Garbage, Area |
