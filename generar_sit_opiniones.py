# -*- coding: utf-8 -*-
"""Llama a /api/sit-opinion de produccion y guarda la opinion profesional
por mes dentro de data/camaras/sit_camaras.json."""
import json, os, sys, time, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
PROD = os.environ.get('SIT_API', 'https://pe-iscola.onrender.com')
PATH = os.path.join(BASE, 'data', 'camaras', 'sit_camaras.json')

def post(url, payload, timeout=90):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def main():
    doc = json.load(open(PATH, encoding='utf-8'))
    solo = sys.argv[1:] or doc['meses']
    for mes in solo:
        d = doc['datos'].get(mes)
        if not d:
            continue
        if d.get('opinion') and '--force' not in sys.argv:
            print('  (ya tiene opinion)', mes); continue
        try:
            res = post(PROD + '/api/sit-opinion', {'periodoLabel': d['periodoLabel'], 'datos': d})
            if res.get('error'):
                print('  ERROR', mes, res['error']); continue
            d['opinion'] = res.get('texto', '')
            print('  OK', mes, '->', len(d['opinion'].split()), 'palabras')
        except Exception as e:
            print('  FALLO', mes, str(e)[:120])
        time.sleep(1.5)
    open(PATH, 'w', encoding='utf-8').write(json.dumps(doc, ensure_ascii=False))
    print('Guardado', PATH)

if __name__ == '__main__':
    main()
