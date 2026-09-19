from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/'v26-ocr-benchmark.js').read_text(encoding='utf-8')

def main():
    assert "labels_holdout.jsonl" in JS, "browser benchmark must read labeled holdout manifest"
    assert "folder:'augmented/'+(x.dataset_split||'train')" in JS, "browser benchmark must match packager augmented paths"
    assert "Array.isArray(r.conditions)" in JS, "multi-condition aggregation missing"
    assert "groupWeightedCriticalAccuracy" in JS, "source-group weighted metric missing"
    assert "sourceGroup:j.source_group||j.sourceGroup||j.file" in JS, "source group propagation missing"
    print('PASS browser benchmark/private package contract')

if __name__=='__main__':
    main()
