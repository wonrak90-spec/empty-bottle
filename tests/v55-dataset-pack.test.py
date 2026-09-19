import json, subprocess, sys, tempfile, zipfile, hashlib
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
TOOL=ROOT/'OCR_LEARNING_DATASET_PACK_V1.py'

def h(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
    with tempfile.TemporaryDirectory() as td:
        td=Path(td)
        orig=td/'orig';aug=td/'aug';hold=td/'hold'
        orig.mkdir();aug.mkdir();hold.mkdir()
        Image.new('RGB',(20,20),'white').save(orig/'a.jpg')
        Image.new('RGB',(20,20),'gray').save(orig/'b.jpg')
        Image.new('RGB',(20,20),'black').save(aug/'a__rot.jpg')
        Image.new('RGB',(20,20),'blue').save(aug/'b__blur.jpg')
        Image.new('RGB',(20,20),'red').save(hold/'field.jpg')
        originals=[
          {'file':'a.jpg','dataset_split':'train','source_group':'G1','sha256':h(orig/'a.jpg'),'verified':True,'fields':{'label_type':'wms','inboundNo':'1'}},
          {'file':'b.jpg','dataset_split':'validation','source_group':'G2','sha256':h(orig/'b.jpg'),'verified':True,'fields':{'label_type':'vendor','qty':'10'}}
        ]
        variants=[
          {'file':'a__rot.jpg','dataset_split':'train','source_group':'G1','source_file':'a.jpg','augmentation':'rotation','fields':originals[0]['fields']},
          {'file':'b__blur.jpg','dataset_split':'validation','source_group':'G2','source_file':'b.jpg','augmentation':'blur','fields':originals[1]['fields']}
        ]
        (td/'o.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in originals),encoding='utf-8')
        (td/'a.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in variants),encoding='utf-8')
        out=td/'dataset.zip'
        p=subprocess.run([sys.executable,str(TOOL),'--labels-original',str(td/'o.jsonl'),'--labels-augmented',str(td/'a.jsonl'),
                          '--original-dir',str(orig),'--augmented-dir',str(aug),'--final-holdout-dir',str(hold),'--output',str(out)],
                         text=True,capture_output=True)
        assert p.returncode==0,p.stderr+p.stdout
        with zipfile.ZipFile(out) as z:
            names=set(z.namelist())
            assert 'originals/train/a.jpg' in names
            assert 'originals/validation/b.jpg' in names
            assert 'augmented/train/a__rot.jpg' in names
            assert 'augmented/validation/b__blur.jpg' in names
            assert 'final_holdout_unlabeled/field.jpg' in names
            s=json.loads(z.read('dataset_summary.json'))
            assert s['trainOriginals']==1 and s['validationOriginals']==1
            assert s['finalHoldout']==1
        print('PASS private dataset packager and split isolation')

if __name__=='__main__':main()
