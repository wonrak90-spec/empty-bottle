import json, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVAL=ROOT/'OCR_LEARNING_ROBUSTNESS_EVAL_V1.py'

def run_case(pred2):
    data={
      'samples':[
        {'id':'A','split':'holdout','source':'wms','condition':'perspective_left_strong',
         'truth':{'inboundNo':'26001','itemCode':'A100','product':'병A','displayQty':'13,608.000','containerFrom':'001','containerTo':''},
         'prediction':{'inboundNo':'26001','itemCode':'A100','product':'병A','displayQty':'13608','containerFrom':'001','containerTo':'999'}},
        {'id':'B','split':'holdout','source':'wms','condition':'angle_glare',
         'truth':{'inboundNo':'26002','itemCode':'B200','product':'병B','displayQty':'10000','containerFrom':'002'},
         'prediction':pred2}
      ]
    }
    with tempfile.TemporaryDirectory() as td:
        p=Path(td)/'case.json';p.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
        return subprocess.run([sys.executable,str(EVAL),'--input',str(p),'--split','holdout','--min-critical','90'],
                              text=True,capture_output=True)

def main():
    pass90=run_case({'inboundNo':'26002','itemCode':'B200','product':'병B','displayQty':'10000','containerFrom':'999'})
    assert pass90.returncode==0,pass90.stderr+pass90.stdout
    result=json.loads(pass90.stdout)
    assert result['criticalAccuracy']==90.0,result
    assert result['byField'].get('containerTo') is None,result
    assert result['gate']['passed'] is True,result
    assert 'perspective_left_strong' in result['byCondition'],result
    assert 'angle_glare' in result['byCondition'],result

    fail80=run_case({'inboundNo':'26002','itemCode':'B200','product':'WRONG','displayQty':'10000','containerFrom':'999'})
    assert fail80.returncode==2,fail80.stderr+fail80.stdout
    result=json.loads(fail80.stdout)
    assert result['criticalAccuracy']==80.0,result
    assert result['gate']['passed'] is False,result
    print('PASS OCR robustness Critical Accuracy 90% gate')

if __name__=='__main__':main()
