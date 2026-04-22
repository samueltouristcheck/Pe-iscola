#!/usr/bin/env python3
"""
Reorganiza las carpetas PESAJES y JSON por año/mes.
Ejecutar: python organizar_carpetas.py
"""

import shutil
from pathlib import Path

BASE = Path(__file__).parent
PESAJES = BASE / "PESAJES"
JSON = BASE / "JSON"
EXCELS_OLD = PESAJES / "Excels-2018_a_2021"


def organizar_pesajes():
    """Mueve Excels-2018_a_2021 a PESAJES/2018, 2019, 2020, 2021."""
    if not EXCELS_OLD.exists():
        print("No existe Excels-2018_a_2021, omitiendo.")
        return

    for year in ["2018", "2019", "2020", "2021"]:
        src = EXCELS_OLD / year
        dst = PESAJES / year
        if not src.exists():
            continue
        dst.mkdir(parents=True, exist_ok=True)
        for f in src.iterdir():
            if f.is_file():
                target = dst / f.name
                if not target.exists() or f.stat().st_mtime > target.stat().st_mtime:
                    shutil.copy2(f, target)
                    print(f"  Copiado: {year}/{f.name}")
    print("PESAJES organizado por año.")


def organizar_json():
    """Organiza JSON por año: JSON/2022/, JSON/2023/, etc."""
    if not JSON.exists():
        print("No existe carpeta JSON.")
        return

    mapeo = {
        "Residus 2022.json": "2022",
        "Residus 2023.json": "2023",
        "Residus 2024.json": "2024",
        "Residus 2025.json": "2025",
        "Residus 2026.json": "2026",
    }

    # Subcarpeta JSONS 2022 Y 2023
    sub = JSON / "JSONS 2022 Y 2023"
    if sub.exists():
        for f in sub.glob("Residus *.json"):
            year = f.stem.replace("Residus ", "").strip()
            if year.isdigit():
                dst_dir = JSON / year
                dst_dir.mkdir(exist_ok=True)
                target = dst_dir / f.name
                if not target.exists() or f.stat().st_mtime > target.stat().st_mtime:
                    shutil.copy2(f, target)
                    print(f"  Copiado: {year}/{f.name}")

    # Raíz
    for nombre, year in mapeo.items():
        src = JSON / nombre
        if src.exists():
            dst_dir = JSON / year
            dst_dir.mkdir(exist_ok=True)
            target = dst_dir / nombre
            if not target.exists() or src.stat().st_mtime > target.stat().st_mtime:
                shutil.copy2(src, target)
                print(f"  Copiado: {year}/{nombre}")

    print("JSON organizado por año.")


def main():
    print("Organizando carpetas...")
    organizar_pesajes()
    organizar_json()
    print("Listo.")


if __name__ == "__main__":
    main()
