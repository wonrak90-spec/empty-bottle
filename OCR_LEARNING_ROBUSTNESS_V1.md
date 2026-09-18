# OCR Robustness Dataset V1

## 목적
공병 입고검수 OCR을 깨끗한 정면 라벨뿐 아니라 실제 창고의 원거리, 회전, 저조도, 과노출, 흔들림, 저해상도, 스트레치필름 반사, 복합 악조건에서도 검증한다.

## 데이터 역할
- **Seed**: Ground Truth를 확보하고 Train/Validation 및 악조건 증강에 사용한다.
- **Holdout**: 처음부터 학습/튜닝에 사용하지 않는 실제 현장 시험지다.
- Holdout 결과를 보고 실패유형을 파악하되, 같은 Holdout을 반복적으로 규칙 튜닝하는 경우 별도의 Final Holdout을 추가한다.

## 중복 제거
1. SHA-256으로 완전 동일 이미지(Exact duplicate)를 제거한다.
2. 256-bit dHash로 Near duplicate 후보를 그룹화한다.
3. Near duplicate는 자동 삭제하지 않고 사람이 검토한다.
4. 같은 원본/근접촬영 그룹은 Train/Validation/Holdout을 절대 나누지 않는다.

## 악조건 증강
Seed의 exact-unique 원본만 사용한다.

- best_autocontrast: 대비/선명도 보정
- lowlight: 저조도
- overexpose: 과노출
- blur: 초점/흔들림 근사
- lowres: 원거리 촬영 근사
- rotation: 기울어진 라벨
- film_glare: 스트레치필름 세로 반사
- harsh_combo: 저해상도 + 회전 + 저조도 + 필름 반사 + 약한 Blur

증강 이미지는 GitHub에 저장하지 않는다. 각 증강본은 반드시 원본과 같은 Split을 사용한다.

## Ground Truth
현장 프로그램에서
`OCR → 자동입력 → 작업자 키인 수정 → 저장`
순으로 확정된 Final 값을 Ground Truth 후보로 사용한다.

관리자 APPROVED 데이터만 공식 Dataset/Fine-tuning에 포함한다.

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
- 악조건별 결과를 별도 표시
- 기존 모델보다 Critical 성능이 하락하면 배포하지 않음

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
