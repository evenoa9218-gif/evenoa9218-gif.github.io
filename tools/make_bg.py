# -*- coding: utf-8 -*-
"""배경 사진을 WebP로 줄여 assets/bg/에 넣는다.

    python -X utf8 tools/make_bg.py [--start N] 사진1.jpg 사진2.jpg ...

`--start`는 첫 출력 번호(기본 1). 순서대로 N.webp, N+1.webp … 로 저장한다.
index.html의 BG_PHOTOS가 이 파일명을 가리킨다.

## 크기를 이렇게 잡은 이유

처음엔 폭 1920·품질 72로 줄였는데 **눈에 띄게 뭉개졌다.** 두 가지가 겹쳤다.

- 요즘 화면은 픽셀 밀도가 1을 넘는다(DPR 1.5~2). CSS 폭 1600짜리 창이라도
  물리 화소는 2400~3200이라, 1920 원본을 늘려 그리게 된다.
- 밤하늘은 어두운 부분의 미세한 밝기 차가 화면의 거의 전부다. 품질을 낮추면
  그 미묘한 계조가 제일 먼저 뭉개져 띠(밴딩)와 얼룩으로 보인다.
  어두우니 대충 줄여도 된다고 생각했는데 반대였다.

높이 상한을 두는 것은 세로로 긴 사진 때문이다. 가로 화면에 `cover`로 깔면
위아래는 어차피 잘려 보이지 않는데, 파일 크기는 그대로 낸다.
"""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow가 필요하다:  pip install pillow')

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'bg'
MAX_W = 2560
MAX_H = 2200          # 넘는 만큼은 가운데를 남기고 잘라낸다
QUALITY = 86


def main(argv):
    start = 1
    if len(argv) >= 2 and argv[0] == '--start':
        start = int(argv[1])
        argv = argv[2:]
    if not argv:
        sys.exit(__doc__)

    OUT.mkdir(parents=True, exist_ok=True)
    total, names = 0, []
    for i, p in enumerate(argv, start):
        src = Path(p)
        if not src.exists():
            print('  건너뜀 (없는 파일): %s' % src)
            continue
        im = Image.open(src)
        if im.mode not in ('RGB', 'L'):
            im = im.convert('RGB')
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)),
                           Image.LANCZOS)
        if im.height > MAX_H:
            top = (im.height - MAX_H) // 2
            im = im.crop((0, top, im.width, top + MAX_H))
        dst = OUT / ('%d.webp' % i)
        im.save(dst, 'WEBP', quality=QUALITY, method=6)
        kb = dst.stat().st_size / 1024
        total += kb
        names.append(dst.name)
        print('  %-44s → %-8s %6.0f KB  (%dx%d)'
              % (src.name, dst.name, kb, im.width, im.height))
    print('합계 %.0f KB' % total)
    print('index.html의 BG_PHOTOS가 %s를 가리키는지 확인할 것.' % ', '.join(names))


if __name__ == '__main__':
    main(sys.argv[1:])
