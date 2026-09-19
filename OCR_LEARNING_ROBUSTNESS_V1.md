# OCR Robustness Dataset V1

## 목적
공병 입고검수 OCR을 깨끗한 정면 라벨뿐 아니라 실제 창고의 원거리, 회전, 좌/우 사선, 상/하 원근, 저조도, 과노출, 흔들림, 저해상도, 스트레치필름 반사 및 복합 악조건에서도 검증한다.

## 데이터 역할
- **Seed**: Ground Truth를 확보하고 Train/Validation 및 악조건 증강에 사용한다.
- **Holdout**: 처음부터 학습/튜닝에 사용하지 않는 실제 현장 시험지다.
- Holdout 결과를 보고 실패유형을 파악하되, 같은 Holdout을 반복적으로 규칙 튜닝하는 경우 별도의 Final Holdout을 추가한다.

## 중복 제거
1. SHA-256으로 완전 동일 이미지(Exact duplicate)를 제거한다.
2. 256-bit dHash로 Near duplicate 후보를 그룹화한다.
3. Near duplicate는 자동 삭제하지 않고 사람이 검토한다.
4. 같은 원본/근접촬영 그룹은 Train/Validation/Holdout을 절대 나누지 않는다.

## 최종 증강 조건표
Seed exact-unique 1장당 아래 22개 변형을 생성한다.

| 구분 | Recipe | 각도/원근 | 추가 악조건 |
|---|---|---|---|
| 최상 | best_front_0 | 정면 0° | 대비/선명도 보정 |
| 최상 | best_rotate_left_5 | -5° | 대비/선명도 보정 |
| 최상 | best_rotate_right_5 | +5° | 대비/선명도 보정 |
| 최상 | best_perspective_left_mild | 좌측 약한 원근 | 대비/선명도 보정 |
| 최상 | best_perspective_right_mild | 우측 약한 원근 | 대비/선명도 보정 |
| 단일 악조건 | lowlight | 원각도 | 저조도 |
| 단일 악조건 | overexpose | 원각도 | 과노출 |
| 단일 악조건 | blur | 원각도 | 초점/흔들림 근사 |
| 단일 악조건 | lowres | 원각도 | 원거리/저해상도 근사 |
| 강한 각도 | rotate_left_15 | -15° | - |
| 강한 각도 | rotate_right_15 | +15° | - |
| 강한 각도 | rotate_left_20 | -20° | - |
| 강한 각도 | rotate_right_20 | +20° | - |
| 강한 원근 | perspective_left_strong | 좌측 강한 사선 | - |
| 강한 원근 | perspective_right_strong | 우측 강한 사선 | - |
| 강한 원근 | perspective_top_strong | 위에서 내려다보는 원근 | - |
| 강한 원근 | perspective_bottom_strong | 아래에서 올려다보는 원근 | - |
| 단일 악조건 | film_glare | 원각도 | 스트레치필름 세로 반사 |
| 복합 최악 | angle_glare_left | -15° + 좌사선 | 필름 반사 |
| 복합 최악 | angle_lowlight_right | +15° + 우사선 | 저조도 |
| 복합 최악 | angle_blur_top | 상단 강한 원근 | Blur |
| 복합 최악 | harsh_combo | +18° + 우사선 | 저해상도 + 저조도 + 반사 + Blur |

현재 Seed exact-unique 22장 기준 최대 **484개 local augmentation variants**가 생성된다.

### 각도 기준
- 최상 조건도 정면 0°만 사용하지 않고 ±5°와 약한 좌/우 원근을 포함한다.
- 최악 회전은 ±15°와 ±20°를 사용한다.
- 원근 왜곡은 좌/우뿐 아니라 위/아래 방향도 별도 생성한다.
- 각도와 반사/저조도/Blur가 동시에 발생하는 복합조건을 별도 평가한다.
- 사람이 정상적으로 읽기 어려울 정도로 과도하게 훼손된 이미지는 학습 기준에서 제외한다.

증강 이미지는 GitHub에 저장하지 않는다. 각 증강본은 반드시 원본과 같은 Split을 사용한다.

## Ground Truth
현장 프로그램에서
`OCR → 자동입력 → 작업자 키인 수정 → 저장`
순으로 확정된 Final 값을 Ground Truth 후보로 사용한다.

관리자 APPROVED 데이터만 공식 Dataset/Fine-tuning에 포함한다.

## 조건별 성능 분리
전체 평균만 보지 않고 다음을 별도 집계한다.

- best_front
- rotation_mild
- perspective_mild
- rotation_strong
- perspective_side_strong
- perspective_vertical_strong
- lowlight
- overexpose
- blur
- lowres
- film_glare
- angle_glare
- angle_lowlight
- angle_blur
- combined_worst

이를 통해 예를 들어 전체 92%라도 강한 사선이 78%라면 Release 후보로 바로 판단하지 않고 개선 대상으로 남긴다.

## 90% Release Gate
단순 문자 인식률이 아니라 **업무 필드 정확도**로 평가한다.

WMS Critical:
- inboundNo
- itemCode
- product
- displayQty
- containerFrom / containerTo

Vendor Critical:
- product
- qty
- palletNo

기본 배포 Gate:
- Holdout Critical Field Accuracy >= 90%
- 각도/원근을 포함한 악조건별 결과를 별도 표시
- 기존 모델보다 Critical 성능이 하락하면 배포하지 않음
- 평균 90%를 넘더라도 특정 Critical 필드나 주요 악조건이 현저히 낮으면 개선 대상으로 유지

## 실행 예시
```bash
python OCR_LEARNING_ROBUSTNESS_PREP_V1.py \
  --input "FIELD=/private/field.zip=holdout" \
  --input "SEED=/private/seed.zip=seed" \
  --output /private/manifest.local.json

python OCR_LEARNING_ROBUSTNESS_AUGMENT_V1.py \
  --manifest /private/manifest.local.json \
  --seed-zip /private/seed.zip \
  --output-dir /private/augmented \
  --variants-manifest /private/variants.local.json

python OCR_LEARNING_ROBUSTNESS_EVAL_V1.py \
  --input /private/predictions_vs_truth.json \
  --split holdout \
  --min-critical 90
```

## 개인정보/저장 원칙
- 사진 원본/증강본은 공개 GitHub에 올리지 않는다.
- GitHub에는 도구, 스키마, 테스트만 저장한다.
- 운영 Learning Store는 기존 Drive 사진 URL + Record ID만 참조한다.
