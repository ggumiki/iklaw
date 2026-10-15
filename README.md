# 법무법인 서상 홈페이지

외부 패키지 없이 Node.js만으로 만들어지는 정적 홈페이지입니다. 글은 모두 `content/` 폴더의 마크다운 파일이고, 파일을 추가하거나 고치면 페이지가 자동으로 생기거나 바뀝니다.

## 폴더 구조

| 위치 | 내용 |
|---|---|
| `content/site.json` | 법인명, 전화, 이메일, 사무소 주소, 상담 시간, 홈 문구, 연혁 |
| `content/lawyers/` | 변호사 1명당 파일 1개 |
| `content/practice/` | 업무분야 1개당 파일 1개 |
| `content/columns/` | 법률칼럼 1편당 파일 1개 |
| `content/faq/` | 질문 1개당 파일 1개 (질문마다 주소가 따로 생김) |
| `content/pages/` | 소개, 개인정보처리방침, 면책공고 |
| `public/images/` | 사진·이미지 (`og.png`는 카카오톡·SNS 공유 이미지) |
| `public/admin/` | 웹 관리자 화면 설정 |
| `src/styles.css` | 디자인 (맨 위 색상 값만 바꿔도 전체 색이 바뀜) |
| `build.js` | 사이트를 만드는 스크립트 (보통은 고칠 일 없음) |

## 내용 수정·추가하는 방법

### 방법 1. 웹 관리자 화면 (권장)

배포 후 `https://사이트주소/admin/` 에 GitHub 계정으로 로그인하면 칼럼, FAQ, 변호사, 업무분야, 사이트 기본 정보를 입력 칸에서 바로 쓰고 고칠 수 있습니다. 저장하면 1~2분 뒤 사이트에 반영됩니다.

### 방법 2. 파일 직접 추가

예를 들어 칼럼을 쓰려면 `content/columns/` 에 `영문-주소.md` 파일을 만들고 아래 형식으로 씁니다. 파일 이름이 페이지 주소가 됩니다 (`/columns/영문-주소/`).

```markdown
---
title: 전세보증금을 못 받았을 때, 임차권등기명령부터 하세요
date: 2026-11-01
author: cha-sangik
category: civil-realestate
summary: 계약이 끝났는데 보증금을 못 받았다면 이사 전에 임차권등기명령을 해야 대항력과 우선변제권이 유지됩니다.
keyPoints:
  - 이사 전에 임차권등기가 끝났는지 확인하세요.
  - 보증금 반환 소송과 함께 진행할 수 있습니다.
laws:
  - 주택임대차보호법 제3조의3 (임차권등기명령)
relatedFaq:
  - eviction-duration
---
## 임차권등기명령이란?

본문은 마크다운으로 씁니다. **굵게**, [링크](/contact/), 목록(- 항목), 표를 쓸 수 있습니다.
```

- `author` 는 `content/lawyers/` 의 파일 이름 (예: `cha-sangik`)
- `category` 는 `content/practice/` 의 파일 이름 (예: `civil-realestate`, `criminal`, `family`, `corporate`, `administrative`, `public-procurement`)
- `draft: true` 를 넣으면 사이트에 나타나지 않습니다.
- 잘못된 이름을 쓰면 빌드할 때 경고가 나옵니다.

변호사 사진은 `public/images/lawyers/` 에 넣고 변호사 파일의 `photo:` 에 `/images/lawyers/파일이름.jpg` 를 적으면 됩니다. 사진이 없으면 성의 첫 글자로 표시됩니다.

## 내 컴퓨터에서 미리보기

Node.js 18 이상이 설치되어 있으면 이 폴더에서:

```
node build.js --serve
```

브라우저에서 http://localhost:4321 을 열면 됩니다. 설치할 패키지는 없습니다.

## 처음 배포하기 (GitHub + Netlify, 무료)

1. GitHub에 새 저장소를 만들고 이 폴더 전체를 올립니다 (`dist/` 폴더는 제외).
2. `public/admin/config.yml` 의 `repo: OWNER/seosang-site` 를 실제 저장소 이름으로 바꿉니다.
3. Netlify(netlify.com)에서 GitHub 저장소를 연결합니다. 빌드 설정은 `netlify.toml` 에 있어 따로 입력할 것이 없습니다.
4. **상담 신청서 알림**: Netlify 사이트 설정의 Forms에서 `consult` 폼에 이메일 알림을 추가합니다 (예: sslaw4995@gmail.com). 신청이 들어오면 메일로 옵니다.
5. **웹 관리자 로그인**: GitHub에서 OAuth App을 만들고 (콜백 주소 `https://api.netlify.com/auth/done`), 발급받은 Client ID·Secret을 Netlify 사이트 설정의 OAuth 항목에 GitHub 공급자로 등록합니다.
6. **도메인**: Netlify에 `www.ssnyj.co.kr` 을 연결하고, 도메인 업체에서 DNS를 Netlify로 바꿉니다. 다른 도메인을 쓰면 `content/site.json` 의 `url` 과 `config.yml` 의 `site_url` 도 함께 바꿉니다.

Netlify 대신 다른 접수 서비스(예: Formspree)를 쓰려면 `content/site.json` 의 `form.endpoint` 에 그 주소를 넣으면 됩니다.

## AI 검색(GEO)을 위해 들어가 있는 것

- **구조화 데이터(JSON-LD)**: 법인(LegalService), 사무소 3곳, 변호사(Person, 대한변협 등록 전문분야), 칼럼(Article, 작성 변호사·작성일·근거 법령), FAQ(FAQPage·QAPage), 업무분야(Service), 이동 경로(BreadcrumbList)가 모든 페이지에 자동으로 들어갑니다.
- **요약 먼저**: 모든 칼럼·FAQ·업무분야 페이지 첫머리에 요약 상자가 있습니다. AI가 가장 먼저 인용하는 부분이니 `summary` 는 결론부터 2~3문장으로 써 주세요.
- **작성자와 날짜**: 칼럼·FAQ마다 작성 변호사와 작성·수정일이 보이고 구조화 데이터에도 들어갑니다. 내용을 고치면 `updated` 날짜도 바꿔 주세요.
- **근거 법령**: `laws` 에 적은 조문이 페이지와 구조화 데이터(citation)에 들어갑니다.
- **`/llms.txt`, `/llms-full.txt`**: AI 서비스가 사이트 전체를 한눈에 읽을 수 있는 안내 파일이 자동 생성됩니다.
- **페이지별 마크다운 원문**: 각 칼럼·FAQ·변호사·업무분야 페이지의 `index.md` 원문이 함께 제공됩니다.
- **`robots.txt`**: 구글·네이버·Bing과 ChatGPT, Claude, Perplexity 등의 수집기를 허용합니다.
- **`sitemap.xml`, `rss.xml`**: 자동 생성됩니다.

## 배포 후 할 일

1. 네이버 서치어드바이저와 구글 서치콘솔에 사이트를 등록하고, 받은 소유확인 코드를 `content/site.json` 의 `verification` 에 넣은 뒤 `sitemap.xml` 을 제출합니다.
2. 네이버 지도(스마트플레이스)와 구글 비즈니스 프로필의 법인명·주소·전화를 사이트와 똑같이 맞춥니다. AI는 여러 곳의 정보가 일치할수록 신뢰합니다.
3. 블로그, 유튜브 등 법인 공식 채널이 있으면 `site.json` 의 `sameAs` 에 주소를 넣습니다.
4. 칼럼과 FAQ를 꾸준히 추가합니다. 실제 상담에서 받은 질문을 그대로 제목으로 쓰는 것이 가장 효과적입니다.

## 광고 규정 관련 주의

`specialties`(전문분야)에는 대한변호사협회에 실제 등록된 분야만 적어 주세요. 승소율, "최고", "1위" 같은 표현이나 결과를 보장하는 문구는 쓰지 않도록 되어 있습니다.
