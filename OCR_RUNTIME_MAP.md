# 공병 입고 확인 — OCR 운영 구조

현재 운영 릴리스: **20260921-ocr-runtime3**

## 1. 운영 흐름

```
index.html
  -> config.js
     -> v22.js                 (기본 화면/공통 UI)
     -> v24.js                 (개인 로그인/세션)
     -> v25.js
     -> v26-web.js             (단건 화면 UI 전용)
     -> v26-qty.js
     -> v26-korean-ocr.js      (PP-OCRv5 엔진 전용)
     -> v26-vendor-templates.js
     -> v55-vendor-parser.js   (업체라벨 파서)
     -> v55-wms-parser.js      (WMS 파서)
     -> v55-roi-preprocess.js  (ROI/전처리)
     -> v55-adaptive-ocr.js    (V4.6 Safe-Merge)
     -> ocr-runtime.js         (카메라/실시간/사진 OCR 단일 제어)
     -> v26-production-wms.js  (생산 WMS, 동일 OCR Runtime 사용)
     -> v55-ocr-learning.js    (수정/확정 Learning Store)
     -> v26-stability.js       (탭 이동/페이지 종료 카메라 정리)
```

## 2. 역할 원칙

- **카메라 제어:** `ocr-runtime.js`만 담당
- **OCR 엔진:** `v26-korean-ocr.js`만 담당
- **WMS 파싱:** `v55-wms-parser.js`
- **업체라벨 파싱:** `v55-vendor-parser.js`
- **재시도/ROI/Safe-Merge:** `v55-adaptive-ocr.js`
- **작업자 수정 학습:** `v55-ocr-learning.js`
- **로그인 후 서버 조회:** `v24.js` 인증 완료 이후 실행

## 3. 카메라 Lifecycle

```
자동 인식 시작
 -> 새 MediaStream 생성
 -> 새 Session 생성
 -> 프레임 품질 확인
 -> 가장 선명한 프레임 선택
 -> V4.6 정밀 OCR
 -> 자동입력
 -> 작업자 확인
 -> Stream/Session 종료
```

카메라 중지는 UI 버튼을 삭제하지 않는다. Stream과 Session만 폐기하므로
**중지 후 다시 자동 인식을 눌러 항상 새 카메라 세션을 시작할 수 있어야 한다.**

## 4. 운영에서 사용하지 않는 Legacy 파일

아래 파일은 현재 repo에는 남겨 두지만 **config.js에서 로딩하지 않는다.**

- `v26-wms-cardscan.js`
- `v26-vendor-cardscan.js`
- `v26-ocr-benchmark.js`
- `v55-live-assist.js` (feature branch 실험용)

현장 안정화 확인 후 `legacy/` 이동 또는 삭제 여부를 별도로 결정한다.

## 5. 안전장치 / 롤백

- 안정본 백업: `backup/v54-stable-before-v46-direct-20260921`
- 변경 직전 백업: `backup/pre-ocr-runtime-cleanup-20260921`
- 일반 운영 URL 외 별도 `v46-preview` / `?v46test=1` 모드는 사용하지 않는다.

## 6. 검증 기준

- 로그인 성공 후 대시보드 조회
- WMS 자동 인식
- 업체라벨 자동 인식
- 카메라 중지 -> 재시작 반복
- 사진 촬영/갤러리 OCR
- 생산 WMS OCR
- OCR 자동입력 후 작업자 확인/수정
- 수정값 Learning Store 기록
