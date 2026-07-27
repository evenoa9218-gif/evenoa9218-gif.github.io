# evenoa9218-gif.github.io

변호사시험 통합 학습 시스템의 **허브**. 네 개 위성 앱의 진입점이자, 공용 서비스워커와
PWA 매니페스트를 제공하는 루트 사이트다.

```
evenoa9218-gif.github.io/
├── /                    ← 이 저장소 (대시보드 · 서비스워커 · 매니페스트)
├── /MCQ/                선택형
├── /CASE_Practice/      사례형
├── /Core_Notes/         암기장
└── /RECORD_Practice/    기록형
```

설계 규약 전체는 `CASE_Practice/docs/ARCHITECTURE.md`에 있다.

## 왜 저장소 이름이 `evenoa9218-gif.github.io`여야 하는가

GitHub Pages에서 `{계정}.github.io` 이름의 저장소만 사이트 루트(`/`)에 배포된다.
다른 이름이면 `/저장소명/` 하위로 들어가고, 그러면 서비스워커 스코프와 PWA 설치 범위를
`/` 전체로 잡을 수 없다.

**같은 오리진**에 네 앱을 모으는 이유는 더 근본적이다.

- `localStorage`·`IndexedDB`는 오리진 단위로 격리된다 → 오리진이 다르면 학습 기록을 공유할 수 없다
- 서비스워커 스코프도 오리진 + 경로 기준이다 → 허브 하나로 네 앱을 오프라인 캐싱할 수 있다
- 앱 간 이동 시 재로그인이 없다

그래서 다른 계정과 협업하더라도 저장소를 그 사람 계정으로 옮기지 않고,
**Collaborator로 초대**해서 오리진을 유지한다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 대시보드. 앱 진입 카드 + 과목별 학습량 집계. 빌드 없는 단일 HTML(바닐라 JS) |
| `core/store.js` | 저장 추상화 레이어. **정본은 `CASE_Practice/core/store.js`** — 여기 것은 복사본이다 |
| `sw.js` | 공용 서비스워커 |
| `manifest.json`, `icon.svg` | PWA 매니페스트와 아이콘 |

`core/store.js`는 정본을 그대로 복사한 것이다. 정본이 바뀌면 여기도 함께 갱신한다.
허브는 위성 앱과 **같은 IndexedDB(`lawhub` / `records`·`kv`)와 같은 `lawhub_uid`**를 읽는다.
테마 키는 `lawhub_theme`이고, 없으면 CASE_Practice의 `cp_theme` 값을 물려받는다.

### MCQ 로그인 연동

MCQ는 로그인한 ID를 자기 키인 **`hub_last_uid`**에 저장하고, 다음 방문 때 그 값이 있으면
PIN을 묻지 않고 바로 들어간다. 같은 오리진이라 `localStorage`는 공유되지만 키 이름이
`lawhub_uid`와 달라서, 그냥 두면 허브 로그인과 MCQ 로그인이 서로를 모른다.

그래서 허브가 **두 키를 함께 맞춘다.** 허브에서 로그인하면 MCQ도 로그인된 상태가 되고,
MCQ에서 먼저 로그인했다면 허브가 그 ID를 이어받는다. 로그아웃하면 양쪽 다 지운다.

> **아는 대가**: 이 연동은 MCQ의 PIN 확인을 건너뛴다. 허브에서 아무 ID나 넣으면 그 ID로
> MCQ에 들어갈 수 있다. MCQ도 원래 같은 기기 재방문 때는 PIN을 묻지 않으므로 완전히
> 새로운 구멍은 아니지만, **첫 로그인의 PIN 관문이 사라지는 것은 맞다.**
> 이 방식이 싫다면 `index.html`의 `syncUid()` 호출을 빼면 각 앱이 따로 로그인하게 된다.

## 서비스워커 스코프

- 스코프는 `/` 전체. 허브 셸(`index.html`, `core/store.js`, `manifest.json`, `icon.svg`)만 precache한다.
- 위성 앱(`/MCQ/`, `/CASE_Practice/`, `/Core_Notes/`, `/RECORD_Practice/`)은 런타임 캐시.
  네트워크를 먼저 쓰고 오프라인일 때만 캐시가 답한다 — 위성 앱 배포를 캐시가 붙잡지 않게 하려는 것.
- **`data/*.json`은 precache하지 않는다.** 수 MB 규모라 첫 방문에 수십 MB를 받게 되기 때문이다.
  런타임 network-first 캐시만 적용한다.
- 위성 앱이 자기 서비스워커를 `/MCQ/` 같은 **더 좁은 스코프**로 등록하면 브라우저가 그쪽을
  우선한다. 그때 허브 워커는 해당 경로 요청을 아예 보지 않으므로 충돌하지 않는다.
- 허브 **문서(navigate) 요청은 network-first**다. 캐시를 먼저 주면 허브를 새로 배포해도
  방문자가 한 번은 옛 화면을 보게 되기 때문이다. 나머지 셸 자산은 stale-while-revalidate.
- 캐시 이름에 버전(`sw.js`의 `VERSION`)이 붙어 있다. 셸을 바꾸면 이 값을 올려야
  activate에서 옛 캐시가 정리된다.

## 로컬에서 열기

서비스워커는 `file://`에서 동작하지 않는다. 반드시 http로 띄운다.

```bash
cd hub_site
python -m http.server 8000
# → http://localhost:8000/
```

`file://`로 직접 열면 대시보드는 뜨지만 서비스워커 등록은 건너뛴다(안내 문구가 표시된다).

네 앱을 함께 확인하려면 각 저장소를 이 폴더 아래 `MCQ/`, `CASE_Practice/`, `Core_Notes/`로
클론해 두고 같은 서버로 띄우면 배포 환경과 같은 경로 구조가 된다
(단, 그 폴더들은 이 저장소에 커밋하지 않는다).
