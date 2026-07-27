# -*- coding: utf-8 -*-
"""배경 사진을 WebP로 줄여 assets/bg/에 넣는다.

    python -X utf8 tools/make_bg.py 사진1.jpg 사진2.jpg ...

원본 순서대로 1.webp, 2.webp … 로 저장한다. index.html의 BG_PHOTOS가
이 파일명을 가리킨다.

배경 사진은 화면 전체에 깔리므로 폭 1920px이면 충분하다. 그보다 큰 원본은
줄인다 — 4000px짜리를 그대로 올리면 보이지도 않는 화소에 몇 MB를 쓴다.
"""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow가 필요하다:  pip install pillow')

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'bg'
MAX_W = 1920
QUALITY = 72          # 밤하늘은 어두워서 이 정도로 낮춰도 눈에 띄지 않는다


def main(paths):
    if not paths:
        sys.exit(__doc__)
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for i, p in enumerate(paths, 1):
        src = Path(p)
        if not src.exists():
            print('  건너뜀 (없는 파일): %s' % src)
            continue
        im = Image.open(src)
        if im.mode not in ('RGB', 'L'):
            im = im.convert('RGB')
        if im.width > MAX_W:
            h = round(im.height * MAX_W / im.width)
            im = im.resize((MAX_W, h), Image.LANCZOS)
        dst = OUT / ('%d.webp' % i)
        im.save(dst, 'WEBP', quality=QUALITY, method=6)
        kb = dst.stat().st_size / 1024
        total += kb
        print('  %-40s → %s  %6.0f KB  (%dx%d)'
              % (src.name, dst.name, kb, im.width, im.height))
    print('합계 %.0f KB' % total)
    print('index.html의 BG_PHOTOS 배열이 %d장을 가리키는지 확인할 것.' % len(paths))


if __name__ == '__main__':
    main(sys.argv[1:])
