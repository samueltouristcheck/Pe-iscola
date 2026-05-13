import pypdf, sys
sys.stdout.reconfigure(encoding='utf-8')

pdf_path = r"C:\Users\samue\OneDrive\Escritorio\08 - Informe Residuos - Agosto 2025.pdf"
r = pypdf.PdfReader(pdf_path)
page = r.pages[0]
imgs = list(page.images)
print(f"Imágenes en portada: {len(imgs)}")
for i, img in enumerate(imgs):
    ext = img.name.split(".")[-1] if "." in img.name else "png"
    out = fr"C:\Users\samue\OneDrive\Escritorio\Peñiscola_Cursor\informes_ejemplo\portada_foto_{i}.{ext}"
    with open(out, "wb") as f:
        f.write(img.data)
    print(f"  -> {out} ({len(img.data)//1024} KB)")
