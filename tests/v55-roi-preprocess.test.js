const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-roi-preprocess.js','utf8');
const ctx={console,window:null};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-roi-preprocess.js'});

const R=ctx.V55RoiPreprocess;
assert.ok(R,'V55RoiPreprocess must be exposed');
assert.strictEqual(R.VERSION,'V55-ROI-PREPROCESS-3.1');

assert.strictEqual(R._test.ocrScale(1000,800),1.6);
assert.strictEqual(R._test.ocrScale(3000,2000),2300/3000);

const boxes=[
  {x1:100,y1:100,x2:300,y2:160,pts:[{x:100,y:100},{x:300,y:100},{x:300,y:160},{x:100,y:160}]},
  {x1:120,y1:220,x2:320,y2:280,pts:[{x:120,y:220},{x:320,y:220},{x:320,y:280},{x:120,y:280}]}
];
const ub=R._test.unionBounds(boxes,1000,800,.1,.1);
assert.ok(ub&&ub.w>200&&ub.h>180,'union bounds must include padding');

const q=R._test.quadFromBoxes(boxes);
assert.ok(q&&q.length===4,'quad recovery failed');
assert.ok(R._test.perspectiveStrength(q)>=1,'perspective strength invalid');

const vendorTarget=R._test.fieldRectFromItems([
  {text:'P/L No.',score:.9,poly:[[10,100],[90,100],[90,120],[10,120]]},
  {text:'43',score:.9,poly:[[130,100],[160,100],[160,120],[130,120]]}
],1000,800,'vendor','palletNo');
assert.ok(vendorTarget&&vendorTarget.rect.h<60,'vendor target crop must stay tight to its row');

const wmsTarget=R._test.fieldRectFromItems([
  {text:'입고번호',score:.9,poly:[[10,20],[90,20],[90,40],[10,40]]}
],1000,800,'wms','inboundNo');
assert.ok(wmsTarget&&wmsTarget.rect.w>=500,'WMS target crop must extend right when value box is missing');
assert.ok(wmsTarget.rect.y>=10&&wmsTarget.rect.y<=20,'WMS inbound crop should stay vertically tight around label row');
assert.ok((wmsTarget.rect.y+wmsTarget.rect.h)<=60,'WMS inbound crop must not drift into distant quantity rows');

const managementTarget=R._test.fieldRectFromItems([
  {text:'관리번호',score:.9,poly:[[10,20],[90,20],[90,40],[10,40]]}
],1000,800,'wms','inboundNo');
assert.ok(managementTarget&&managementTarget.rect.w>=500,'WMS 관리번호 must use the inbound target ROI');

const containerTarget=R._test.fieldRectFromItems([
  {text:'용기번호',score:.9,poly:[[10,620],[90,620],[90,645],[10,645]]},
  {text:'0015 / 0028',score:.9,poly:[[120,620],[260,620],[260,645],[120,645]]}
],1000,800,'wms','containerRange');
assert.ok(containerTarget,'WMS 용기번호 target ROI missing');
assert.ok(containerTarget.rect.w>=500,'WMS container range crop must include both current/total values');
assert.ok(containerTarget.rect.y>580,'container target must stay near the lower label row');

const src=[
  {x:10,y:20},{x:210,y:30},{x:200,y:130},{x:20,y:120}
];
const H=R._test.homographyDstToSrc(src,200,100);
assert.ok(H&&H.length===8,'homography solve failed');
assert.ok(H.every(Number.isFinite),'homography contains invalid values');

const otsu=R._test.otsuThreshold(Uint8Array.from([0,0,10,20,220,240,250,255]));
assert.ok(otsu>=20&&otsu<=240,'Otsu threshold out of expected range: '+otsu);

const sol=R._test.solveLinear([[1,0],[0,1]],[3,4]);
assert.deepStrictEqual(Array.from(sol),[3,4]);

console.log('PASS V55 ROI/perspective preprocessing geometry');
