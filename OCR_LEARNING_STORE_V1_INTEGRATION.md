# OCR Learning Store V1 integration

## 기준
- Base: `main@5e8bd0a1fe95dd26d6c281dcc17c9a40063a6999`
- 작업 브랜치: `feature/ocr-learning-store-v1`
- 기존 입고/OCR/조회/출력 흐름은 변경하지 않는다.
- 이미지 원본은 기존 Google Drive에만 저장한다. Learning Store에는 Drive URL과 Record ID만 기록한다.
- 공개 저장소의 `Code.gs`는 legacy V11 소스이므로 운영 Apps Script에 덮어쓰지 않는다.

## 구성
- `v55-ocr-learning.js`: 저장 성공 후 OCR 값과 최종 저장값을 비교하여 Learning Log를 비동기 큐에 적재한다.
- `v55-ocr-learning-admin.js`: 관리자 검증, 승인/제외, Dataset 버전 생성 UI.
- `OCR_LEARNING_STORE_V1.gs`: 현재 운영 중인 세션 인증 Apps Script 프로젝트에 추가할 서버 모듈.
- `OCR_LEARNING_ROUTER_V1.gs`: 기존 GET/POST dispatcher에 최소 연결하기 위한 독립 라우터.

Learning Store 서버가 아직 배포되지 않았거나 일시 장애가 나도 본래 `saveSingle`, `saveMulti`, `addProductionPallet` 결과는 그대로 반환된다. 학습 로그만 브라우저 대기열에 남고 이후 재동기화된다.

## 운영 Apps Script 라우팅 추가

현재 운영 백엔드의 인증/세션 검증이 완료된 뒤 얻은 사용자 객체를 `actor`라고 할 때 `OCR_LEARNING_ROUTER_V1.gs`를 호출한다. 실제 인증 함수명은 운영 백엔드 구현을 그대로 사용한다. Learning 관련 action이 아니면 `handled:false`를 반환하므로 기존 dispatcher 흐름은 그대로 유지된다.

### GET
```javascript
const learning = routeOcrLearningGetV1_(action, e.parameter || {}, actor);
if (learning.handled) return jsonOut_(learning.result);
```

### POST
```javascript
const learning = routeOcrLearningPostV1_(action, body.payload || {}, actor);
if (learning.handled) return jsonOut_(learning.result);
```

## 최초 1회
운영 Apps Script에 모듈과 라우팅을 추가한 뒤 `setupOcrLearningStoreV1_()`를 1회 실행한다.

생성되는 시트:
- `OCR_Learning_Log`
- `OCR_Dataset_Versions`

초기 활성 Dataset 버전:
- `OCR-DS-V1`

## 자동 비교 필드
WMS:
- 입고번호, 입고일자, 품명, 품목코드, 제조원, 공급업체, 표시수량, 단위, 사용기한, 용기번호 시작/종료

업체 라벨:
- 품명, 수량, 생산일자, 생산시간, Lot No., P/L No., 생산라인
- 제조사는 사용자 최종 수정 입력항목이 아니므로 변경률 계산에서는 제외하고 Template 정보로 관리

생산 WMS:
- 입고번호, 품명, 품목코드, 공급업체, 수량, 단위, 용기번호

각 필드는 `OCR 값 / 최종 값 / 변경 여부`로 누적된다.

## Fine-tuning 연결
관리자가 승인한 항목만 Dataset manifest에 포함한다. 각 항목은 Drive 사진 URL, OCR 원문, OCR 파싱값, 최종값, 수정 차이를 포함하므로 이후 PP-OCRv5 fine-tuning용 이미지/정답 라벨 생성 단계의 입력으로 사용할 수 있다.
