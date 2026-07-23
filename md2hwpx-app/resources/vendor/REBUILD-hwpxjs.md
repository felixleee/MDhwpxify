# hwpxjs.global.js 재생성 방법 (엔진 업그레이드 시)

`@ssabrojs/hwpxjs`(브라우저 ESM)를 `window.hwpxjs` 전역 IIFE 번들로 재빌드한 것.

## 재생성
```bash
npm install @ssabrojs/hwpxjs
printf "export * from '@ssabrojs/hwpxjs/browser';\n" > vendor-entry.mjs
npx esbuild vendor-entry.mjs --bundle --format=iife --global-name=hwpxjs --outfile=hwpxjs.global.js
```

## ⚠️ 필수 패치 — mimetype (안 하면 한글이 "손상된 파일"로 거부)
엔진은 mimetype 파일 내용을 잘못된 `application/owpml`로 씀. 정식 HWPX 값은
`application/hwp+zip` (hwpxlib `MineTypes.HWPX` / Apache Tika 등록 기준). writer 호출부만 치환:

```bash
sed -i 's/"mimetype", "application\/owpml"/"mimetype", "application\/hwp+zip"/g' hwpxjs.global.js
```

- writer 2곳만 바뀌어야 함. 리더 검증(`s === "application/owpml"`)·에러 메시지의 owpml은 **그대로 둘 것**(우리는 리더 미사용).
- 검증: 생성한 .hwpx 첫 ZIP 엔트리가 `mimetype`(STORED, 무압축) + 내용이 정확히 `application/hwp+zip` 인지 확인.

컨테이너 media-type(`application/hwpml-package+xml`)은 엔진이 이미 정확함(hwpxlib와 일치).
