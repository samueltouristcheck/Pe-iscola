#!/usr/bin/env python3
"""
Prepara los datos de Peñíscola Residuos para el dashboard.
- Reorganiza carpetas por año/mes
- Convierte pesajes Excel a JSON
- Unifica datos del camión

Ejecutar: python preparar_datos.py
"""

import json
import os
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


def resolver_geojson_zonas_fuente():
    """
    Busca el GeoJSON de zonificación en data/ (o PENISCOLA_GEOJSON_ZONAS).
    El dashboard lee siempre data/zonas_peniscola.geojson; copiar_geojson_zonas_mapa() lo genera.
    """
    candidatos = (
        DATA / "zonas_peniscola.geojson",
        DATA / "zonificacion_peniscola.geojson",
        DATA / "Zonificación Peñíscola (1).geojson",
    )
    for p in candidatos:
        if p.exists():
            return p
    env = (os.environ.get("PENISCOLA_GEOJSON_ZONAS") or "").strip()
    if env:
        ep = Path(env)
        if ep.exists():
            return ep
    return None


def _iter_anillos_exteriores(geom: dict):
    """Un anillo exterior por polígono (Polygon o MultiPolygon)."""
    t = (geom or {}).get("type")
    coords = (geom or {}).get("coordinates") or []
    if t == "Polygon" and coords:
        yield coords[0]
    elif t == "MultiPolygon":
        for poly in coords:
            if poly and len(poly) > 0:
                yield poly[0]


def _nombre_desde_properties(props: dict) -> str:
    if not props:
        return "Sin nombre"
    for key in ("name", "Name", "nombre", "Nombre", "zona", "ZONA", "label", "title"):
        v = props.get(key)
        if v is not None and str(v).strip():
            return str(v).strip()
    return "Sin nombre"


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
    path = resolver_geojson_zonas_fuente()
    if not path or not path.exists():
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []
    polygons = []
    for feat in data.get("features", []):
        geom = feat.get("geometry") or {}
        name = _nombre_desde_properties(feat.get("properties") or {})
        for ring in _iter_anillos_exteriores(geom):
            if ring and len(ring) >= 3:
                polygons.append((ring, name))
    return polygons


def asignar_zona(lon: float, lat: float, polygons: list) -> str:
    """Devuelve el nombre de la zona que contiene (lon, lat)."""
    for ring, name in polygons:
        if _point_in_polygon(lon, lat, ring):
            return name
    return ""


def normalizar_fecha_pesajes(row, fecha_col=None):
    """Convierte la celda de fecha a YYYY-MM. fecha_col = nombre real de columna en el Excel."""
    if not fecha_col:
        return None
    f = row.get(fecha_col)
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
    if isinstance(f, (int, float)) and not isinstance(f, bool):
        try:
            ts = pd.to_datetime(f, unit="d", origin="1899-12-30", errors="coerce")
            if pd.isna(ts):
                ts = pd.to_datetime(f, errors="coerce")
            if pd.isna(ts):
                return None
            out = ts.strftime("%Y-%m")
            if int(out[:4]) > datetime.now().year:
                return None
            return out
        except (ValueError, TypeError, OSError):
            pass
    s = str(f).strip()
    m = re.search(r"(\d{4})[-/](\d{1,2})", s)
    if not m:
        m2 = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
        if m2:
            y = int(m2.group(3))
            mo = int(m2.group(2))
            d = int(m2.group(1))
            if d > 12:
                mo, d = d, mo
            if y > datetime.now().year:
                return None
            return f"{y}-{mo:02d}"
        return None
    y = int(m.group(1))
    if y > datetime.now().year:
        return None
    return f"{m.group(1)}-{int(m.group(2)):02d}"


MESES_ES = (
    "",
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)
DIAS_ES = (
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
)


def _col_por_clave(cols_lower, candidatos):
    for cand in candidatos:
        k = cand.lower().strip()
        if k in cols_lower:
            return cols_lower[k]
    return None


def _celda_a_timestamp(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        ts = pd.to_datetime(val, unit="d", origin="1899-12-30", errors="coerce")
        if pd.isna(ts):
            ts = pd.to_datetime(val, errors="coerce")
        if pd.isna(ts):
            return None
        return ts
    ts = pd.to_datetime(val, errors="coerce")
    if pd.isna(ts):
        return None
    return ts


def _hora_desde_celda(val) -> str:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    ts = pd.to_datetime(val, errors="coerce")
    if not pd.isna(ts):
        try:
            if ts.hour or ts.minute or ts.second:
                return ts.strftime("%H:%M:%S")
        except (ValueError, OSError):
            pass
    if hasattr(val, "total_seconds"):
        try:
            sec = int(val.total_seconds()) % 86400
            h, r = divmod(sec, 3600)
            m, s = divmod(r, 60)
            return f"{h:02d}:{m:02d}:{s:02d}"
        except (TypeError, ValueError):
            pass
    if hasattr(val, "hour"):
        try:
            return f"{int(val.hour):02d}:{int(val.minute):02d}:{int(val.second):02d}"
        except (TypeError, ValueError):
            pass
    s = str(val).strip()
    if re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", s):
        return s if len(s.split(":")) == 3 else s + ":00"
    return ""


def _fecha_larga_es(ts) -> str:
    if ts is None:
        return ""
    try:
        wd = DIAS_ES[int(ts.weekday())]
        return f"{wd}, {int(ts.day)} de {MESES_ES[int(ts.month)]} de {int(ts.year)}"
    except (ValueError, TypeError, IndexError):
        return ""


def _float_celda(val, default=None):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _ticket_celda(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        f = float(val)
        if f == int(f):
            return int(f)
        return f
    except (TypeError, ValueError):
        s = str(val).strip()
        return s if s else None


def convertir_pesajes_excel(excel_path: Path) -> list:
    """Convierte Excel de pesajes a registros (columnas tipo Power BI / TO-Pesajes_Excel_Unificados)."""
    try:
        df = pd.read_excel(excel_path, sheet_name=0)
    except Exception as e:
        print(f"  Error leyendo {excel_path.name}: {e}")
        return []

    cols_lower = {str(c).lower().strip(): c for c in df.columns}

    fecha_col = _col_por_clave(
        cols_lower,
        (
            "fecha",
            "date",
            "fecha registro",
            "fecha/hora",
            "fecha hora",
            "day",
            "fecha / hora",
        ),
    )
    hora_col = _col_por_clave(
        cols_lower,
        ("fecha / hora", "fecha/hora", "hora", "hora entrada", "hora salida"),
    )
    # Si la única columna temporal es mixta, no usar también una segunda columna duplicada
    if hora_col == fecha_col:
        hora_col = None

    carga_col = _col_por_clave(cols_lower, ("carga", "peso neto", "neto", "peso_neto"))

    peso_total_col = _col_por_clave(cols_lower, ("peso total", "peso_total", "bruto", "peso bruto"))
    tara_col = _col_por_clave(cols_lower, ("tara", "tare"))

    residuo_col = _col_por_clave(cols_lower, ("residuo", "garbage", "tipo", "tipo residuo"))
    poblacion_col = _col_por_clave(
        cols_lower,
        ("población", "poblacion", "area", "zona", "origen", "municipio"),
    )

    anio_col = _col_por_clave(cols_lower, ("año", "ano", "year", "anyo"))
    mes_num_col = _col_por_clave(cols_lower, ("mes_num", "mes num", "número mes", "mes_n", "n_mes"))
    mes_txt_col = _col_por_clave(cols_lower, ("mes nombre", "nombre mes", "mes_txt"))
    if not mes_txt_col and "mes" in cols_lower:
        mc = cols_lower["mes"]
        if mc != mes_num_col:
            mes_txt_col = mc

    ticket_col = _col_por_clave(
        cols_lower, ("ticket", "nº ticket", "nº", "id ticket", "num ticket", "num. ticket")
    )
    matricula_col = _col_por_clave(cols_lower, ("matrícula", "matricula", "matricula vehiculo", "vehículo"))

    if not fecha_col:
        fecha_col = df.columns[0] if len(df.columns) > 0 else None

    if carga_col is None and peso_total_col and tara_col:
        carga_col = "__carga_calc__"
    elif carga_col is None:
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
        if carga_col == "__carga_calc__":
            pt = _float_celda(row.get(peso_total_col))
            ta = _float_celda(row.get(tara_col))
            if pt is None or ta is None:
                continue
            carga = pt - ta
        else:
            carga = _float_celda(row.get(carga_col))
        if carga is None or carga <= 0:
            continue

        ts = _celda_a_timestamp(row.get(fecha_col)) if fecha_col else None
        hora_extra = _hora_desde_celda(row.get(hora_col)) if hora_col else ""
        if ts is not None and hora_col:
            hv = row.get(hora_col)
            if not pd.isna(hv) and hora_extra:
                tpart = pd.to_datetime(hv, errors="coerce")
                if not pd.isna(tpart):
                    try:
                        ts = ts.replace(
                            hour=int(tpart.hour),
                            minute=int(tpart.minute),
                            second=int(tpart.second),
                        )
                    except (ValueError, TypeError):
                        pass

        periodo = normalizar_fecha_pesajes(row, fecha_col) if fecha_col else None
        if ts is not None and not periodo:
            try:
                periodo = ts.strftime("%Y-%m")
            except (ValueError, OSError):
                periodo = None

        anio = None
        if anio_col:
            anio = _float_celda(row.get(anio_col))
            if anio is not None:
                anio = int(anio)
        if anio is None and ts is not None:
            anio = int(ts.year)

        mes_num = None
        if mes_num_col:
            mes_num = _float_celda(row.get(mes_num_col))
            if mes_num is not None:
                mes_num = int(mes_num)
        if mes_num is None and ts is not None:
            mes_num = int(ts.month)

        mes_display = ""
        if mes_txt_col:
            raw_m = row.get(mes_txt_col)
            if not pd.isna(raw_m) and str(raw_m).strip():
                sm = str(raw_m).strip()
                if sm.isdigit():
                    try:
                        mi = int(sm)
                        if 1 <= mi <= 12:
                            mes_display = MESES_ES[mi].title()
                    except ValueError:
                        mes_display = sm.title()
                else:
                    mes_display = sm.title()
        if not mes_display and ts is not None:
            mes_display = MESES_ES[int(ts.month)].title()

        fecha_larga = _fecha_larga_es(ts) if ts is not None else ""
        if not fecha_larga and periodo and len(str(periodo)) >= 7 and str(periodo) != "Sin fecha":
            try:
                y = int(str(periodo)[:4])
                m = int(str(periodo)[5:7])
                ts0 = datetime(y, m, 1)
                fecha_larga = _fecha_larga_es(pd.Timestamp(ts0))
            except (ValueError, TypeError, IndexError):
                pass
        hora_out = ""
        if ts is not None:
            try:
                if ts.hour or ts.minute or ts.second:
                    hora_out = ts.strftime("%H:%M:%S")
            except (ValueError, OSError):
                pass
        if not hora_out and hora_extra:
            hora_out = hora_extra

        pt_val = _float_celda(row.get(peso_total_col)) if peso_total_col else None
        ta_val = _float_celda(row.get(tara_col)) if tara_col else None

        poblacion = str(row.get(poblacion_col, "")).strip() if poblacion_col else ""
        residuo = str(row.get(residuo_col, "")).strip() if residuo_col else "RSU"

        try:
            rel = str(excel_path.relative_to(PESAJES_ROOT))
        except ValueError:
            rel = excel_path.name

        records.append(
            {
                "Año": anio,
                "Mes_num": mes_num,
                "Mes": mes_display,
                "Archivo": excel_path.name,
                "Fecha": fecha_larga,
                "Fecha / hora": hora_out,
                "Ticket": _ticket_celda(row.get(ticket_col)) if ticket_col else None,
                "Matrícula": str(row.get(matricula_col, "")).strip() if matricula_col else "",
                "Peso total": round(pt_val, 2) if pt_val is not None else None,
                "Tara": round(ta_val, 2) if ta_val is not None else None,
                "Carga": round(carga, 2),
                "Población": poblacion,
                "Residuo": residuo or "RSU",
                "fecha": periodo or "Sin fecha",
                "fuente": "pesajes",
                "ruta_fuente": rel.replace("\\", "/"),
                "zona": poblacion,
                "tipo": residuo or "RSU",
                "kg": round(carga, 2),
            }
        )
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

    resource = str(item.get("Resource", "") or "").strip()
    matricula = str(item.get("ResourceRegistration", "") or "").strip()
    if not matricula and resource:
        m = re.search(r"-(\d+[A-Z0-9]+)(?:\s|$)", resource)
        if m:
            matricula = m.group(1)
        elif not matricula:
            matricula = resource
    garbage = str(item.get("Garbage", "") or "Mezcla de residuos municipales").strip()
    container_type = str(item.get("ContainerType", "") or "").strip()

    return {
        "fecha": fecha,
        "fuente": "camion",
        "zona": zona,
        "tipo": garbage,
        "garbage": garbage,
        "kg": round(peso, 2),
        "weight": round(peso, 2),
        "matricula": matricula,
        "containerType": container_type,
        "establecimiento": establecimiento,
        "lat": lat_v,
        "lng": lng_v,
    }


MESES_PESAJES_NOMBRE = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}


def infer_pesajes_excel_meta(rel_posix, base_name):
    """Misma heurística que server.js para año/mes desde ruta y nombre de archivo."""
    year = None
    month = None
    rel_norm = str(rel_posix).replace("\\", "/")
    for seg in rel_norm.split("/"):
        if re.fullmatch(r"\d{4}", seg):
            y = int(seg)
            if 1990 <= y <= 2100:
                year = y
    stem = re.sub(r"\.(xlsx|xls)$", "", base_name, flags=re.I)
    low = stem.lower()
    for nom, num in MESES_PESAJES_NOMBRE.items():
        if nom in low:
            month = num
            break
    m_lead = re.match(r"^(\d{1,2})\s*-\s*", stem)
    if m_lead:
        mm = int(m_lead.group(1))
        if 1 <= mm <= 12:
            month = mm
    m4 = re.search(r"\b(20\d{2}|19\d{2})\b", stem)
    if m4:
        year = int(m4.group(1))
    else:
        m2 = re.search(r"(\d{2})(?:\s*\([^)]*\))?\s*$", stem)
        if m2:
            n = int(m2.group(1))
            year = 2000 + n if n <= 30 else 1900 + n
    year_month = None
    if year is not None and month is not None:
        year_month = f"{year}-{month:02d}"
    return {"year": year, "month": month, "yearMonth": year_month}


def generar_excels_manifest_pesajes():
    """
    Lista .xlsx/.xls bajo pesajes/ para el dashboard sin depender de la API Node.
    Escribe data/RESIDUOS/pesajes/excels_manifest.json
    """
    PESAJES_ROOT.mkdir(parents=True, exist_ok=True)
    found = []
    for pattern in ("*.xlsx", "*.xls"):
        for f in sorted(PESAJES_ROOT.rglob(pattern)):
            if not f.is_file():
                continue
            if f.name.startswith("~$"):
                continue
            if f.name.lower() == "todos.json":
                continue
            try:
                rel = str(f.relative_to(PESAJES_ROOT)).replace("\\", "/")
            except ValueError:
                rel = f.name
            meta = infer_pesajes_excel_meta(rel, f.name)
            found.append(
                {
                    "rel": rel,
                    "name": f.name,
                    "year": meta["year"],
                    "month": meta["month"],
                    "yearMonth": meta["yearMonth"],
                }
            )

    def sort_key(item):
        ym = item.get("yearMonth") or ""
        return (ym, item.get("rel") or "")

    found.sort(key=sort_key)
    out = PESAJES_ROOT / "excels_manifest.json"
    with open(out, "w", encoding="utf-8") as fp:
        json.dump({"files": found}, fp, ensure_ascii=False, indent=2)
    print(f"Pesajes: manifest Excels ({len(found)}) -> {out.relative_to(BASE)}")
    return len(found)


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
            if f.name.lower() == "todos.json":
                continue
            try:
                recs = convertir_pesajes_excel(f)
                if recs:
                    todo.extend(recs)
            except Exception as e:
                print(f"  Error {f.relative_to(PESAJES_ROOT)}: {e}")

    out_file = out / "todos.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as fp:
        json.dump(todo, fp, ensure_ascii=False, indent=2)
    if todo:
        print(f"Pesajes: {len(todo)} registros -> {out_file.relative_to(BASE)}")
    else:
        print(
            f"Pesajes: 0 registros (escrito {out_file.relative_to(BASE)} vacío). "
            f"Añade .xlsx/.xls bajo {PESAJES_ROOT.relative_to(BASE)} (subcarpetas permitidas)."
        )
    generar_excels_manifest_pesajes()
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
            if not isinstance(item, dict):
                continue
            # Incluir también filas sin Weight en API (Power BI sí las cuenta); peso 0 en convertir.
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
        print(f"Mapa: {len(mapa)} contenedores con coordenadas -> data/RESIDUOS/camion/mapa.json")
        with open(out / "mapa_sample.json", "w", encoding="utf-8") as fp:
            json.dump(mapa, fp, ensure_ascii=False, indent=0)
        print(f"Mapa UI: {len(mapa)} contenedores (copia completa, como mapa.json) -> mapa_sample.json")
        if len(mapa) < 20000:
            print(
                "  Aviso: pocos puntos GPS en mapa respecto a lo habitual en Power BI. "
                "Coloca los JSON completos del camión en data/RESIDUOS/camion/JSON/ "
                "(p. ej. Residus_YYYY.json) y vuelve a ejecutar este script para regenerar mapa.json."
            )
    return len(todo)


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
    # Agregar por mes (pesajes: total kg + desglose por tipo de residuo / Excel)
    resumen = {"pesajes": [], "camion": []}
    by_p = {}
    by_p_tipos = {}
    for r in pesajes if isinstance(pesajes, list) else []:
        f = r.get("fecha") or ""
        if len(f) >= 7 and _anio_fecha_razonable(f):
            w = float(r.get("kg") or 0)
            by_p[f] = by_p.get(f, 0) + w
            t = str(r.get("tipo") or "").strip() or "Sin clasificar"
            if f not in by_p_tipos:
                by_p_tipos[f] = {}
            by_p_tipos[f][t] = by_p_tipos[f].get(t, 0) + w
    resumen["pesajes"] = []
    for k, v in sorted(by_p.items()):
        tipos_p = dict(sorted(by_p_tipos.get(k, {}).items(), key=lambda x: -x[1]))
        resumen["pesajes"].append({"fecha": k, "kg": round(v, 2), "tipos": tipos_p})
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
    src = resolver_geojson_zonas_fuente()
    if not src:
        print(
            "  GeoJSON de zonas: no encontrado. Coloca un .geojson en data/, o el Excel «Areas Zona.xlsx» "
            "en la raíz del proyecto y ejecuta: node scripts/areas_zona_a_geojson.js"
        )
        return
    try:
        if src.resolve() == dst.resolve():
            print(f"GeoJSON zonas: {dst} (ya es la ruta del mapa web)")
            return
        shutil.copy2(src, dst)
        print(f"GeoJSON zonas -> {dst} (mapa por polígonos)")
    except OSError as e:
        print(f"  No se pudo copiar GeoJSON zonas: {e}")


def generar_geojson_desde_areas_zona_xlsx():
    """ Si existe Areas Zona.xlsx, genera data/zonas_peniscola.geojson (requiere Node + xlsx). """
    js = BASE / "scripts" / "areas_zona_a_geojson.js"
    xlsx = BASE / "Areas Zona.xlsx"
    if not xlsx.exists() or not js.exists():
        return
    import subprocess

    try:
        r = subprocess.run(
            ["node", str(js)],
            cwd=str(BASE),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if r.stdout:
            print(r.stdout.rstrip())
        if r.returncode != 0 and r.stderr:
            print(r.stderr.rstrip())
    except FileNotFoundError:
        print("  areas_zona_a_geojson: no se encontró «node»; instala Node.js o ejecuta el .js a mano.")
    except Exception as e:
        print(f"  areas_zona_a_geojson: {e}")


def main():
    print("Preparando datos Peñíscola Residuos...")
    DATA.mkdir(exist_ok=True)
    generar_geojson_desde_areas_zona_xlsx()
    n_pesajes = procesar_pesajes()
    n_camion = procesar_camion()
    generar_resumen_residuos()
    copiar_geojson_zonas_mapa()
    print(f"Listo. Pesajes: {n_pesajes}, Camion: {n_camion}")


if __name__ == "__main__":
    main()
