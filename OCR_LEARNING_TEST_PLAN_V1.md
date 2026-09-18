# OCR Learning Store V1 Test Plan

## 목적
기존 입고 저장/OCR/조회/출력 기능을 변경하지 않고 Learning Store가 추가 기록만 남기는지 검증한다.

## 사전 조건
- 작업 브랜치: `feature/ocr-learning-store-v1`
- Frontend service worker: `공병입고-v55-learning-store-v1b`
- 운영 Apps Script에 아래 2개 모듈 추가
  - `OCR_LEARNING_STORE_V1.gs`
  - `OCR_LEARNING_ROUTER_V1.gs`
- 기존 로그인/세션 인증 완료 후 router 호출
- 최초 1회 `setupOcrLearningStoreV1_()` 실행
- 개인 Drive 전체 탐색 권한은 사용하지 않는다.
- 사진은 기존 공병 프로그램이 저장한 Drive URL만 참조한다.

## TC-01 기존 기능 비영향
1. Learning backend를 아직 배포하지 않은 상태에서 로그인한다.
2. WMS OCR 또는 코드 스캔 후 단건 입고를 저장한다.
3. 기존 조회 화면에서 저장한 건을 검색한다.
4. A4 출력 화면을 연다.

Expected:
- 단건 저장 성공
- 조회/출력 정상
- Learning 저장 실패는 기존 저장 실패로 전파되지 않음
- 브라우저 Learning queue에 1건 이상 대기
- 관리자 화면은 "Learning Store 백엔드 연결 필요"로 표시

## TC-02 WMS OCR 무수정 저장
1. WMS 라벨을 PP-OCRv5로 인식한다.
2. 자동입력값을 수정하지 않고 저장한다.
3. 관리자 > OCR 학습을 연다.

Expected:
- Source: `wms`
- OCR Raw 존재
- Record ID 연결
- Drive 사진 URL 연결
- Compared Fields > 0
- Changed Fields = 0 또는 정규화 차이만 제외된 값
- Status = PENDING

## TC-03 WMS OCR 수정 저장
1. WMS 라벨 OCR 후 의도적으로 한 필드를 실제 정답으로 수정한다.
   예: 수량 `13608.000` 인식 문제를 `13608`로 보정하거나 품목코드를 정정
2. 저장한다.
3. 관리자 Learning Log에서 해당 Record를 확인한다.

Expected:
- 수정 필드에 OCR 값과 Final 값이 각각 표시
- changed = true
- 수량의 `.000` 정규화처럼 값의 의미가 같은 경우 불필요한 변경으로 잡히지 않음

## TC-04 업체라벨 템플릿
### KC Glass
- 제품명
- 수량
- 생산일자
- Lot No.
- 생산라인

### 동아에코팩
- 품명
- 포장사양 기반 수량
- 생산일자/시간
- P/L No.
- 생산라인

Expected:
- Source: `vendor`
- Template 값이 `KC Glass & Materials` 또는 `동아에코팩`
- OCR ↔ Final 필드 비교 정상
- WMS 사진이 아닌 업체라벨 Drive URL 연결

## TC-05 중복 방지
1. 동일한 저장 요청에 대해 Learning sync를 재실행한다.
2. 브라우저를 새로고침한 후 대기 로그 동기화를 다시 실행한다.

Expected:
- 동일 CaptureKey는 서버에 1건만 존재
- 중복 요청은 `duplicate:true`로 성공 처리

## TC-06 관리자 권한
Operator:
- 입고/OCR/저장 정상
- Learning Log 자동 누적 정상
- 관리자 검증 UI 접근 불가

Admin:
- PENDING 목록 조회
- 승인/제외 가능
- Dataset 버전 생성 가능

## TC-07 Dataset 버전
1. 초기 `OCR-DS-V1` 상태 확인
2. 일부 Learning Log 승인
3. `OCR-DS-V2` 생성 및 활성화
4. 신규 입고를 저장
5. Dataset 목록과 승인 수 확인

Expected:
- 기존 ACTIVE 버전은 FROZEN
- 신규 버전 ACTIVE
- 생성 이후 Learning Log는 신규 활성 버전에 연결
- 버전별 승인 Sample 수 집계

## TC-08 생산 WMS
1. 생산 등록에서 WMS 라벨 자동스캔
2. 기존 검수기록과 정확히 일치하는 파레트를 등록
3. Learning Log 확인

Expected:
- Source: `production_wms`
- 입고번호 / 용기번호 / 품목코드 / 품명 / 수량 비교
- 생산 세션 저장 성공 여부와 Learning 저장이 분리됨

## TC-09 연동 진단
관리자 > OCR 학습 > 연동 진단 실행

Expected:
- Learning client: PASS
- PP-OCRv5 local engine layer: PASS
- WMS parser: PASS
- Vendor template parser: PASS
- Save hook: PASS
- Service worker cache: `v55-learning-store-v1b`
- Learning backend: PASS (운영 모듈 배포 후)
- Dataset version API: PASS

## 합격 기준
- 기존 저장/조회/출력 기능 Regression 0건
- Learning 장애가 기존 업무 저장을 차단하지 않음
- 사진 바이너리 GitHub 저장 0건
- Learning Log의 Record ID ↔ Drive URL 연결 가능
- 관리자 승인 데이터만 Fine-tuning 후보로 사용 가능
- 승인 Sample 기준 Source/필드별 OCR 품질지표 산출 가능
- 동일 CaptureKey 동시 전송 시 중복 Learning Log 생성 0건


## TC-10 OCR 품질지표 / 승인 데이터 기준 분석
1. WMS Learning Log 1건과 업체라벨 Learning Log 1건을 관리자 승인한다.
2. 한 건은 무수정, 다른 한 건은 실제 정답으로 1개 필드를 수정한 Sample로 준비한다.
3. 관리자 > OCR 학습 화면을 연다.

Expected:
- 승인 데이터만 품질지표에 반영
- 전체 필드 일치율 표시
- Source별(WMS / Vendor 등) Sample 수, 비교 필드 수, 수정 필드 수, 일치율 표시
- 수정 빈도가 높은 필드 TOP 항목 표시
- PENDING / REJECTED 데이터는 기본 품질지표에서 제외
- 관리자 외 계정은 품질지표 API 접근 불가

## TC-11 동시 저장 / 중복 보호
1. 동일 CaptureKey를 거의 동시에 2회 전송한다.
2. 관리자 승인 또는 Dataset 생성 작업을 연속 실행한다.

Expected:
- ScriptLock으로 Learning Log / 검증 / Dataset 상태 변경 보호
- 동일 CaptureKey는 서버에 1건만 존재
- Dataset ACTIVE/FROZEN 상태가 중복 또는 누락되지 않음
