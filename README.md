# 국제뉴스 텔레그램 티커 — GitHub 전용 버전

Manus 없이 **GitHub 저장소 하나만으로** 돌아가는 버전입니다.
블로그·노션·사내 페이지에 `<iframe>` 한 줄로 삽입할 수 있고, 서버도 로그인도 필요 없습니다.

- 기사 수집: **GitHub Actions**가 30분마다 자동 실행 (컴퓨터를 켜둘 필요 없음)
- 제목 번역: **키 없이 무료**로 동작 (원하면 무료 API 키를 붙여 품질 향상)
- 데이터 저장: `docs/news.json` 파일 하나
- 화면 제공: **GitHub Pages** (무료 정적 호스팅)

---

## 1. 준비물

- GitHub 계정 (무료)
- 저장소 1개 (Public 권장 — Pages 무료, Actions 무제한)

> Private 저장소도 가능하지만, 무료 플랜에서는 Actions 실행 시간에 월 한도가 있고
> GitHub Pages는 유료 플랜에서만 사용할 수 있습니다.

---

## 2. 설치 (5분)

1. **새 저장소 만들기**: 이름 예시 `news-ticker` (Public)
2. 이 폴더의 파일을 **그대로 업로드**(드래그 앤 드롭 또는 `git push`)
   ```
   .github/workflows/update-news.yml
   scripts/collect.mjs
   config/channels.json
   docs/index.html
   docs/news.json
   README.md
   ```
3. **Actions 권한 켜기**: 저장소 → `Settings` → `Actions` → `General`
   → `Workflow permissions` 에서 **Read and write permissions** 선택 → Save
4. **Pages 켜기**: 저장소 → `Settings` → `Pages`
   → `Source`: **Deploy from a branch**, `Branch`: **main / docs** → Save
5. **첫 수집 실행**: 저장소 → `Actions` → `Update news feed` → **Run workflow**
   (30분마다 자동 실행되지만, 바로 확인하려면 한 번 눌러주세요)

잠시 후 Pages 주소가 나옵니다:
```
https://<아이디>.github.io/news-ticker/
```

---

## 3. 블로그에 삽입하기

아래 한 줄을 블로그 HTML 편집 모드에 붙여넣으면 됩니다.
(`<아이디>` 부분만 본인 GitHub 아이디로 바꾸세요)

```html
<iframe
  src="https://<아이디>.github.io/news-ticker/?theme=dark&speed=7"
  width="100%" height="176" frameborder="0"
  style="border:0;display:block;max-width:100%"
  title="국제뉴스 텔레그램 티커"></iframe>
```

### 주소 옵션

| 파라미터 | 값 | 설명 |
| --- | --- | --- |
| `theme` | `dark` / `light` | 배경 테마 (기본 dark) |
| `speed` | 3 ~ 60 | 기사 전환 간격(초), 기본 7 |
| `title` | 문구 | 상단 헤더 문구 변경 (기본 `🐨 뉴스보이코알라 조장우의 국제뉴스`) |
| `sources` | `worldnews,trtworld` | 특정 채널만 표시 (쉼표 구분) |

예시:
```html
<iframe src="https://<아이디>.github.io/news-ticker/?theme=light&speed=10&title=오늘의%20국제뉴스&sources=worldnews,insiderpaper"
  width="100%" height="176" frameborder="0" style="border:0"></iframe>
```

---

## 4. 소스(채널) 추가·삭제

`config/channels.json` 만 수정하면 됩니다. `handle` 은 `https://t.me/<handle>` 주소의 이름입니다.

```json
{ "handle": "reuters", "label": "Reuters", "region": "종합" }
```

- `label`: 티커에 표시될 배지 이름
- `region`: 분류(표시용)
- `maxItems`: 저장할 최대 기사 수 (기본 150)
- `keepDays`: 며칠치 보관할지 (기본 14일)
- `translatePerRun`: 한 번에 번역할 최대 건수 (기본 60)

수정 후 커밋하면 다음 실행부터 반영됩니다.

---

## 5. 번역 품질 올리기 (선택)

기본 번역은 **키가 필요 없는 MyMemory** 를 사용합니다.
더 자연스러운 뉴스 문체를 원하면 저장소 → `Settings` → `Secrets and variables` → `Actions`
에서 아래 중 **하나만** 추가하면 자동으로 우선 사용됩니다.

| Secret 이름 | 발급처 | 비고 |
| --- | --- | --- |
| `GEMINI_API_KEY` | aistudio.google.com (무료) | 품질 좋고 무료 한도 넉넉함 — **추천** |
| `OPENAI_API_KEY` | platform.openai.com | 유료 |
| `DEEPL_API_KEY` | deepl.com | 유료 (무료 플랜도 있음) |
| `MYMEMORY_EMAIL` | — | 이메일만 넣으면 일일 한도 상향 |

키가 없어도 티커는 정상 동작합니다. 한도에 걸리면 그 실행에서는 번역을 건너뛰고 다음 실행에서 이어서 처리합니다.

---

## 6. 자주 있는 질문

**Q. 블로그에서 "로그인하세요 / 웨이크업" 이라고 나와요.**
이 버전은 그런 요구가 없습니다. GitHub Pages는 항상 켜져 있는 정적 주소라서, iframe이 그대로 뜹니다.

**Q. 실행 주기를 바꾸고 싶어요.**
`.github/workflows/update-news.yml` 의 `cron: "*/30 * * * *"` 를 수정하세요.
예: 10분마다 `"*/10 * * * *"`, 1시간마다 `"0 * * * *"`.
GitHub 무료 플랜은 예약 실행이 몇 분 늦게 돌 수 있습니다.

**Q. 자동 실행이 안 되는 것 같아요.**
저장소에 60일 이상 활동이 없으면 예약 워크플로가 자동 중지됩니다.
`Actions` 탭에서 **Enable workflow** 를 누르면 다시 돌아갑니다.

**Q. 제목이 영어로 나와요.**
번역 한도에 걸렸거나 아직 처리 전입니다. 다음 실행에서 이어서 번역됩니다.
`GEMINI_API_KEY` 를 넣으면 대부분 해결됩니다.

**Q. 기사가 3줄보다 많이 나와요.**
3줄 고정이며 7초마다 다음 3건으로 넘어갑니다. `speed` 로 속도를 조절하세요.
