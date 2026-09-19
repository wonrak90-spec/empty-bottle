import csv, json, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TOOL=ROOT/'OCR_LEARNING_GROUND_TRUTH_LINK_V1.py'

def main():
    with tempfile.TemporaryDirectory() as td:
        td=Path(td)
        rid='eb63a50c-16ef-401e-a8b6-e646c4153fed'
        deleted_rid='35a62740-06ac-4249-a478-8e6d71fcfd70'
        manifest={
          'items':[
            {'sha256':'a','set':'SEED','role':'seed','name':rid+'_라벨.jpeg','exactDuplicateOf':None},
            {'sha256':'b','set':'SEED','role':'seed','name':rid+'_업체라벨.jpeg','exactDuplicateOf':None},
            {'sha256':'c','set':'SEED','role':'seed','name':'KakaoTalk_x.jpg','exactDuplicateOf':None},
            {'sha256':'e','set':'SEED','role':'seed','name':deleted_rid+'_라벨.jpeg','exactDuplicateOf':None},
            {'sha256':'d','set':'SEED','role':'seed','name':'duplicate.jpg','exactDuplicateOf':'a'}
          ]
        }
        (td/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
        headers=['ID','입고번호','입고일자','품명','품목코드','제조원','공급업체','표시수량','단위','사용기한','용기번호시작','용기번호종료',
                 '업체라벨품명','업체라벨수량','업체생산일자','업체생산시간','업체Lot번호','업체Pallet번호','업체생산라인']
        with (td/'records.csv').open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=headers);w.writeheader();w.writerow({
              'ID':rid,'입고번호':'26001','입고일자':'2026-09-18','품명':'A병','품목코드':'A100','제조원':'KC','공급업체':'공급A',
              '표시수량':'13608','단위':'EA','사용기한':'2027-09-18','용기번호시작':'001','용기번호종료':'010',
              '업체라벨품명':'A병','업체라벨수량':'13608','업체생산일자':'2026-09-17','업체생산시간':'08:30',
              '업체Lot번호':'LOT1','업체Pallet번호':'P12','업체생산라인':'2'
            })
        deleted=[{
          'Record ID':deleted_rid,
          'Record JSON':json.dumps({
            'ID':deleted_rid,'입고번호':'26009999','입고일자':'2026-09-18','품명':'삭제테스트병',
            '품목코드':'D100','제조원':'삭제제조','공급업체':'삭제공급','표시수량':'999',
            '단위':'EA','사용기한':'2027-09-18','용기번호시작':'005','용기번호종료':'006'
          },ensure_ascii=False)
        }]
        with (td/'deleted.csv').open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['Record ID','Record JSON']);w.writeheader();w.writerows(deleted)
        manual={'KakaoTalk_x.jpg':{'recordId':rid,'source':'wms','truth':{'containerFrom':'999'}}}
        (td/'manual.json').write_text(json.dumps(manual,ensure_ascii=False),encoding='utf-8')

        p=subprocess.run([sys.executable,str(TOOL),'--manifest',str(td/'manifest.json'),'--records',str(td/'records.csv'),
                          '--deleted-records',str(td/'deleted.csv'),'--manual-map',str(td/'manual.json'),
                          '--output',str(td/'out.json')],text=True,capture_output=True)
        assert p.returncode==0,p.stderr
        out=json.loads((td/'out.json').read_text(encoding='utf-8'))
        assert out['summary']['uniqueImages']==4,out
        assert out['summary']['autoFilenameLinked']==3,out
        assert out['summary']['manualMapped']==1,out
        wms=out['items'][0];vendor=out['items'][1];manual_row=out['items'][2];deleted_row=out['items'][3]
        assert wms['recordId']==rid and wms['source']=='wms'
        assert wms['truth']['displayQty']=='13608'
        assert wms['truthConfidence']=='CURRENT_RECORD'
        assert wms['eligibleForOfficialDataset'] is True
        assert vendor['source']=='vendor' and vendor['truth']['palletNo']=='P12'
        assert vendor['groundTruthStatus']=='linked'
        assert manual_row['linkOrigin']=='manual'
        assert manual_row['truth']['containerFrom']=='999'
        assert manual_row['truthConfidence']=='MANUAL_REVIEWED'
        assert deleted_row['truth']['displayQty']=='999'
        assert deleted_row['truthConfidence']=='DELETED_RECORD_REFERENCE'
        assert deleted_row['eligibleForOfficialDataset'] is False
        assert out['summary']['deletedRecordCandidate']==1,out
        print('PASS Ground Truth current/manual/deleted confidence linker')

if __name__=='__main__':main()
