# Peñíscola - Dashboard Residuos

Web privada para visualizar datos de residuos. Uso local para análisis.

## Estructura

```
Peñiscola_Cursor/
├── PESAJES/            # Vertedero (tara) - Excel por año/mes
│   ├── 2018/ ... 2026/
├── JSON/               # Camión (RFID) - JSON por año
│   ├── 2022/ ... 2026/
├── data/               # Datos preparados para el dashboard
│   ├── pesajes/        # JSON convertidos desde Excel
│   └── camion/         # JSON del camión
├── preparar_datos.py   # Convierte todo y genera data/
├── organizar_carpetas.py  # Reorganiza por año/mes
└── index.html
```

## Cómo usar

### 1. Arrancar en local

Necesitas un servidor local (por seguridad del navegador con archivos):

```bash
# Opción A: Python
python -m http.server 8000

# Opción B: Node.js (si tienes npx)
npx serve .

# Opción C: servidor del proyecto (recomendado: API + datos)
npm start
```

Con Python/npx abre el puerto que indique la consola (p. ej. **http://localhost:8000**). Con **`npm start`** el dashboard queda en **http://localhost:7777**.

### 2. Preparar datos

```bash
pip install -r requirements.txt
python organizar_carpetas.py   # Reorganiza PESAJES y JSON por año
python preparar_datos.py       # Convierte Excel → JSON en data/
```

### 3. Fuentes de datos

- **Pesajes** (vertedero): datos del vertedero, más exactos (tara)
- **Camión** (RFID): kilos por contenedor desde el camión

Selecciona la fuente en el desplegable del dashboard y pulsa Recargar

### 3. Formato de datos recomendado

El dashboard detecta columnas como:
- `fecha` / `Fecha` – para la serie temporal
- `zona` / `Zona` – para distribución por zona
- `tipo` / `Tipo` – para tipos de residuo
- `kg` / `KG` – cantidad en kg

Si usas otros nombres, podemos adaptar el código.

### 4. Convertir Excel a JSON (opcional)

```bash
pip install pandas openpyxl
python convertir_excel.py tu_archivo.xlsx -o data/residuos.json
```

## Próximos pasos

- Añadir más gráficos según tus necesidades
- Ajustar columnas a tu Excel real
- Filtros por fecha, zona, tipo
- Exportar reportes
