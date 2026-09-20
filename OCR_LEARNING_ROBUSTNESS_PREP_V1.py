#!/usr/bin/env python3
"""Prepare OCR Robustness Dataset manifest without uploading image bytes.

Example:
  python OCR_LEARNING_ROBUSTNESS_PREP_V1.py \
    --input "FIELD=/path/field.zip=holdout" \
    --input "SEED=/path/seed.zip=seed" \
    --output /tmp/ocr_robustness_manifest.local.json

Requires: Pillow, numpy
"""
import argparse, hashlib, json, os, zipfile
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageStat
import numpy as np

IMG_EXT={'.jpg','.jpeg','.png','.webp','.bmp','.tif','.tiff'}

def sha256(data): return hashlib.sha256(data).hexdigest()

def dhash(im,size=16):
    g=im.convert('L').resize((size+1,size),Image.Resampling.LANCZOS)
    a=np.asarray(g,dtype=np.int16)
    bits=(a[:,1:]>a[:,:-1]).flatten()
    v=0
    for b in bits:v=(v<<1)|int(b)
    return f'{v:0{size*size//4}x}'

def ham_hex(a,b): return (int(a,16)^int(b,16)).bit_count()

def quality(im):
    g=im.convert('L'); stat=ImageStat.Stat(g)
    mean=float(stat.mean[0]); std=float(stat.stddev[0])
    small=g.copy(); small.thumbnail((1000,1000))
    arr=np.asarray(small,dtype=np.float32)
    if arr.shape[0]>2 and arr.shape[1]>2:
        lap=(-4*arr[1:-1,1:-1]+arr[:-2,1:-1]+arr[2:,1:-1]+arr[1:-1,:-2]+arr[1:-1,2:])
        sharp=float(lap.var())
    else: sharp=0.0
    return {'brightness':round(mean,1),'contrast':round(std,1),'sharpness_proxy':round(sharp,1)}

def read_sources(specs):
    for spec in specs:
        name,path,role=spec.split('=',2)
        p=Path(path)
        if p.suffix.lower()=='.zip':
            with zipfile.ZipFile(p) as z:
                for zi in z.infolist():
                    if zi.is_dir() or Path(zi.filename).suffix.lower() not in IMG_EXT: continue
                    yield name,role,zi.filename,z.read(zi)
        elif p.is_dir():
            for fp in sorted(p.rglob('*')):
                if fp.suffix.lower() in IMG_EXT:
                    yield name,role,str(fp.relative_to(p)),fp.read_bytes()
        else: raise ValueError(f'unsupported input: {p}')

def build(specs,near_threshold=18):
    items=[]
    for set_name,role,name,data in read_sources(specs):
        im=Image.open(BytesIO(data)); im.load()
        items.append({
            'set':set_name,'role':role,'name':os.path.basename(name),'relativePath':name,
            'sha256':sha256(data),'dhash256':dhash(im),'width':im.width,'height':im.height,
            'bytes':len(data),'quality':quality(im),'exactDuplicateOf':None,'nearGroup':None,
            'groundTruthStatus':'needs_review','conditions':[]
        })

    exact=defaultdict(list)
    for i,x in enumerate(items): exact[x['sha256']].append(i)
    for idxs in exact.values():
        if len(idxs)>1:
            canon=idxs[0]
            for i in idxs[1:]: items[i]['exactDuplicateOf']=items[canon]['sha256']

    reps=[i for i,x in enumerate(items) if not x['exactDuplicateOf']]
    parent={i:i for i in reps}
    def find(x):
        while parent[x]!=x:
            parent[x]=parent[parent[x]];x=parent[x]
        return x
    def union(a,b):
        a,b=find(a),find(b)
        if a!=b: parent[b]=a

    for ai,i in enumerate(reps):
        for j in reps[ai+1:]:
            if items[i]['set']!=items[j]['set']: continue
            if ham_hex(items[i]['dhash256'],items[j]['dhash256'])<=near_threshold: union(i,j)

    groups=defaultdict(list)
    for i in reps: groups[find(i)].append(i)
    gid=0
    for idxs in groups.values():
        if len(idxs)>1:
            gid+=1; group=f'NG-{gid:03d}'
            for i in idxs: items[i]['nearGroup']=group

    return {
        'schema':'OCR-ROBUSTNESS-DATASET-V1',
        'summary':{
            'totalFiles':len(items),'exactUnique':len(reps),
            'exactDuplicateExtras':len(items)-len(reps),
            'seedUnique':sum(1 for i in reps if items[i]['role']=='seed'),
            'holdoutUnique':sum(1 for i in reps if items[i]['role']=='holdout'),
            'nearGroups':gid,'nearThreshold256':near_threshold,
            'splitRule':'exact/near group must never cross train/validation/holdout'
        },
        'items':items
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',action='append',required=True,help='SET=PATH=ROLE; ROLE seed|holdout')
    ap.add_argument('--output',required=True)
    ap.add_argument('--near-threshold',type=int,default=18)
    args=ap.parse_args()
    manifest=build(args.input,args.near_threshold)
    Path(args.output).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(manifest['summary'],ensure_ascii=False,indent=2))

if __name__=='__main__': main()
