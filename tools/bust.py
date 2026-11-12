"""Stamp a version on the site's own CSS and JS links so a new page never runs
with old cached files (GitHub Pages lets browsers keep each file 10 minutes).
Run before each commit: python3 tools/bust.py"""
import re, time, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M')
for page in ['index.html', 'org.html', 'join.html', 'insights.html', 'buyer.html']:
    p = root / page
    if not p.exists():
        continue
    s = p.read_text()
    s2 = re.sub(r'((?:href|src)=")((?:styles\.css|app\.js|data\.js|config\.js))(?:\?v=\d+)?(")', rf'\g<1>\g<2>?v={v}\g<3>', s)
    if s2 != s:
        p.write_text(s2)
        print(f'{page}: v={v}')
