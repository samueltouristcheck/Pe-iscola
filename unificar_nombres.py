#!/usr/bin/env python3
"""
Unifica los nombres de archivos en PESAJES y JSON.
Formato PESAJES: 01 - Pesajes enero YY.xlsx (mes en minúscula, año 2 dígitos)
Formato JSON: Residus_YYYY.json

Ejecutar: python unificar_nombres.py
"""

import re
from pathlib import Path

BASE = Path(__file__).parent
PESAJES = BASE / "PESAJES"
JSON = BASE / "JSON"

MESES_NOMBRES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MESES = {m: i + 1 for i, m in enumerate(MESES_NOMBRES)}
MESES["diceimbre"] = 12  # typo


def extraer_mes_ano(nombre: str, year_dir: str) -> tuple:
    """Devuelve (mes_num, ano_2dig) o None."""
    nombre_lower = nombre.lower()
    year_int = int(year_dir)
    ano_2 = str(year_int)[-2:]

    for mes_nom, num in MESES.items():
        if mes_nom in nombre_lower:
            return (num, ano_2)
    return None


def unificar_pesajes():
    """Renombra archivos en PESAJES a: 01 - Pesajes enero YY.xlsx"""
    count = 0
    for year_dir in sorted(PESAJES.iterdir()):
        if not year_dir.is_dir() or not year_dir.name.isdigit():
            continue
        for f in list(year_dir.iterdir()):
            if not f.is_file() or f.suffix.lower() not in (".xlsx", ".xls"):
                continue
            info = extraer_mes_ano(f.stem, year_dir.name)
            if not info:
                continue
            mes_num, ano_2 = info
            nuevo = f"{mes_num:02d} - Pesajes {MESES_NOMBRES[mes_num-1]} {ano_2}{f.suffix.lower()}"
            nuevo_path = year_dir / nuevo
            if f.name != nuevo:
                try:
                    f.rename(nuevo_path)
                    print(f"  {year_dir.name}/{f.name} -> {nuevo}")
                    count += 1
                except Exception as e:
                    print(f"  Error: {f} -> {e}")
    return count


def unificar_json():
    """Renombra Residus YYYY.json a Residus_YYYY.json en cada carpeta año."""
    count = 0
    for year_dir in sorted(JSON.iterdir()):
        if not year_dir.is_dir() or not year_dir.name.isdigit():
            continue
        for f in list(year_dir.iterdir()):
            if not f.is_file() or f.suffix.lower() != ".json":
                continue
            m = re.match(r"Residus\s*(\d{4})\.json", f.name, re.I)
            if m:
                nuevo = f"Residus_{m.group(1)}.json"
                if f.name != nuevo:
                    try:
                        f.rename(year_dir / nuevo)
                        print(f"  {year_dir.name}/{f.name} -> {nuevo}")
                        count += 1
                    except Exception as e:
                        print(f"  Error: {f} -> {e}")
    # Raíz JSON
    for f in list(JSON.iterdir()):
        if not f.is_file() or f.suffix.lower() != ".json":
            continue
        m = re.match(r"Residus\s*(\d{4})\.json", f.name, re.I)
        if m and "Con_Zona" not in f.name:
            year = m.group(1)
            dst_dir = JSON / year
            dst_dir.mkdir(exist_ok=True)
            nuevo = f"Residus_{year}.json"
            dst = dst_dir / nuevo
            if not dst.exists() or f.stat().st_mtime > dst.stat().st_mtime:
                try:
                    import shutil
                    shutil.copy2(f, dst)
                    print(f"  {f.name} -> {year}/{nuevo}")
                    count += 1
                except Exception as e:
                    print(f"  Error: {e}")
    return count


def main():
    print("Unificando nombres...")
    n1 = unificar_pesajes()
    n2 = unificar_json()
    print(f"Listo. Pesajes: {n1}, JSON: {n2}")


if __name__ == "__main__":
    main()
