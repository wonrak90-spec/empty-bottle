# 공병 입고 확인 V26 Flutter 실시간 OCR

## 목적
Android / iPhone에서 동일한 앱으로 공병 입고 라벨을 실시간 인식합니다.

### 확정 방향
- Tesseract: 사용하지 않음
- WMS 바코드 스캔: 사용하지 않음
- 실시간 OCR: Google ML Kit
- Android / iOS 공통: Flutter
- 기존 Apps Script / Google Sheets / 조회·보고 웹: 유지

## 현재 POC 기능
- 후면 카메라 자동 실행
- WMS / 업체 라벨 모드 전환
- 약 300ms 주기로 최신 프레임만 OCR
- 동일 값 3회 연속 인식 시 자동 확정
- OCR 처리시간(ms) 화면 표시
- WMS: 입고번호 / 품명 / 품목코드 / 수량 / 공급업체 / 입고일자 / 사용기한 / 용기번호
- 업체: 품명 / 수량 / Lot / Pallet No / 생산일자 / 생산시간 / 라인

## 플랫폼 요구사항
- Android / iOS 공통 Flutter 프로젝트
- iPhone 빌드는 Mac + Xcode 필요
- iOS minimum deployment target 15.5 이상
- iOS Info.plist에 NSCameraUsageDescription 필요
- Android/iOS 카메라 스트림은 각각 NV21 / BGRA8888 사용

## 다음 단계
1. 실제 WMS 라벨 10~20건으로 파서 튜닝
2. 업체별 라벨 패턴 추가
3. 필수항목 완료 시 WMS → 업체 자동전환
4. V22.4 개인계정 로그인 API 연결
5. 기존 saveSingle API 연결
6. 증빙사진 업로드
7. 오프라인 임시저장/재전송
8. Android APK / iOS TestFlight 배포
