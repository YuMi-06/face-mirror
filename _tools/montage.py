import sys
from pathlib import Path
from PIL import Image, ImageDraw
shots = Path(r"D:\桌面\机器人\face-mirror\_verify\shots")
out = shots.parent
files = sorted(p for p in shots.glob("*.png"))
def sheet(names, cols, cell_w, path, label_h=18):
    ims = []
    for n in names:
        p = shots / n
        if not p.exists(): continue
        im = Image.open(p).convert("RGB")
        h = round(cell_w * im.height / im.width)
        ims.append((n, im.resize((cell_w, h), Image.LANCZOS)))
    if not ims: return
    ch = ims[0][1].height + label_h
    rows = (len(ims) + cols - 1) // cols
    sheet_im = Image.new("RGB", (cols * cell_w, rows * ch), (24, 24, 30))
    d = ImageDraw.Draw(sheet_im)
    for i, (n, im) in enumerate(ims):
        x = (i % cols) * cell_w; y = (i // cols) * ch
        sheet_im.paste(im, (x, y + label_h))
        d.text((x + 4, y + 4), n, fill=(230, 230, 240))
    sheet_im.save(path)
    print(path, sheet_im.size)
real = [f"0{i}-" for i in range(5)]
sheet([p.name for p in files if p.name.startswith(tuple(real))], 2, 620, out / "montage-real.png")
rest = [p.name for p in files if not p.name.startswith(tuple(real))]
sheet(rest, 4, 470, out / "montage-styles.png")
