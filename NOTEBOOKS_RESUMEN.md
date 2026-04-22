# Resumen de los Notebooks de Peñíscola Residuos

## 1. Juntar Excels residuos.ipynb
**Propósito**: Unificar archivos Excel de pesajes en un único CSV.

- Lee Excel de `PESAJES/YYYY/` (01-, 02-, etc.)
- Columnas: Fecha, Fecha/hora, Ticket, Matrícula, Peso total, Tara, **Carga**, Población, Residuo
- Añade: Año, Mes_num, Mes, Archivo
- Salida: `Pesajes_Excel_Unificados.csv`
- **Carga** = peso neto (kg) por pesada en vertedero

## 2. NB_JSON_to_CSV.ipynb
**Propósito**: Procesar JSON del camión (RFID) y enriquecer con zonas.

- Carga Residus 2024, 2025, 2026
- FullDate → datetime, Weight (kg por contenedor)
- DBSCAN para clustering geográfico → asignar zonas (NombreArea)
- Salida: CSV con columnas Año, Mes, Día, Peso, ClusterID, NombreArea, viaje, Salida

## 3. GropBY_Excel_CSV.ipynb
**Propósito**: Agrupar y cruzar datos Excel + Camión.

- Carga Pesajes_Excel_Unificados.csv (vertedero)
- Carga CSV del camión (de NB_JSON)
- GroupBy por Matrícula + Salida para calcular peso por contenedor
- Merge de ambas fuentes

## Integración en el dashboard
- **Pesajes**: suma de Carga (kg) por mes → ya implementado
- **Camión**: suma de Weight (kg) por mes → ya implementado
- Las zonas (NombreArea/ClusterID) del notebook se pueden usar para el gráfico "por zona"
