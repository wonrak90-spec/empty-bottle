#!/usr/bin/env python3
"""Evaluate field-level OCR accuracy and enforce a Critical Accuracy gate.

Input JSON:
{
  "samples": [
    {
      "id":"...",
      "split":"holdout",
      "source":"wms",
      "condition":"film_glare",
      "truth":{"inboundNo":"...","itemCode":"...","displayQty":"..."},
      "prediction":{"inboundNo":"...","itemCode":"...","displayQty":"..."}
    }
  ]
}
"""
import argparse, json, re, sys
from collections import defaultdict
from pathlib import Path

CRITICAL={'wms':['inboundNo','itemCode','product','displayQty','containerFrom','containerTo'],
          'vendor':['product','qty','palletNo']}

def norm(k,v):
    s=str('' if v is None else v).strip()
    if not s:return ''
    if 'qty' in k.lower():
        try:return str(float(s.replace(',','')).__format__('.12g'))
        except:return re.sub(r'\s+','',s)
    if 'date' in k.lower():
        m=re.search(r'(20\d{2})\D?([01]?\d)\D?([0-3]?\d)',s)
        if m:return f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
    if k.lower().endswith('no') or 'code' in k.lower() or 'container' in k.lower() or 'inbound' in k.lower():
        return re.sub(r'[\s,]','',s).removesuffix('.000')
    return re.sub(r'\s+',' ',s).lower()

def add(bucket,ok):
    bucket[1]+=1
    if ok:bucket[0]+=1

def pct(pair): return round(pair[0]/pair[1]*100,1) if pair[1] else None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--split',default='holdout')
    ap.add_argument('--min-critical',type=float,default=90.0)
    ap.add_argument('--output')
    args=ap.parse_args()
    data=json.loads(Path(args.input).read_text(encoding='utf-8'))
    overall=[0,0];critical=[0,0]
    by_condition=defaultdict(lambda:[0,0]);by_source=defaultdict(lambda:[0,0]);by_field=defaultdict(lambda:[0,0])
    samples=0
    for s in data.get('samples',[]):
        if args.split and str(s.get('split',''))!=args.split: continue
        truth=s.get('truth') or {};pred=s.get('prediction') or {}
        src=str(s.get('source','wms'))
        conditions=s.get('conditions')
        if not isinstance(conditions,list) or not conditions:
            conditions=[str(s.get('condition','unknown'))]
        conditions=[str(x) for x in conditions if str(x).strip()] or ['unknown']
        samples+=1
        for k,t in truth.items():
            # Empty Ground Truth means "not verified / unknown", not an expected blank.
            # Never penalize OCR for a field whose truth was not confirmed.
            if str(t).strip()=='': continue
            ok=norm(k,t)==norm(k,pred.get(k,''))
            add(overall,ok)
            for condition in set(conditions): add(by_condition[condition],ok)
            add(by_source[src],ok);add(by_field[k],ok)
            if k in CRITICAL.get(src,[]):add(critical,ok)
    result={'schema':'OCR-ROBUSTNESS-EVAL-V1','split':args.split,'samples':samples,
            'overallAccuracy':pct(overall),'criticalAccuracy':pct(critical),
            'gate':{'minimumCriticalAccuracy':args.min_critical,
                    'passed':critical[1]>0 and pct(critical)>=args.min_critical},
            'byCondition':{k:pct(v) for k,v in sorted(by_condition.items())},
            'bySource':{k:pct(v) for k,v in sorted(by_source.items())},
            'byField':{k:{'accuracy':pct(v),'correct':v[0],'compared':v[1]} for k,v in sorted(by_field.items())}}
    text=json.dumps(result,ensure_ascii=False,indent=2)
    if args.output:Path(args.output).write_text(text,encoding='utf-8')
    print(text)
    if not result['gate']['passed']:sys.exit(2)
if __name__=='__main__':main()
