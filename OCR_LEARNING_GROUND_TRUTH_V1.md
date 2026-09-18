# Ground Truth 연결 규칙 V1

기존 사진 저장 규칙은 다음과 같다.

- `<Record ID>_라벨.jpeg` → WMS/입고라벨
- `<Record ID>_업체라벨.jpeg` → 업체라벨

따라서 UUID 파일명은 Record ID와 직접 연결할 수 있다.

## 자동 Ground Truth
`OCR_LEARNING_GROUND_TRUTH_LINK_V1.py`는 Robustness manifest와 Records CSV/TSV/JSON export를 받아 최종 저장값을 Ground Truth로 연결한다.

WMS:
- inboundNo
- inboundDate
- product
- itemCode
- manufacturer
- supplier
- displayQty
- unit
- expiryDate
- containerFrom
- containerTo

Vendor:
- product
- qty
- prodDate
- prodTime
- lotNo
- palletNo
- line

필드가 Records에 없으면 빈 값을 임의로 채우지 않고 `partial`로 남긴다.

## 수동 매핑
KakaoTalk 사진, 숫자 파일명 등 Record ID를 파일명으로 알 수 없는 경우에만 별도 local JSON으로 연결한다.

수동 매핑 파일과 Ground Truth 결과는 개인정보/업무데이터가 포함될 수 있으므로 GitHub에 올리지 않는다.

## 현재 Seed 파일명 구조
현재 제공 Seed의 exact-unique 22개 중:
- UUID 기반 자동 연결 후보: 15
- 숫자 파일명: 2
- KakaoTalk 파일명: 5

즉 파일명만으로도 15/22는 자동 연결 후보이며, 실제 Records export에 해당 ID가 존재하는지 확인 후 Ground Truth를 확정한다.
