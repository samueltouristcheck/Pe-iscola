# -*- coding: utf-8 -*-
"""Genera los 4 gráficos del informe de Enero 2026 como PNG."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import os

OUT = r"C:\Users\samue\OneDrive\Escritorio\Peñiscola_Cursor\informes_generados\graficos"
os.makedirs(OUT, exist_ok=True)

AZUL     = '#1B3A6B'
AZUL2    = '#2E5FA3'
AZUL3    = '#4A7FCB'
VERDE    = '#2D6A4F'
GRIS     = '#8DA4BF'
BG       = '#F8FAFC'
FONT     = 'DejaVu Sans'

plt.rcParams.update({
    'font.family': FONT,
    'axes.facecolor': BG,
    'figure.facecolor': 'white',
    'axes.spines.top': False,
    'axes.spines.right': False,
    'axes.spines.left': False,
    'axes.grid': True,
    'grid.color': '#E2E8F0',
    'grid.linewidth': 0.8,
    'axes.edgecolor': '#CBD5E1',
})

# ── 1. TOP HOTELES / CAMPINGS ─────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(9, 4.5))
hoteles = [
    ('ATALAYAS',              9790),
    ('Camping Edén',          5610),
    ('SUBURBANO',             5270),
    ('URMI',                  4035),
    ('H. Peñíscola Suites',   3860),
    ('Camping Vizmar',        3190),
    ('Camping La Volta',      2885),
    ('CAMPING EL CID',        1910),
]
hoteles.sort(key=lambda x: x[1])
nombres = [h[0] for h in hoteles]
kgs     = [h[1] for h in hoteles]
colors  = [AZUL if 'Camping' not in n and 'CAMPING' not in n else AZUL3 for n in nombres]

bars = ax.barh(nombres, kgs, color=colors, edgecolor='white', linewidth=0.5, height=0.6)
for bar, val in zip(bars, kgs):
    ax.text(val + 80, bar.get_y() + bar.get_height()/2,
            f'{val:,.0f} kg'.replace(',', '.'),
            va='center', fontsize=8.5, color='#334155', fontweight='bold')

ax.set_xlabel('Kg recogidos', fontsize=9, color='#64748B')
ax.set_title('Top establecimientos — Enero 2026', fontsize=12, fontweight='bold', color=AZUL, pad=14)
ax.tick_params(axis='y', labelsize=9)
ax.tick_params(axis='x', labelsize=8)
ax.set_xlim(0, max(kgs) * 1.28)
patch_hotel  = mpatches.Patch(color=AZUL,  label='Hoteles/Urb.')
patch_camping = mpatches.Patch(color=AZUL3, label='Campings')
ax.legend(handles=[patch_hotel, patch_camping], fontsize=8, loc='lower right')
ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{int(x):,}'.replace(',', '.')))
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'g1_hoteles.png'), dpi=150, bbox_inches='tight')
plt.close()
print('✅ g1_hoteles.png')

# ── 2. CONTENEDORES ───────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(9, 4.5))
conts = [
    ('RSU 1.100 TRASERA',      39372),
    ('RSU 800 HOTELES',        15085),
    ('ORGÁNICA 800L HOTELES',  11781),
    ('ORGÁNICA 1.100 TRASERA',  5394),
    ('ENVASES 800L HOTELES',    2015),
    ('RSU 3.200 LATERAL',       1360),
]
conts.sort(key=lambda x: x[1])
cn  = [c[0] for c in conts]
ckg = [c[1] for c in conts]
col_cont = [AZUL if 'ORGÁNICA' not in n else VERDE for n in cn]

bars = ax.barh(cn, ckg, color=col_cont, edgecolor='white', linewidth=0.5, height=0.6)
for bar, val in zip(bars, ckg):
    ax.text(val + 50, bar.get_y() + bar.get_height()/2,
            f'{val:,.0f} kg'.replace(',', '.'),
            va='center', fontsize=8.5, color='#334155', fontweight='bold')

ax.set_xlabel('Kg recogidos', fontsize=9, color='#64748B')
ax.set_title('Residuos por tipo de contenedor — Enero 2026', fontsize=12, fontweight='bold', color=AZUL, pad=14)
ax.tick_params(labelsize=9)
ax.set_xlim(0, max(ckg) * 1.3)
ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{int(x):,}'.replace(',', '.')))
patch_rsu = mpatches.Patch(color=AZUL,  label='RSU / Resto')
patch_org = mpatches.Patch(color=VERDE, label='Orgánica')
ax.legend(handles=[patch_rsu, patch_org], fontsize=8, loc='lower right')
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'g2_contenedores.png'), dpi=150, bbox_inches='tight')
plt.close()
print('✅ g2_contenedores.png')

# ── 3. TIPOS DE RESIDUO (donut) ───────────────────────────────────────────
fig, ax = plt.subplots(figsize=(7, 5))
tipos  = ['RSU (mezcla)', 'Orgánica', 'Envases', 'Papel/Cartón']
kgtip  = [61196, 22236, 3585, 1170]
total  = sum(kgtip)
pcts   = [k/total*100 for k in kgtip]
cols   = [AZUL, VERDE, AZUL2, AZUL3]
explode = (0.03, 0.03, 0.03, 0.03)

wedges, texts, autotexts = ax.pie(
    kgtip, labels=None, colors=cols, autopct='%1.1f%%',
    startangle=90, pctdistance=0.75, explode=explode,
    wedgeprops={'edgecolor': 'white', 'linewidth': 2}
)
for at in autotexts:
    at.set_fontsize(9)
    at.set_color('white')
    at.set_fontweight('bold')

# Círculo central (donut)
centre_circle = plt.Circle((0, 0), 0.55, fc='white')
ax.add_artist(centre_circle)
ax.text(0, 0.08, f'{total:,.0f}'.replace(',', '.'), ha='center', va='center',
        fontsize=13, fontweight='bold', color=AZUL)
ax.text(0, -0.14, 'kg RFID', ha='center', va='center', fontsize=9, color='#64748B')

legend_labels = [f'{t}  ({k:,.0f} kg)'.replace(',', '.') for t, k in zip(tipos, kgtip)]
ax.legend(wedges, legend_labels, loc='lower center', bbox_to_anchor=(0.5, -0.18),
          fontsize=8.5, ncol=2, frameon=False)
ax.set_title('Distribución por tipo de residuo — Enero 2026', fontsize=12,
             fontweight='bold', color=AZUL, pad=14)
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'g3_tipos.png'), dpi=150, bbox_inches='tight')
plt.close()
print('✅ g3_tipos.png')

# ── 4. ZONAS GEOGRÁFICAS ──────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(9, 4.5))
zonas = [
    ('Casco Antiguo',        904),
    ('Zona Norte Interior',  8247),
    ('Zona Norte 1',        11520),
    ('Carretera Estación',  11594),
    ('Centro Suburbano',    12992),
    ('Urbanizaciones',      18165),
    ('Llandells-Estación',  19994),
]
zn  = [z[0] for z in zonas]
zkg = [z[1] for z in zonas]
gradient_colors = [AZUL3, AZUL3, AZUL2, AZUL2, AZUL, AZUL, '#0F2547']

bars = ax.barh(zn, zkg, color=gradient_colors, edgecolor='white', linewidth=0.5, height=0.6)
for bar, val in zip(bars, zkg):
    ax.text(val + 80, bar.get_y() + bar.get_height()/2,
            f'{val:,.0f} kg'.replace(',', '.'),
            va='center', fontsize=8.5, color='#334155', fontweight='bold')

ax.set_xlabel('Kg recogidos', fontsize=9, color='#64748B')
ax.set_title('Residuos por zona geográfica — Enero 2026', fontsize=12,
             fontweight='bold', color=AZUL, pad=14)
ax.tick_params(labelsize=9)
ax.set_xlim(0, max(zkg) * 1.28)
ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{int(x):,}'.replace(',', '.')))
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'g4_zonas.png'), dpi=150, bbox_inches='tight')
plt.close()
print('✅ g4_zonas.png')

# ── 5. COMPARATIVA MENSUAL (barra) ────────────────────────────────────────
fig, ax = plt.subplots(figsize=(9, 4))
meses_comp = ['Ene 2025\n(báscula)', 'Oct 2025', 'Nov 2025', 'Dic 2025', 'Ene 2026']
kgs_comp   = [471240, 821770, 536480, 536480, 468740]  # Excel báscula
colores_c  = [GRIS, GRIS, GRIS, GRIS, AZUL]

bars = ax.bar(meses_comp, kgs_comp, color=colores_c, edgecolor='white', linewidth=0.5, width=0.55)
for bar, val in zip(bars, kgs_comp):
    ax.text(bar.get_x() + bar.get_width()/2, val + 8000,
            f'{val:,.0f}'.replace(',', '.'),
            ha='center', va='bottom', fontsize=8.5,
            fontweight='bold', color=AZUL if val == max(kgs_comp) else '#475569')

ax.set_ylabel('Kg (báscula)', fontsize=9, color='#64748B')
ax.set_title('Evolución reciente — Báscula municipal', fontsize=12,
             fontweight='bold', color=AZUL, pad=14)
ax.tick_params(labelsize=9)
ax.set_ylim(0, max(kgs_comp) * 1.18)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{int(x):,}'.replace(',', '.')))
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'g5_comparativa.png'), dpi=150, bbox_inches='tight')
plt.close()
print('✅ g5_comparativa.png')

print(f'\n✅ Todos los gráficos en: {OUT}')
