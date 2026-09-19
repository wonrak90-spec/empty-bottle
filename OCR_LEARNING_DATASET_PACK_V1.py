#!/usr/bin/env python3
"""Build a private OCR Robustness Dataset package.

This tool packages already-reviewed Ground Truth and local augmentations.
It never uploads photos and should be run only in a private/local workspace.

Inputs
------
--labels-original:
  JSONL rows with:
  {
    "file": "...jpg",
    "dataset_split": "train|validation",
    "source_group": "...",
    "verified": true,
    "fields": {...}
  }

--labels-augmented:
  JSONL rows with:
  {
    "file": "...jpg",
    "dataset_split": "train|validation",
    "source_file": "...jpg",
    "augmentation": "...",
    "fields": {...}
  }

--original-dir:
  directory holding exact-unique source images

--augmented-dir:
  directory holding generated variants (flat or recursive)

--final-holdout-dir (optional):
  real field photos never used for training.

Output ZIP contains only the private dataset; do not commit it to GitHub.
"""
import argparse, hashlib, json, shutil, zipfile
from pathlib import Path

def read_jsonl(path):
    rows=[]
    for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
        line=line.strip()
        if line: rows.append(json.loads(line))
    return rows

def find_file(root,name):
    p=Path(root)/name
    if p.exists(): return p
    matches=list(Path(root).rglob(name))
    return matches[0] if matches else None

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--labels-original',required=True)
    ap.add_argument('--labels-augmented',required=True)
    ap.add_argument('--original-dir',required=True)
    ap.add_argument('--augmented-dir',required=True)
    ap.add_argument('--final-holdout-dir')
    ap.add_argument('--output',required=True)
    args=ap.parse_args()

    originals=read_jsonl(args.labels_original)
    augmented=read_jsonl(args.labels_augmented)

    bad_split=[x for x in originals+augmented if x.get('dataset_split') not in ('train','validation')]
    if bad_split: raise SystemExit('dataset_split must be train or validation')

    # Prevent source-group leakage.
    groups={}
    for x in originals:
        g=str(x.get('source_group') or x.get('sha256') or x.get('file'))
        s=x['dataset_split']
        if g in groups and groups[g]!=s:
            raise SystemExit('source_group split leakage: '+g)
        groups[g]=s

    out=Path(args.output)
    out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists(): out.unlink()

    summary={
        'schema':'OCR-ROBUSTNESS-DATASET-V1-PRIVATE',
        'originalUnique':len(originals),
        'trainOriginals':sum(x['dataset_split']=='train' for x in originals),
        'validationOriginals':sum(x['dataset_split']=='validation' for x in originals),
        'augmentedTotal':len(augmented),
        'trainAugmented':sum(x['dataset_split']=='train' for x in augmented),
        'validationAugmented':sum(x['dataset_split']=='validation' for x in augmented),
        'finalHoldout':0
    }

    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        z.writestr('labels_original.jsonl',''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in originals))
        z.writestr('labels_augmented.jsonl',''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in augmented))

        for x in originals:
            p=find_file(args.original_dir,x['file'])
            if not p: raise SystemExit('missing original: '+x['file'])
            expected=x.get('sha256')
            if expected and sha256(p)!=expected: raise SystemExit('original SHA mismatch: '+x['file'])
            z.write(p,'originals/'+x['dataset_split']+'/'+x['file'])

        for x in augmented:
            p=find_file(args.augmented_dir,x['file'])
            if not p: raise SystemExit('missing augmentation: '+x['file'])
            z.write(p,'augmented/'+x['dataset_split']+'/'+x['file'])

        if args.final_holdout_dir:
            rows=[]
            for p in sorted(Path(args.final_holdout_dir).rglob('*')):
                if not p.is_file(): continue
                rel=p.name
                rows.append({'file':rel,'sha256':sha256(p),'dataset_split':'final_holdout','verified':False})
                z.write(p,'final_holdout_unlabeled/'+rel)
            summary['finalHoldout']=len(rows)
            z.writestr('final_holdout_manifest.jsonl',''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows))

        z.writestr('dataset_summary.json',json.dumps(summary,ensure_ascii=False,indent=2))
        z.writestr('README.txt',
          'OCR Robustness Dataset V1 - Private\n'
          '===================================\n'
          'This ZIP contains label photos and must stay private.\n'
          'Train/validation source groups are isolated.\n'
          'Final holdout images must never be used for training.\n'
          'Ground Truth requires administrator approval before PP-OCRv5 fine-tuning.\n')
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
