#!/usr/bin/env python3
"""Generate local robustness variants from exact-unique Seed images.

Never use holdout images for augmentation/training.
Generated images are local artifacts and must not be committed to GitHub.

Angle policy:
- Best: front 0°, mild rotation ±5°, mild left/right perspective.
- Worst: rotation ±15°/±20°, strong left/right/top/bottom perspective.
- Composite: angle + glare / lowlight / blur / low resolution.

Requires: Pillow
"""
import argparse, hashlib, json, random, zipfile
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageDraw

IMG_EXT={'.jpg','.jpeg','.png','.webp','.bmp','.tif','.tiff'}

def ensure_rgb(im):
    return im.convert('RGB') if im.mode!='RGB' else im.copy()

def load_zip_map(path):
    z=zipfile.ZipFile(path)
    return z,{hashlib.sha256(z.read(i)).hexdigest():i for i in z.infolist()
             if not i.is_dir() and Path(i.filename).suffix.lower() in IMG_EXT}

def resize_roundtrip(im,scale):
    w,h=im.size
    small=im.resize((max(32,int(w*scale)),max(32,int(h*scale))),Image.Resampling.BILINEAR)
    return small.resize((w,h),Image.Resampling.BICUBIC)

def film_glare(im,seed):
    rnd=random.Random(seed)
    base=ensure_rgb(im).convert('RGBA')
    overlay=Image.new('RGBA',base.size,(255,255,255,0))
    draw=ImageDraw.Draw(overlay)
    w,h=base.size
    for _ in range(rnd.randint(4,8)):
        x=rnd.randint(0,max(0,w-1))
        bw=max(8,int(w*rnd.uniform(.012,.045)))
        draw.rectangle((x,0,min(w,x+bw),h),fill=(255,255,255,rnd.randint(28,72)))
    overlay=overlay.filter(ImageFilter.GaussianBlur(max(2,w/600)))
    return Image.alpha_composite(base,overlay).convert('RGB')

def rotate(im,deg):
    return ensure_rgb(im).rotate(
        deg,resample=Image.Resampling.BICUBIC,expand=False,fillcolor=(245,245,245)
    )

def solve8(a,b):
    """Small Gaussian-elimination solver; avoids numpy dependency."""
    m=[list(map(float,row))+[float(rhs)] for row,rhs in zip(a,b)]
    n=8
    for col in range(n):
        pivot=max(range(col,n),key=lambda r:abs(m[r][col]))
        if abs(m[pivot][col])<1e-12:
            raise ValueError('perspective matrix is singular')
        m[col],m[pivot]=m[pivot],m[col]
        div=m[col][col]
        m[col]=[v/div for v in m[col]]
        for r in range(n):
            if r==col: continue
            factor=m[r][col]
            if factor:
                m[r]=[m[r][k]-factor*m[col][k] for k in range(n+1)]
    return [m[i][n] for i in range(n)]

def perspective_coeffs(dst,src):
    """Return Pillow coefficients mapping output(dst) pixels back to input(src)."""
    a=[];b=[]
    for (x,y),(u,v) in zip(dst,src):
        a.append([x,y,1,0,0,0,-u*x,-u*y]); b.append(u)
        a.append([0,0,0,x,y,1,-v*x,-v*y]); b.append(v)
    return solve8(a,b)

def perspective(im,direction,strength):
    src=ensure_rgb(im)
    w,h=src.size
    s=max(.01,min(.28,float(strength)))
    if direction=='left':
        dst=[(0,h*s),(w,0),(w,h),(0,h*(1-s))]
    elif direction=='right':
        dst=[(0,0),(w,h*s),(w,h*(1-s)),(0,h)]
    elif direction=='top':
        dst=[(w*s,0),(w*(1-s),0),(w,h),(0,h)]
    elif direction=='bottom':
        dst=[(0,0),(w,0),(w*(1-s),h),(w*s,h)]
    else:
        raise ValueError('unknown perspective direction: '+str(direction))
    source=[(0,0),(w,0),(w,h),(0,h)]
    coeffs=perspective_coeffs(dst,source)
    transform=getattr(Image,'Transform',Image).PERSPECTIVE if hasattr(Image,'Transform') else Image.PERSPECTIVE
    return src.transform(src.size,transform,coeffs,resample=Image.Resampling.BICUBIC,fillcolor=(245,245,245))

def improved(im):
    return ImageOps.autocontrast(ensure_rgb(im),cutoff=1).filter(
        ImageFilter.UnsharpMask(radius=1.3,percent=125,threshold=3)
    )

def recipes(im,sha):
    seed=int(sha[:16],16)
    src=ensure_rgb(im)
    best=improved(src)

    # BEST / realistic good-capture envelope. Angle is intentionally included.
    yield 'best_front_0',best,'best_front',{'angleDeg':0,'perspective':'front','severity':'best'}
    yield 'best_rotate_left_5',rotate(best,-5),'rotation_mild',{'angleDeg':-5,'perspective':'front','severity':'best'}
    yield 'best_rotate_right_5',rotate(best,5),'rotation_mild',{'angleDeg':5,'perspective':'front','severity':'best'}
    yield 'best_perspective_left_mild',perspective(best,'left',.06),'perspective_mild',{'angleDeg':0,'perspective':'left','strength':.06,'severity':'best'}
    yield 'best_perspective_right_mild',perspective(best,'right',.06),'perspective_mild',{'angleDeg':0,'perspective':'right','strength':.06,'severity':'best'}

    # Single adverse conditions.
    yield 'lowlight',ImageEnhance.Brightness(src).enhance(.52),'lowlight',{'severity':'adverse'}
    yield 'overexpose',ImageEnhance.Brightness(ImageEnhance.Contrast(src).enhance(.82)).enhance(1.45),'overexpose',{'severity':'adverse'}
    yield 'blur',src.filter(ImageFilter.GaussianBlur(1.6)),'blur',{'severity':'adverse'}
    yield 'lowres',resize_roundtrip(src,.32),'lowres',{'severity':'adverse'}
    yield 'rotate_left_15',rotate(src,-15),'rotation_strong',{'angleDeg':-15,'perspective':'front','severity':'adverse'}
    yield 'rotate_right_15',rotate(src,15),'rotation_strong',{'angleDeg':15,'perspective':'front','severity':'adverse'}
    yield 'rotate_left_20',rotate(src,-20),'rotation_strong',{'angleDeg':-20,'perspective':'front','severity':'adverse'}
    yield 'rotate_right_20',rotate(src,20),'rotation_strong',{'angleDeg':20,'perspective':'front','severity':'adverse'}
    yield 'perspective_left_strong',perspective(src,'left',.16),'perspective_side_strong',{'angleDeg':0,'perspective':'left','strength':.16,'severity':'adverse'}
    yield 'perspective_right_strong',perspective(src,'right',.16),'perspective_side_strong',{'angleDeg':0,'perspective':'right','strength':.16,'severity':'adverse'}
    yield 'perspective_top_strong',perspective(src,'top',.15),'perspective_vertical_strong',{'angleDeg':0,'perspective':'top','strength':.15,'severity':'adverse'}
    yield 'perspective_bottom_strong',perspective(src,'bottom',.15),'perspective_vertical_strong',{'angleDeg':0,'perspective':'bottom','strength':.15,'severity':'adverse'}
    yield 'film_glare',film_glare(src,seed),'film_glare',{'severity':'adverse'}

    # Composite adverse conditions: angle is combined with the field conditions
    # most likely to occur during fast pallet receiving.
    x=perspective(rotate(src,-15),'left',.12)
    x=film_glare(x,seed+11)
    yield 'angle_glare_left',x,'angle_glare',{'angleDeg':-15,'perspective':'left','strength':.12,'severity':'worst'}

    x=perspective(rotate(src,15),'right',.12)
    x=ImageEnhance.Brightness(x).enhance(.58)
    yield 'angle_lowlight_right',x,'angle_lowlight',{'angleDeg':15,'perspective':'right','strength':.12,'severity':'worst'}

    x=perspective(src,'top',.14).filter(ImageFilter.GaussianBlur(1.2))
    yield 'angle_blur_top',x,'angle_blur',{'angleDeg':0,'perspective':'top','strength':.14,'severity':'worst'}

    x=resize_roundtrip(src,.40)
    x=perspective(rotate(x,18),'right',.15)
    x=ImageEnhance.Brightness(x).enhance(.60)
    x=film_glare(x,seed+17).filter(ImageFilter.GaussianBlur(.75))
    yield 'harsh_combo',x,'combined_worst',{'angleDeg':18,'perspective':'right','strength':.15,'severity':'worst'}

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
    outdir=Path(args.output_dir)
    outdir.mkdir(parents=True,exist_ok=True)
    rows=[]
    originals=0

    for item in manifest['items']:
        if item['role']!='seed' or item.get('exactDuplicateOf'):
            continue
        zi=bysha.get(item['sha256'])
        if not zi:
            continue
        im=Image.open(BytesIO(z.read(zi)))
        im.load()
        im=ensure_rgb(im)
        originals+=1
        if max(im.size)>args.max_side:
            scale=args.max_side/max(im.size)
            im=im.resize(
                (max(1,int(im.width*scale)),max(1,int(im.height*scale))),
                Image.Resampling.LANCZOS
            )
        source_group='SRC-'+item['sha256'][:12]
        for recipe,img,condition,meta in recipes(im,item['sha256']):
            name=f'{source_group}__{recipe}.jpg'
            img.save(outdir/name,'JPEG',quality=args.jpeg_quality,optimize=True)
            row={
                'sourceGroup':source_group,
                'sourceSha256':item['sha256'],
                'recipe':recipe,
                'condition':condition,
                'file':name,
                'splitConstraint':'same_as_source'
            }
            row.update(meta or {})
            rows.append(row)
    z.close()

    result={
        'schema':'OCR-ROBUSTNESS-AUGMENT-V1',
        'sourceUnique':originals,
        'variantsPerSource':22,
        'variantCount':len(rows),
        'anglePolicy':{
            'bestRotationDeg':[-5,0,5],
            'worstRotationDeg':[-20,-15,15,20],
            'perspectiveDirections':['left','right','top','bottom'],
            'mildPerspectiveStrength':.06,
            'strongPerspectiveStrength':[.15,.16],
            'compositeAngleConditions':['angle_glare','angle_lowlight','angle_blur','combined_worst']
        },
        'warning':'All variants from one source must stay in one train/validation split. Holdout images never enter training.',
        'variants':rows
    }
    Path(args.variants_manifest).write_text(
        json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8'
    )
    print(json.dumps({
        'sourceUnique':originals,
        'variantsPerSource':22,
        'variantCount':len(rows)
    },ensure_ascii=False))

if __name__=='__main__':
    main()
