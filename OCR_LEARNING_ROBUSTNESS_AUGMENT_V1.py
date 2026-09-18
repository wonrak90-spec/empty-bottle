#!/usr/bin/env python3
"""Generate local robustness variants from exact-unique Seed images.

Never use holdout images for augmentation/training.
Generated images are local artifacts and must not be committed to GitHub.

Requires: Pillow
"""
import argparse, hashlib, json, random, zipfile
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageDraw

IMG_EXT={'.jpg','.jpeg','.png','.webp','.bmp','.tif','.tiff'}

def ensure_rgb(im): return im.convert('RGB') if im.mode!='RGB' else im.copy()

def load_zip_map(path):
    z=zipfile.ZipFile(path)
    return z,{hashlib.sha256(z.read(i)).hexdigest():i for i in z.infolist()
             if not i.is_dir() and Path(i.filename).suffix.lower() in IMG_EXT}

def resize_roundtrip(im,scale):
    w,h=im.size
    small=im.resize((max(32,int(w*scale)),max(32,int(h*scale))),Image.Resampling.BILINEAR)
    return small.resize((w,h),Image.Resampling.BICUBIC)

def film_glare(im,seed):
    rnd=random.Random(seed); base=ensure_rgb(im).convert('RGBA')
    overlay=Image.new('RGBA',base.size,(255,255,255,0)); draw=ImageDraw.Draw(overlay)
    w,h=base.size
    for _ in range(rnd.randint(4,8)):
        x=rnd.randint(0,max(0,w-1)); bw=max(8,int(w*rnd.uniform(.012,.045)))
        draw.rectangle((x,0,min(w,x+bw),h),fill=(255,255,255,rnd.randint(28,72)))
    overlay=overlay.filter(ImageFilter.GaussianBlur(max(2,w/600)))
    return Image.alpha_composite(base,overlay).convert('RGB')

def rotate(im,deg):
    return ensure_rgb(im).rotate(deg,resample=Image.Resampling.BICUBIC,expand=False,fillcolor=(245,245,245))

def recipes(im,sha):
    seed=int(sha[:16],16); rnd=random.Random(seed); src=ensure_rgb(im)
    best=ImageOps.autocontrast(src,cutoff=1).filter(ImageFilter.UnsharpMask(radius=1.3,percent=125,threshold=3))
    yield 'best_autocontrast',best,'best'
    yield 'lowlight',ImageEnhance.Brightness(src).enhance(.52),'lowlight'
    yield 'overexpose',ImageEnhance.Brightness(ImageEnhance.Contrast(src).enhance(.82)).enhance(1.45),'overexpose'
    yield 'blur',src.filter(ImageFilter.GaussianBlur(1.6)),'blur'
    yield 'lowres',resize_roundtrip(src,.32),'lowres'
    yield 'rotation',rotate(src,rnd.choice([-12,-8,8,12])),'rotation'
    yield 'film_glare',film_glare(src,seed),'film_glare'
    combo=resize_roundtrip(src,.42)
    combo=rotate(combo,rnd.choice([-9,9]))
    combo=ImageEnhance.Brightness(combo).enhance(.62)
    combo=film_glare(combo,seed+17).filter(ImageFilter.GaussianBlur(.7))
    yield 'harsh_combo',combo,'combined'

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--manifest',required=True)
    ap.add_argument('--seed-zip',required=True)
    ap.add_argument('--output-dir',required=True)
    ap.add_argument('--variants-manifest',required=True)
    ap.add_argument('--jpeg-quality',type=int,default=88)
    ap.add_argument('--max-side',type=int,default=1800)
    args=ap.parse_args()

    manifest=json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    z,bysha=load_zip_map(args.seed_zip)
    outdir=Path(args.output_dir);outdir.mkdir(parents=True,exist_ok=True)
    rows=[]; originals=0

    for item in manifest['items']:
        if item['role']!='seed' or item.get('exactDuplicateOf'): continue
        zi=bysha.get(item['sha256'])
        if not zi: continue
        im=Image.open(BytesIO(z.read(zi)));im.load();im=ensure_rgb(im);originals+=1
        if max(im.size)>args.max_side:
            scale=args.max_side/max(im.size)
            im=im.resize((max(1,int(im.width*scale)),max(1,int(im.height*scale))),Image.Resampling.LANCZOS)
        source_group='SRC-'+item['sha256'][:12]
        for recipe,img,condition in recipes(im,item['sha256']):
            name=f'{source_group}__{recipe}.jpg'
            img.save(outdir/name,'JPEG',quality=args.jpeg_quality,optimize=True)
            rows.append({'sourceGroup':source_group,'sourceSha256':item['sha256'],'recipe':recipe,
                         'condition':condition,'file':name,'splitConstraint':'same_as_source'})
    z.close()
    result={
        'schema':'OCR-ROBUSTNESS-AUGMENT-V1','sourceUnique':originals,'variantCount':len(rows),
        'warning':'All variants from one source must stay in one train/validation split. Holdout images never enter training.',
        'variants':rows
    }
    Path(args.variants_manifest).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'sourceUnique':originals,'variantCount':len(rows)},ensure_ascii=False))

if __name__=='__main__': main()
