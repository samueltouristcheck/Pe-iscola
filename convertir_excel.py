#!/usr/bin/env python3
"""
Convierte archivos Excel a JSON para el dashboard de Peñíscola Residuos.
Uso: python convertir_excel.py mi_archivo.xlsx
     python convertir_excel.py mi_archivo.xlsx -o datos.json
"""

import json
import sys
from pathlib import Path

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False


def convert_with_pandas(path: Path) -> list:
    """Convierte Excel a JSON usando pandas."""
    df = pd.read_excel(path)
    return df.to_dict(orient='records')


def convert_with_openpyxl(path: Path) -> list:
    """Convierte Excel a JSON usando openpyxl."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h) if h is not None else f"col_{i}" for i, h in enumerate(rows[0])]
    data = []
    for row in rows[1:]:
        data.append(dict(zip(headers, row)))
    return data


def main():
    if len(sys.argv) < 2:
        print("Uso: python convertir_excel.py <archivo.xlsx> [-o salida.json]")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"Error: No existe {input_path}")
        sys.exit(1)

    output_path = Path("data") / (input_path.stem + ".json")
    if "-o" in sys.argv:
        idx = sys.argv.index("-o")
        if idx + 1 < len(sys.argv):
            output_path = Path(sys.argv[idx + 1])

    try:
        if HAS_PANDAS:
            data = convert_with_pandas(input_path)
        elif HAS_OPENPYXL:
            data = convert_with_openpyxl(input_path)
        else:
            print("Instala pandas o openpyxl: pip install pandas openpyxl")
            sys.exit(1)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"Convertido: {len(data)} filas -> {output_path}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
