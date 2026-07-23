# MDhwpify

Markdown(`.md`) → **한글 문서(`.hwpx`)** 변환 데스크톱 도구. MDeautify(md→PDF)·MDocify(md→Word)의 자매 도구. (프로젝트 폴더/빌드 산출물명은 아직 md2hwpx 유지 — 추후 정리)

- **엔진**: [`@ssabrojs/hwpxjs`](https://www.npmjs.com/package/@ssabrojs/hwpxjs) (OWPML 패키지 생성, 브라우저 IIFE 번들로 벤더링 → `resources/vendor/hwpxjs.global.js`)
- **셸**: Neutralino (단일 exe, 리소스 내장) — MDocify와 동일 구조
- **미리보기**: Paged.js A4 페이지네이션 (MDeautify와 공통 파이프라인)

## 빌드
```powershell
.\build.ps1          # 단일 HTML + exe
.\build.ps1 -Exe     # exe만
```

## 현재 상태 (스캐폴드)
- ✅ md → .hwpx 저장 동작 (엔진 위임, frontmatter 처리)
- ⬜ 취향 레이어: 색 제목·섹션배지·다크 코드블록·브랜드 표머리·mermaid/KaTeX PNG·표지/TOC/머리말·강제페이지나눔 (IR 경로로 이식 예정)
