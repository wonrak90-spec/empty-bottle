# 공병 입고 확인 V26 - 실시간 OCR Android POC

## 방향
- Tesseract 완전 미사용
- WMS 바코드 스캔 미사용
- Google ML Kit 한국어 OCR을 기기 내부에서 실시간 실행
- 기존 웹/Apps Script/DB는 유지
- 현장 작업자가 서버 OCR을 기다리지 않도록 설계

## 속도 설계
- CameraX `STRATEGY_KEEP_ONLY_LATEST`
- 1280×720 분석 프레임
- 약 300ms 간격으로 OCR 시도
- OCR 중 들어온 오래된 프레임은 폐기
- 동일 값 3회 연속 인식 시 필드 확정
- 화면 우측 상단에 OCR 처리시간(ms) 표시

## OCR 모델
- `com.google.mlkit:text-recognition-korean:16.0.1`
- bundled 방식이라 최초 실행 모델 다운로드 대기가 없음

## 현재 POC
1. WMS 라벨 실시간 OCR
2. 업체 라벨 실시간 OCR
3. 필드별 안정값 자동 확정
4. WMS 바코드 무시
5. Tesseract 없음

## 다음 작업
- 실제 라벨 10~20장으로 정규식/ROI 튜닝
- WMS 필수항목 완료 시 업체라벨 단계 자동 전환
- 로그인 API 연결
- 기존 saveSingle API 연결
- 대표사진/Google Drive OCR은 필요 시 백그라운드 검증용으로만 사용
