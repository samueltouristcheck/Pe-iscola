#!/usr/bin/env python3
"""
Prepara los datos de Peñíscola Residuos para el dashboard.
- Reorganiza carpetas por año/mes
- Convierte pesajes Excel a JSON
- Unifica datos del camión

Ejecutar: python preparar_datos.py
"""

import json
import random
import re
import shutil
from datetime import datetime
from pathlib import Path


def _anio_fecha_razonable(fecha: str) -> bool:
    """Excluye años futuros (p. ej. error al leer Excel) y basura."""
    if not fecha or fecha == "Sin fecha":
        return False
    m = re.match(r"^(\d{4})", str(fecha).strip())
    if not m:
        return False
    try:
        y = int(m.group(1))
        return 1990 <= y <= datetime.now().year
    except ValueError:
        return False

try:
    import pandas as pd
except ImportError:
    print("Instala pandas: pip install pandas openpyxl xlrd")
    exit(1)

BASE = Path(__file__).parent
DATA = BASE / "data"
RESIDUOS = DATA / "RESIDUOS"
# Única fuente Excels de pesajes (subcarpetas año, entrada/, etc.)
PESAJES_ROOT = RESIDUOS / "pesajes"
CAMION = RESIDUOS / "camion"
# Única fuente JSON del camión
JSON_CAMION = RESIDUOS / "camion" / "JSON"
GEOJSON_ZONAS = DATA / "Zonificación Peñíscola (1).geojson"
GEOJSON_ALT = Path(r"C:\Users\touri\Desktop\Peñiscola Residuos\VCS\Zonificación Peñíscola (1).geojson")


def _point_in_polygon(lon: float, lat: float, ring: list) -> bool:
    """Ray-casting: punto (lon, lat) dentro del polígono?"""
    n = len(ring)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def cargar_polygonos_zonas() -> list:
    """Carga polígonos del GeoJSON. Retorna [(ring, name), ...]"""
    path = GEOJSON_ZONAS if GEOJSON_ZONAS.exists() else GEOJSON_ALT
    if not path or not path.exists():
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []
    polygons = []
    for feat in data.get("features", []):
        geom = feat.get("geometry", {})
        if geom.get("type") != "Polygon":
            continue
        coords = geom.get("coordinates", [])
        if not coords:
            continue
        ring = coords[0]
        name = feat.get("properties", {}).get("name", "Sin nombre")
        polygons.append((ring, name))
    return polygons


def asignar_zona(lon: float, lat: float, polygons: list) -> str:
    """Devuelve el nombre de la zona que contiene (lon, lat)."""
    for ring, name in polygons:
        if _point_in_polygon(lon, lat, ring):
            return name
    return ""


def normalizar_fecha_pesajes(row):
    """Convierte Fecha de pesajes a YYYY-MM."""
    f = row.get("Fecha")
    if pd.isna(f):
        return None
    if hasattr(f, "strftime"):
        out = f.strftime("%Y-%m")
        try:
            if int(out[:4]) > datetime.now().year:
                return None
        except ValueError:
            return None
        return out
    s = str(f)
    m = re.search(r"(\d{4})[-/](\d{1,2})", s)
    if not m:
        return None
    y = int(m.group(1))
    if y > datetime.now().year:
        return None
    return f"{m.group(1)}-{int(m.group(2)):02d}"


def convertir_pesajes_excel(excel_path: Path) -> list:
    """Convierte Excel de pesajes a registros normalizados."""
    try:
        df = pd.read_excel(excel_path, sheet_name=0)
    except Exception as e:
        print(f"  Error leyendo {excel_path.name}: {e}")
        return []

    # Columnas pesajes vertedero: Fecha, Carga, Residuo, Población
    cols_lower = {str(c).lower().strip(): c for c in df.columns}
    fecha_col = next((cols_lower[k] for k in ["fecha", "date"] if k in cols_lower), None)
    carga_col = next((cols_lower[k] for k in ["carga", "peso neto"] if k in cols_lower), None)
    if not carga_col:
        carga_col = next((cols_lower[k] for k in ["peso total", "peso"] if k in cols_lower), None)
    residuo_col = next((cols_lower[k] for k in ["residuo", "garbage", "tipo"] if k in cols_lower), None)
    poblacion_col = next((cols_lower[k] for k in ["población", "poblacion", "area", "zona"] if k in cols_lower), None)

    if not fecha_col:
        fecha_col = df.columns[0] if len(df.columns) > 0 else None
    if not carga_col:
        for c in df.columns:
            if "carga" in str(c).lower():
                carga_col = c
                break
        if not carga_col and "Carga" in df.columns:
            carga_col = "Carga"

    if carga_col is None:
        return []

    records = []
    for _, row in df.iterrows():
        carga = row.get(carga_col)
        if pd.isna(carga) or (isinstance(carga, (int, float)) and carga <= 0):
            continue
        try:
            carga = float(carga)
        except (TypeError, ValueError):
            continue

        fecha = normalizar_fecha_pesajes(row) if fecha_col else None
        records.append({
            "fecha": fecha or "Sin fecha",
            "fuente": "pesajes",
            "zona": str(row.get(poblacion_col, "")).strip() if poblacion_col else "",
            "tipo": str(row.get(residuo_col, "")).strip() if residuo_col else "RSU",
            "kg": round(carga, 2),
        })
    return records


def convertir_json_camion(item: dict, polygons: list = None) -> dict:
    """Normaliza un registro del JSON del camión. Si polygons, asigna zona por GeoJSON."""
    full = str(item.get("FullDate", item.get("FullDateUtc", "")))
    if len(full) >= 6:
        try:
            yf = int(full[:4])
            fecha = f"{full[:4]}-{full[4:6]}" if yf <= datetime.now().year else "Sin fecha"
        except ValueError:
            fecha = "Sin fecha"
    else:
        fecha = "Sin fecha"

    peso = item.get("Weight", item.get("weight", 0))
    try:
        peso = float(peso) if peso is not None else 0
    except (TypeError, ValueError):
        peso = 0

    zona = ""
    if polygons:
        lon = item.get("Longitude")
        lat = item.get("Latitude")
        try:
            lon = float(lon) if lon is not None else None
            lat = float(lat) if lat is not None else None
        except (TypeError, ValueError):
            lon = lat = None
        if lon is not None and lat is not None:
            zona = asignar_zona(lon, lat, polygons)
    if not zona:
        zona = str(item.get("Area", item.get("Zona", "")) or "").strip()

    # Establecimiento (hotel/camping): preferir ContainerAddressObservations, luego Area
    area = str(item.get("Area", "") or "").strip()
    addr = str(item.get("ContainerAddressObservations", "") or "").strip()
    establecimiento = addr if addr else area

    lat_v = lng_v = None
    try:
        lo = item.get("Longitude")
        la = item.get("Latitude")
        if lo is not None and la is not None:
            lng_v = float(lo)
            lat_v = float(la)
            if lat_v == 0 and lng_v == 0:
                lat_v = lng_v = None
    except (TypeError, ValueError):
        lat_v = lng_v = None

    return {
        "fecha": fecha,
        "fuente": "camion",
        "zona": zona,
        "tipo": str(item.get("Garbage", "") or "Mezcla de residuos municipales").strip(),
        "kg": round(peso, 2),
        "establecimiento": establecimiento,
        "lat": lat_v,
        "lng": lng_v,
    }


def procesar_pesajes():
    """Convierte Excels a JSON. Solo lee de data/RESIDUOS/pesajes/ (toda la jerarquía)."""
    out = PESAJES_ROOT
    out.mkdir(parents=True, exist_ok=True)

    todo = []
    if not PESAJES_ROOT.exists():
        print(f"  No existe la carpeta de pesajes (solo aquí): {PESAJES_ROOT}")
        return 0

    for pattern in ("*.xlsx", "*.xls"):
        for f in sorted(PESAJES_ROOT.rglob(pattern)):
            if not f.is_file():
                continue
            if f.name.startswith("~$"):  # Excel temporal bloqueado
                continue
            try:
                recs = convertir_pesajes_excel(f)
                if recs:
                    todo.extend(recs)
            except Exception as e:
                print(f"  Error {f.relative_to(PESAJES_ROOT)}: {e}")

    if todo:
        (out / "todos.json").parent.mkdir(parents=True, exist_ok=True)
        with open(out / "todos.json", "w", encoding="utf-8") as fp:
            json.dump(todo, fp, ensure_ascii=False, indent=2)
        print(f"Pesajes: {len(todo)} registros -> data/RESIDUOS/pesajes/todos.json")
    return len(todo)


def item_con_coordenadas(item: dict) -> bool:
    """Comprueba si el registro tiene coordenadas válidas."""
    lat = item.get("Latitude")
    lon = item.get("Longitude")
    try:
        return lat is not None and lon is not None and float(lat) != 0 and float(lon) != 0
    except (TypeError, ValueError):
        return False


def item_a_mapa(item: dict, polygons: list = None) -> dict:
    """Extrae campos necesarios para el mapa. Si polygons, asigna zona."""
    full = str(item.get("FullDate", item.get("FullDateUtc", "")))
    fecha = f"{full[:4]}-{full[4:6]}" if len(full) >= 6 else "Sin fecha"
    fecha_dia = f"{full[:4]}-{full[4:6]}-{full[6:8]}" if len(full) >= 8 else fecha
    resource = str(item.get("Resource", "") or "").strip()
    matricula = str(item.get("ResourceRegistration", "") or "").strip()
    if not matricula and resource:
        m = re.search(r"-(\d+[A-Z0-9]+)(?:\s|$)", resource)
        if m:
            matricula = m.group(1)
        elif not matricula:
            matricula = resource
    lon = float(item.get("Longitude", 0))
    lat = float(item.get("Latitude", 0))
    zona = asignar_zona(lon, lat, polygons) if polygons else ""
    return {
        "fecha": fecha,
        "fecha_dia": fecha_dia,
        "lat": lat,
        "lng": lon,
        "zona": zona,
        "address": str(item.get("Address", "") or "").strip(),
        "resource": resource,
        "matricula": str(matricula).strip() if matricula else resource,
        "garbage": str(item.get("Garbage", "") or "Mezcla de residuos municipales").strip(),
        "containerType": str(item.get("ContainerType", "") or "").strip(),
        "weight": round(float(item.get("Weight", 0) or 0), 2),
        "area": str(item.get("Area", item.get("Zona", "")) or "").strip(),
    }


def procesar_camion():
    """Normaliza JSON del camión. Solo lee de data/RESIDUOS/camion/JSON/. Asigna zonas con GeoJSON."""
    out = CAMION
    out.mkdir(parents=True, exist_ok=True)

    json_dir = JSON_CAMION
    if not json_dir.exists():
        print(f"  No existe la carpeta del camión (solo aquí): {json_dir}")
        return 0

    polygons = cargar_polygonos_zonas()
    if polygons:
        print(f"Zonas GeoJSON cargadas: {len(polygons)}")

    años_cargados = set()
    todo = []
    mapa = []

    def procesar_items(data, year_str=None):
        for item in data:
            if not isinstance(item, dict) or item.get("Weight") is None:
                continue
            todo.append(convertir_json_camion(item, polygons))
            if item_con_coordenadas(item):
                mapa.append(item_a_mapa(item, polygons))

    # Subcarpetas por año: JSON/2022/Residus_2022.json, etc.
    for subdir in sorted(json_dir.iterdir()):
        if not subdir.is_dir():
            continue
        if not re.fullmatch(r"\d{4}", subdir.name):
            continue
        year_str = subdir.name
        f_subdir = subdir / f"Residus_{year_str}.json"
        if f_subdir.exists():
            try:
                with open(f_subdir, encoding="utf-8") as fp:
                    data = json.load(fp)
                if isinstance(data, list):
                    procesar_items(data, year_str)
                    años_cargados.add(year_str)
            except Exception as e:
                print(f"  Error {f_subdir.name}: {e}")

    # Si no hubo datos por carpetas año, usar JSON sueltos en la raíz (incl. Residus_Con_Zona.json)
    if not años_cargados:
        for f in sorted(json_dir.glob("Residus*.json")):
            m = re.search(r"(\d{4})", f.stem)
            year_guess = m.group(1) if m else None
            if year_guess and year_guess in años_cargados:
                continue
            try:
                with open(f, encoding="utf-8") as fp:
                    data = json.load(fp)
                if isinstance(data, list):
                    procesar_items(data, year_guess)
                    if year_guess:
                        años_cargados.add(year_guess)
            except Exception as e:
                print(f"  Error {f.name}: {e}")

    if todo:
        with open(out / "todos.json", "w", encoding="utf-8") as fp:
            json.dump(todo, fp, ensure_ascii=False, indent=2)
        con_zona = sum(1 for r in todo if r.get("zona"))
        print(f"Camion: {len(todo)} registros ({con_zona} con zona) -> data/RESIDUOS/camion/todos.json")
    if mapa:
        with open(out / "mapa.json", "w", encoding="utf-8") as fp:
            json.dump(mapa, fp, ensure_ascii=False, indent=0)
        print(f"Mapa: {len(mapa)} puntos con coordenadas -> data/RESIDUOS/camion/mapa.json")
        # Muestra ligera para el navegador: proporcional por mes (YYYY-MM) para que al filtrar un mes no queden casi vacíos
        max_ui = 400000
        muestra_ui = muestra_mapa_proporcional_por_mes(mapa, max_ui)
        with open(out / "mapa_sample.json", "w", encoding="utf-8") as fp:
            json.dump(muestra_ui, fp, ensure_ascii=False, indent=0)
        print(f"Mapa UI: {len(muestra_ui)} puntos -> data/RESIDUOS/camion/mapa_sample.json (máx. {max_ui}, por mes)")
    return len(todo)


def muestra_mapa_proporcional_por_mes(mapa: list, max_ui: int) -> list:
    """Reduce puntos conservando proporción por mes para que el filtro del dashboard muestre volumen real por periodo."""
    if not mapa or max_ui <= 0:
        return []
    if len(mapa) <= max_ui:
        return list(mapa)
    by_mes = {}
    for p in mapa:
        fe = (p.get("fecha") or "")[:7] if isinstance(p.get("fecha"), str) else ""
        if len(fe) != 7:
            fe = "?"
        by_mes.setdefault(fe, []).append(p)
    total = len(mapa)
    out = []
    for _mes, pts in sorted(by_mes.items()):
        n_target = max(1, int(max_ui * len(pts) / total))
        if len(pts) <= n_target:
            out.extend(pts)
        else:
            out.extend(random.sample(pts, n_target))
    if len(out) > max_ui:
        out = random.sample(out, max_ui)
    return out


def reorganizar_carpetas():
    """Reorganiza PESAJES y JSON en estructura año/mes."""
    # Reservado: por ahora no movemos archivos
    pass


def generar_resumen_residuos():
    """Genera data/RESIDUOS/resumen.json (ligero) para el dashboard."""
    pesajes_path = RESIDUOS / "pesajes" / "todos.json"
    camion_path = RESIDUOS / "camion" / "todos.json"
    pesajes = []
    camion = []
    if pesajes_path.exists():
        try:
            with open(pesajes_path, encoding="utf-8") as f:
                pesajes = json.load(f)
        except Exception as e:
            print(f"  Error leyendo pesajes: {e}")
    if camion_path.exists():
        try:
            with open(camion_path, encoding="utf-8") as f:
                camion = json.load(f)
        except Exception as e:
            print(f"  Error leyendo camión: {e}")
    if not pesajes and not camion:
        return
    # Agregar por mes
    resumen = {"pesajes": [], "camion": []}
    by_p = {}
    for r in pesajes if isinstance(pesajes, list) else []:
        f = r.get("fecha") or ""
        if len(f) >= 7 and _anio_fecha_razonable(f):
            by_p[f] = by_p.get(f, 0) + float(r.get("kg") or 0)
    resumen["pesajes"] = [{"fecha": k, "kg": round(v, 2)} for k, v in sorted(by_p.items())]
    by_c = {}
    for r in camion if isinstance(camion, list) else []:
        f = r.get("fecha") or ""
        if len(f) < 7 or not _anio_fecha_razonable(f):
            continue
        if f not in by_c:
            by_c[f] = {"kg": 0, "salidas": 0, "zonas": {}, "tipos": {}, "hoteles": {}}
        w = float(r.get("kg") or r.get("weight") or 0)
        by_c[f]["kg"] += w
        by_c[f]["salidas"] += 1
        z = (r.get("zona") or "").strip()
        if z and "peñiscola" not in z.lower() and "sin zona" not in z.lower():
            by_c[f]["zonas"][z] = by_c[f]["zonas"].get(z, 0) + w
        t = (r.get("tipo") or r.get("garbage") or "Otro").strip()
        if t:
            by_c[f]["tipos"][t] = by_c[f]["tipos"].get(t, 0) + w
        h = (r.get("establecimiento") or r.get("area") or "").strip()
        if h and any(x in h.lower() for x in ["hotel", "camping", "aparthotel", "resort", "hostal"]) and "peñiscola rsu" not in h.lower():
            by_c[f]["hoteles"][h] = by_c[f]["hoteles"].get(h, 0) + w
    resumen["camion"] = []
    for k, v in sorted(by_c.items()):
        # Incluir todas las claves (ordenadas por kg); el dashboard ya no pierde datos
        zonas_top = dict(sorted(v["zonas"].items(), key=lambda x: -x[1]))
        tipos_top = dict(sorted(v["tipos"].items(), key=lambda x: -x[1]))
        hoteles_top = dict(sorted(v["hoteles"].items(), key=lambda x: -x[1]))
        resumen["camion"].append({"fecha": k, "kg": round(v["kg"], 2), "salidas": v["salidas"], "zonas": zonas_top, "tipos": tipos_top, "hoteles": hoteles_top})
    out = RESIDUOS / "resumen.json"
    with open(out, "w", encoding="utf-8") as fp:
        json.dump(resumen, fp, ensure_ascii=False, indent=0)
    print(f"Resumen: {len(resumen['pesajes'])} meses pesajes, {len(resumen['camion'])} meses camión -> data/RESIDUOS/resumen.json")
    # Nota: leer 104MB puede tardar; si falla, el dashboard usará los JSON completos


def copiar_geojson_zonas_mapa():
    """Copia la zonificación al repo como data/zonas_peniscola.geojson para el mapa por zonas."""
    dst = DATA / "zonas_peniscola.geojson"
    src = GEOJSON_ZONAS if GEOJSON_ZONAS.exists() else GEOJSON_ALT
    if not src.exists():
        return
    try:
        shutil.copy2(src, dst)
        print(f"GeoJSON zonas -> {dst} (mapa por polígonos)")
    except OSError as e:
        print(f"  No se pudo copiar GeoJSON zonas: {e}")


def main():
    print("Preparando datos Peñíscola Residuos...")
    DATA.mkdir(exist_ok=True)
    n_pesajes = procesar_pesajes()
    n_camion = procesar_camion()
    generar_resumen_residuos()
    copiar_geojson_zonas_mapa()
    print(f"Listo. Pesajes: {n_pesajes}, Camion: {n_camion}")


if __name__ == "__main__":
    main()
