#!/usr/bin/env python3
"""Link OCR Robustness manifest images to final inspection values.

The image filename pattern created by the existing backend is:
  <Record UUID>_라벨.<ext>
  <Record UUID>_업체라벨.<ext>

This tool never reads image bytes. It consumes a robustness manifest and a
Records export (CSV/TSV/JSON), then emits a local Ground Truth manifest.

Example:
  python OCR_LEARNING_GROUND_TRUTH_LINK_V1.py \
    --manifest /private/manifest.local.json \
    --records /private/Records.csv \
    --output /private/ground_truth.local.json

Optional manual mapping:
  {
    "KakaoTalk_....jpg": {
      "recordId": "...",
      "source": "wms",
      "truth": {"inboundNo":"...", "displayQty":"..."}
    }
  }
"""
import argparse, csv, json, re
from pathlib import Path

UUID_RE=re.compile(r'^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_(라벨|업체라벨)\.(?:jpe?g|png|webp|bmp|tiff?)$',re.I)

ALIASES={
 'id':['ID','Record ID','recordId'],
 'inboundNo':['입고번호','inboundNo'],
 'inboundDate':['입고일자','inboundDate'],
 'product':['품명','product'],
 'itemCode':['품목코드','itemCode'],
 'manufacturer':['제조원','manufacturer'],
 'supplier':['공급업체','supplier'],
 'displayQty':['표시수량','displayQty'],
 'unit':['단위','unit'],
 'expiryDate':['사용기한','expiryDate'],
 'containerFrom':['용기번호시작','containerFrom'],
 'containerTo':['용기번호종료','containerTo'],
 'vendorProduct':['업체라벨품명','vendorProduct'],
 'vendorQty':['업체라벨수량','vendorQty'],
 'vendorProdDate':['업체생산일자','vendorProdDate'],
 'vendorProdTime':['업체생산시간','vendorProdTime'],
 'vendorLotNo':['업체Lot번호','vendorLotNo'],
 'vendorPalletNo':['업체Pallet번호','업체P/L번호','vendorPalletNo','palletNo'],
 'vendorLine':['업체생산라인','vendorLine']
}
WMS_FIELDS=['inboundNo','inboundDate','product','itemCode','manufacturer','supplier','displayQty','unit','expiryDate','containerFrom','containerTo']
VENDOR_MAP={
 'product':'vendorProduct','qty':'vendorQty','prodDate':'vendorProdDate','prodTime':'vendorProdTime',
 'lotNo':'vendorLotNo','palletNo':'vendorPalletNo','line':'vendorLine'
}

def clean(v): return '' if v is None else str(v).strip()

def load_records(path):
    p=Path(path)
    if p.suffix.lower()=='.json':
        data=json.loads(p.read_text(encoding='utf-8-sig'))
        if isinstance(data,dict):
            data=data.get('records') or data.get('items') or []
        if not isinstance(data,list): raise ValueError('JSON records must be a list')
        rows=[{str(k):v for k,v in r.items()} for r in data]
    else:
        raw=p.read_text(encoding='utf-8-sig',errors='replace')
        dialect=csv.excel_tab if p.suffix.lower()=='.tsv' else csv.excel
        rows=list(csv.DictReader(raw.splitlines(),dialect=dialect))
    return rows

def value(row,key):
    for h in ALIASES[key]:
        if h in row and clean(row[h])!='': return clean(row[h])
    return ''

def record_index(rows):
    out={}
    for r in rows:
        rid=value(r,'id')
        if rid: out[rid]=r
    return out

def truth_for(row,source):
    if source=='vendor':
        out={k:value(row,v) for k,v in VENDOR_MAP.items()}
        # product/qty should not silently fall back to WMS; missing vendor fields
        # remain visible for administrator review.
        return out
    return {k:value(row,k) for k in WMS_FIELDS}

def infer_filename(item):
    return Path(item.get('name') or item.get('relativePath') or '').name

def auto_ref(name):
    m=UUID_RE.match(name)
    if not m:return None
    return {'recordId':m.group(1),'source':'vendor' if m.group(2)=='업체라벨' else 'wms'}

def load_manual(path):
    if not path:return {}
    x=json.loads(Path(path).read_text(encoding='utf-8-sig'))
    return x if isinstance(x,dict) else {}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--manifest',required=True)
    ap.add_argument('--records',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--manual-map')
    args=ap.parse_args()

    manifest=json.loads(Path(args.manifest).read_text(encoding='utf-8-sig'))
    rows=load_records(args.records); idx=record_index(rows); manual=load_manual(args.manual_map)
    out=[]; stats={'uniqueImages':0,'autoFilenameLinked':0,'manualMapped':0,'recordMatched':0,'partialTruth':0,'unresolved':0}

    for item in manifest.get('items',[]):
        if item.get('exactDuplicateOf'):continue
        stats['uniqueImages']+=1
        name=infer_filename(item)
        ref=auto_ref(name)
        origin='filename' if ref else ''
        m=manual.get(name) or manual.get(item.get('sha256',''))
        if m:
            ref={'recordId':clean(m.get('recordId')),'source':clean(m.get('source') or (ref or {}).get('source') or 'wms')}
            origin='manual'
        if ref and origin=='filename':stats['autoFilenameLinked']+=1
        if ref and origin=='manual':stats['manualMapped']+=1

        row=idx.get(ref['recordId']) if ref and ref.get('recordId') else None
        truth={}
        if row:
            truth=truth_for(row,ref['source']);stats['recordMatched']+=1
        if m and isinstance(m.get('truth'),dict):
            truth.update({str(k):clean(v) for k,v in m['truth'].items()})

        expected=VENDOR_MAP.keys() if ref and ref.get('source')=='vendor' else WMS_FIELDS
        missing=[k for k in expected if clean(truth.get(k,''))=='']
        if ref and truth:
            status='linked' if not missing else 'partial'
            if status=='partial':stats['partialTruth']+=1
        else:
            status='needs_review';stats['unresolved']+=1

        out.append({
          'sha256':item.get('sha256',''),'set':item.get('set',''),'role':item.get('role',''),
          'name':name,'nearGroup':item.get('nearGroup'),'recordId':(ref or {}).get('recordId',''),
          'source':(ref or {}).get('source',''),'linkOrigin':origin,'groundTruthStatus':status,
          'truth':truth,'missingFields':missing if ref else [],'conditions':item.get('conditions',[])
        })

    result={'schema':'OCR-GROUND-TRUTH-LINK-V1','summary':stats,'items':out}
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(stats,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
