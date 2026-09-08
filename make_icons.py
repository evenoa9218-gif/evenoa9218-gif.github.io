# 홈 화면 아이콘 — 사용자가 준 원본 그림(바탕화면)에서 만든다.
#
# 원본은 흰 페이지 위에 둥근 타일이 떠 있고 그림자까지 있는 렌더다. 그대로 쓰면
# 홈 화면에서 한 번 더 축소돼 보이고 테두리에 회색 띠가 생긴다. 그래서
#   ① 저주파 음영(비네팅·그림자)을 빼서 배경을 고른 크림으로 만들고
#   ② 타일 모서리 곡선이 안 걸리는 안쪽만 잘라
#   ③ 크림으로 넓혀 원본의 여백감을 되살린다.
# 모서리는 iOS 가 알아서 깎으므로 여기서 깎지 않는다(이중으로 깎이면 어색해진다).
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SRC   = r'C:\Users\82109\Desktop\KakaoTalk_20260908_182424094_01.png'
CX,CY = 511, 501      # 금색 그림의 중심(실측)
INNER = 272           # 타일 둥근 모서리에 안 걸리는 최대 반변
CANVAS= 640           # 최종 정사각 — 원본 타일의 여백 비율에 맞춘 값
CREAM = (232, 226, 217)

def source_square():
    im = Image.open(SRC).convert('RGB')
    a  = np.asarray(im).astype(np.float32)
    cream = np.array(CREAM, np.float32)
    flat = a.copy()
    flat[(a[:,:,0]-a[:,:,2]) > 22] = cream                     # 금색을 덮고
    bg = np.asarray(Image.fromarray(flat.astype(np.uint8))
                    .filter(ImageFilter.GaussianBlur(70))).astype(np.float32)
    even = np.clip(a + (cream - bg), 0, 255).astype(np.uint8)  # 배경을 평탄화
    inner = Image.fromarray(even).crop((CX-INNER, CY-INNER, CX+INNER, CY+INNER))

    out = Image.new('RGB', (CANVAS, CANVAS), CREAM)
    m = Image.new('L', (2*INNER, 2*INNER), 0)
    ImageDraw.Draw(m).rectangle([22, 22, 2*INNER-23, 2*INNER-23], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(11))                 # 이음매가 안 보이게
    off = (CANVAS - 2*INNER)//2
    out.paste(inner, (off, off), m)
    return out

def make(base, path, size, scale=1.0):
    if scale == 1.0:
        img = base
    else:                                                      # 안드로이드 원형 마스크용
        s = int(base.size[0]*scale)
        img = Image.new('RGB', base.size, CREAM)
        img.paste(base.resize((s,s), Image.LANCZOS), ((base.size[0]-s)//2,)*2)
    img.resize((size,size), Image.LANCZOS).save(path, optimize=True)
    print(f'  {path}  {size}x{size}')

if __name__ == '__main__':
    b = source_square()
    b.save('_preview.png')
    make(b,'apple-touch-icon.png',180); make(b,'icon-192.png',192)
    make(b,'icon-512.png',512);        make(b,'icon-maskable-512.png',512,.80)
