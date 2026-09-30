# -*- coding: utf-8 -*-
"""
Construye la base de datos propia de Peñíscola a partir de los exports
de Invattur Smart Tourism CV (Flux Vision) -> data/TURISMO/SIT_CV/sit_cv.json

Metodo de extraccion (manual, cuadro de mando SIT-CV):
  visual -> (...) Mas opciones -> Exportar datos -> Datos resumidos -> .xlsx
Los .xlsx se guardan en data/TURISMO/SIT_CV/exports/ y este script los
normaliza a un JSON compacto que consume el dashboard.

Se centra en lo que el INE NO da y si da Flux Vision:
  - tipologia de visitante por dia de la semana (excursionista / habitualmente
    presente / residente / turista)
  - serie diaria por origen (nacionales / extranjeros)
  - serie diaria por pais de origen (turismo receptor, extranjeros)
  - serie diaria por provincia de origen (turismo interno, nacionales)
"""
import json, os, glob
import openpyxl

BASE = os.path.dirname(os.path.abspath(__file__))
EXP = os.path.join(BASE, 'data', 'TURISMO', 'SIT_CV', 'exports')
OUT = os.path.join(BASE, 'data', 'TURISMO', 'SIT_CV', 'sit_cv.json')

MES = {'Ene':'01','Feb':'02','Mar':'03','Abr':'04','May':'05','Jun':'06',
       'Jul':'07','Ago':'08','Sep':'09','Oct':'10','Nov':'11','Dic':'12'}


def _rows(path):
    """Devuelve (cabecera, filas_datos). Fila 0 = filtros, 1 = vacia, 2 = cabecera."""
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = [r for r in ws.iter_rows(values_only=True)]
    # localizar la cabecera: primera fila con >=2 celdas de texto no nulas
    hidx = 0
    for i, r in enumerate(rows):
        no_nulas = [c for c in r if c not in (None, '')]
        if i > 0 and len(no_nulas) >= 2 and all(isinstance(c, str) for c in no_nulas):
            hidx = i
            break
    cab = [c for c in rows[hidx]]
    datos = [r for r in rows[hidx + 1:] if any(c not in (None, '') for c in r)]
    return cab, datos


def _find(patterns):
    for p in patterns:
        hits = glob.glob(os.path.join(EXP, p))
        if hits:
            return sorted(hits)[0]
    return None


def tipologia_semana():
    """weekday x tipo de visitante (fichero: dia de la semana)."""
    f = _find(['prevision_visitantes_dia_semana*.xlsx',
               '*dia de la semana*.xlsx', '*Cuantos visitantes*semana*.xlsx'])
    if not f:
        return None
    _, datos = _rows(f)
    por_dia = {}
    for dia, tipo, val in [(r[0], r[1], r[2]) for r in datos if len(r) >= 3]:
        if dia is None or tipo is None:
            continue
        por_dia.setdefault(str(dia), {})[str(tipo)] = round(float(val), 1) if val is not None else None
    return {'periodo': '2025', 'fuente_fichero': os.path.basename(f), 'por_dia': por_dia}


def _serie_mensual(path, key_col, val_idx=3):
    """Agrega (Mes, Dia, categoria, valor) -> {'YYYY-MM': {categoria: suma}} y
    tambien el total diario. Devuelve dict mensual por categoria."""
    _, datos = _rows(path)
    # detectar el anyo del filtro (2025 descriptivo, 2026 predictivo)
    wb = openpyxl.load_workbook(path, data_only=True)
    filtros = str(wb.active['A1'].value or '')
    anyo = '2026' if 'antes del 01/01/2027' in filtros or '2026' in filtros else '2025'
    mensual = {}
    for r in datos:
        if len(r) <= val_idx:
            continue
        mes_txt, cat, val = r[0], r[key_col], r[val_idx]
        if mes_txt not in MES or val is None:
            continue
        ym = anyo + '-' + MES[mes_txt]
        mensual.setdefault(ym, {})
        mensual[ym][str(cat)] = mensual[ym].get(str(cat), 0) + float(val)
    # redondear
    for ym in mensual:
        for c in mensual[ym]:
            mensual[ym][c] = round(mensual[ym][c])
    return anyo, mensual


def serie_origen():
    """serie diaria por origen (nac/ext) -> mensual. Fichero descriptivo 2025."""
    f = _find(['receptor_evolucion_diaria_descriptivo_origen.xlsx',
               '*periodo descriptivo seg*origen*.xlsx'])
    if not f:
        return None
    # aqui las columnas son (Mes, Dia, valor, origen) -> categoria en col 3, valor en col 2
    _, datos = _rows(f)
    wb = openpyxl.load_workbook(f, data_only=True)
    anyo = '2025'
    mensual = {}
    for r in datos:
        if len(r) < 4:
            continue
        mes_txt, dia, val, origen = r[0], r[1], r[2], r[3]
        if mes_txt not in MES or val is None or origen is None:
            continue
        ym = anyo + '-' + MES[mes_txt]
        mensual.setdefault(ym, {})
        k = str(origen)
        mensual[ym][k] = mensual[ym].get(k, 0) + float(val)
    for ym in mensual:
        for c in mensual[ym]:
            mensual[ym][c] = round(mensual[ym][c])
    return {'periodo': anyo, 'fuente_fichero': os.path.basename(f), 'mensual': mensual}


def serie_pais():
    f = _find(['receptor_evolucion_mensual_predictivo_pais.xlsx',
               '*predictivo seg*pa*s de origen*.xlsx'])
    if not f:
        return None
    anyo, mensual = _serie_mensual(f, key_col=2, val_idx=3)
    return {'periodo': anyo, 'fuente_fichero': os.path.basename(f), 'mensual': mensual}


def serie_provincia():
    f = _find(['interno_evolucion_diaria_predictivo_provincia.xlsx',
               '*predictivo seg*provincia*.xlsx'])
    if not f:
        return None
    anyo, mensual = _serie_mensual(f, key_col=2, val_idx=3)
    return {'periodo': anyo, 'fuente_fichero': os.path.basename(f), 'mensual': mensual}


def alquiler_vacacional():
    """Lee exports/alquiler_vacacional/*.xlsx (Lighthouse, Peñíscola) -> mensual multi-año.
    Cada fichero es un par de años (P.analizado vs P.comparativo). Combinamos varios pares
    (2025-vs-2024 y 2026-vs-2025) en una serie por mes con un valor por año:
        mensual[metrica][mes] = { '2024': v, '2025': v, '2026': v }
    Estructura de cada fichero: (Mes, P.analizado, P.comparativo, variacion) salvo
    ocupacion/oferta, que traen (Mes, variacion, P.analizado, P.comparativo)."""
    carpeta = os.path.join(EXP, 'alquiler_vacacional')
    if not os.path.isdir(carpeta):
        return None
    # metrica -> lista de (anio_P1, anio_P2, fichero)
    ficheros = {
        'turistas': [('2025', '2024', 'demanda_turistas_mensual_2025_vs_2024.xlsx'),
                     ('2026', '2025', 'demanda_turistas_mensual_2026_vs_2025.xlsx')],
        'adr': [('2025', '2024', 'rentabilidad_adr_mensual_2025_vs_2024.xlsx'),
                ('2026', '2025', 'rentabilidad_adr_mensual_2026_vs_2025.xlsx')],
        'ocupacion': [('2025', '2024', 'rentabilidad_ocupacion_mensual_2025_vs_2024.xlsx'),
                      ('2026', '2025', 'rentabilidad_ocupacion_mensual_2026_vs_2025.xlsx')],
        'revpar': [('2025', '2024', 'rentabilidad_revpar_mensual_2025_vs_2024.xlsx'),
                   ('2026', '2025', 'rentabilidad_revpar_mensual_2026_vs_2025.xlsx')],
        'revenue': [('2025', '2024', 'rentabilidad_revenue_mensual_2025_vs_2024.xlsx'),
                    ('2026', '2025', 'rentabilidad_revenue_mensual_2026_vs_2025.xlsx')],
        'oferta_apartamentos': [('2025', '2024', 'oferta_apartamentos_mensual_2025_vs_2024.xlsx')],
        'oferta_plazas': [('2025', '2024', 'oferta_plazas_mensual_2025_vs_2024.xlsx')],
    }
    # metricas cuya tabla es (Mes, variacion, P.analizado, P.comparativo)
    var_primero = {'ocupacion', 'oferta_apartamentos', 'oferta_plazas'}
    out = {}
    for metrica, pares in ficheros.items():
        serie = {}  # mes -> {anio: valor}
        for i, (ya, yb, fn) in enumerate(pares):
            ruta = os.path.join(carpeta, fn)
            if not os.path.exists(ruta):
                continue
            _, datos = _rows(ruta)
            for r in datos:
                if not r or r[0] not in MES:
                    continue
                ym = MES[r[0]]
                if metrica in var_primero:
                    p1, p2 = r[2], r[3]
                else:
                    p1, p2 = r[1], r[2]
                serie.setdefault(ym, {})
                if p1 is not None:
                    serie[ym][ya] = round(float(p1), 4)
                # El año comparativo (P2) solo es fiable en el PRIMER fichero de cada métrica
                # (2025-vs-2024). En los ficheros de 2026 el slicer comparativo no es fiable
                # (a veces 2024, a veces 2025), así que ignoramos su P2 para no pisar el 2025 bueno.
                if i == 0 and p2 is not None:
                    serie[ym][yb] = round(float(p2), 4)
        if serie:
            out[metrica] = serie
    if not out:
        return None
    return {
        'fuente': 'Lighthouse Intelligence (OTA: Airbnb/Booking/Vrbo) via Invattur',
        'destino': 'Peñíscola Municipio',
        'periodo': '2024-2026 (2026 parcial: on the books, año en curso)',
        'disponibilidad': 'ene-2019 / nov-2026',
        'anios': ['2024', '2025', '2026'],
        'kpi': {
            '2025': {'turistas': 102923, 'reservas': 29449, 'noches_reservadas': 128394,
                     'adr_eur': 159.5, 'revpar_eur': 68.3, 'revenue_eur': 20483788.4,
                     'ocupacion_pct': 39.5, 'estancia_media_noches': 6.8, 'antelacion_dias': 56.4,
                     'parcial': False},
            '2026': {'turistas': 62861, 'reservas': 17551,
                     'adr_eur': 176.4, 'revpar_eur': 71.5, 'revenue_eur': 11533577.1,
                     'ocupacion_pct': 37.4, 'estancia_media_noches': 5.1, 'antelacion_dias': 49.0,
                     'parcial': True},
        },
        # compat: se mantiene kpi_2025 para no romper nada que lo use
        'kpi_2025': {'turistas': 102923, 'reservas': 29449, 'noches_reservadas': 128394,
                     'adr_eur': 159.5, 'revpar_eur': 68.3, 'revenue_eur': 20483788.4,
                     'ocupacion_pct': 39.5, 'estancia_media_noches': 6.8, 'antelacion_dias': 56.4},
        'mensual': out,
    }


def origen_pct():
    """Reutiliza el % pasado/futuro ya extraido a mano si existe."""
    p = os.path.join(BASE, 'data', 'TURISMO', 'sit_prevision_manual.json')
    if os.path.exists(p):
        with open(p, encoding='utf-8') as fh:
            return json.load(fh).get('origen')
    return None


def main():
    db = {
        'fuente': 'Invattur Smart Tourism CV - Prevision de visitantes (Flux Vision)',
        'destino': 'Peniscola Municipio',
        'actualizado': '2026-09-29',
        'disponibilidad': {
            'descriptivo': '2024-01-01/2026-05-31',
            'predictivo': '2025-01-01/2026-12-31'
        },
        'nota': ('Datos que el INE no ofrece: tipologia de visitante, origen '
                 'nacional/extranjero, pais y provincia de origen, y prevision. '
                 'Extraido del cuadro de mando SIT-CV (exportar datos resumidos).'),
        'origen_pct': origen_pct(),
        'tipologia_semana': tipologia_semana(),
        'serie_origen': serie_origen(),
        'serie_pais_predictivo': serie_pais(),
        'serie_provincia_predictivo': serie_provincia(),
        'alquiler_vacacional': alquiler_vacacional(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(db, fh, ensure_ascii=False, indent=2)
    # resumen
    print('OK ->', OUT)
    for k in ('tipologia_semana', 'serie_origen', 'serie_pais_predictivo', 'serie_provincia_predictivo'):
        v = db[k]
        if not v:
            print('  ', k, ': (sin datos)')
        elif 'por_dia' in v:
            print('  ', k, ':', len(v['por_dia']), 'dias')
        else:
            print('  ', k, ':', len(v.get('mensual', {})), 'meses')


if __name__ == '__main__':
    main()
