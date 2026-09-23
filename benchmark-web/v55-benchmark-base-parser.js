(function(){
  'use strict';
  function fixDigits(s){return String(s||'').replace(/[OoDQ]/g,'0').replace(/[lIi|]/g,'1').replace(/[Ss]/g,'5').replace(/[Bb]/g,'8').replace(/[Zz]/g,'2').replace(/[gq]/g,'9').replace(/[Tt]/g,'7');}
  function validDate(y,m,d){y=Number(y);m=Number(m);d=Number(d);if(!(y>=2000&&y<=2099&&m>=1&&m<=12&&d>=1&&d<=31))return '';const dt=new Date(y,m-1,d);if(dt.getFullYear()!==y||dt.getMonth()!==m-1||dt.getDate()!==d)return '';return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
  function normalizeDate(v){const s=String(v||'').trim();if(!s)return '';let m=s.match(/([0-9]{4})\D{1,3}([0-9]{1,2})\D{1,3}([0-9]{1,2})/);if(m)return validDate(m[1],m[2],m[3]);m=s.match(/(?:^|\D)([0-9]{2})\D{1,3}([0-9]{1,2})\D{1,3}([0-9]{1,2})(?!\d)/);if(m)return validDate('20'+m[1],m[2],m[3]);const d8=fixDigits(s).replace(/[^0-9]/g,'');if(d8.length===8)return validDate(d8.slice(0,4),d8.slice(4,6),d8.slice(6,8));return '';}
  const WMS_LABELS=[
    {key:'inboundNo',pat:'입\\s*고\\s*번\\s*호'},{key:'itemCode',pat:'품\\s*목\\s*코\\s*드|자\\s*재\\s*코\\s*드'},{key:'product',pat:'품\\s*명|자\\s*재\\s*명'},
    {key:'qty',pat:'수\\s*량|수'},{key:'manufacturer',pat:'제\\s*조\\s*원|제\\s*조\\s*사'},{key:'supplier',pat:'공\\s*급\\s*업\\s*체|거\\s*래\\s*처|납\\s*품\\s*처'},
    {key:'inboundDate',pat:'입\\s*고\\s*일\\s*자|입\\s*고\\s*일'},{key:'expiryDate',pat:'사\\s*용\\s*기\\s*한|유\\s*효\\s*기\\s*한|유\\s*통\\s*기\\s*한'},
    {key:'containerNo',pat:'용\\s*기\\s*번\\s*호'},{key:'warehouse',pat:'공\\s*병\\s*창\\s*고'}
  ];
  const VENDOR_LABELS=[
    {key:'qty',pat:'1\\s*P\\s*T\\s*수\\s*량|포\\s*장\\s*사\\s*양|수\\s*량|수'},{key:'product',pat:'제\\s*품\\s*명|품\\s*명'},{key:'spec',pat:'규\\s*격'},
    {key:'prodDate',pat:'생\\s*산\\s*일\\s*자|제\\s*조\\s*일\\s*자|생\\s*산\\s*일|제\\s*조\\s*일'},{key:'time',pat:'시\\s*간'},
    {key:'palletNo',pat:'P\\s*[/.-]?\\s*(?:N\\s*O\\.?|번\\s*호)|P\\s*A\\s*L\\s*L\\s*E\\s*T\\s*(?:N\\s*O\\.?|번\\s*호)?|파\\s*레\\s*트\\s*(?:N\\s*O\\.?|번\\s*호)?|팔\\s*레\\s*트\\s*(?:N\\s*O\\.?|번\\s*호)?'},
    {key:'lotNo',pat:'라\\s*인\\s*[/·]\\s*L\\s*o\\s*t\\s*N\\s*o\\.?|L\\s*o\\s*t\\s*N\\s*o\\.?|P\\s*/\\s*L\\s*N\\s*o\\.?|로\\s*트\\s*번\\s*호|제\\s*조\\s*번\\s*호'},
    {key:'line',pat:'생\\s*산\\s*라\\s*인|라\\s*인'},{key:'maker',pat:'제\\s*조\\s*회\\s*사|제\\s*조\\s*원'},{key:'producer',pat:'생\\s*산\\s*자|생\\s*산\\s*Q\\s*/?\\s*C'},
    {key:'packer',pat:'포\\s*장\\s*자'},{key:'inspector',pat:'검\\s*사\\s*자'},{key:'deliverTo',pat:'납\\s*품\\s*처'},{key:'color',pat:'색\\s*상'},{key:'note',pat:'비\\s*고'},{key:'judge',pat:'판\\s*정'}
  ];
  function labelKeyOf(text,pats){for(const p of pats)if(new RegExp('^(?:'+p.pat+')$','i').test(text))return p.key;return null;}
  function segmentByLabels(raw,labels){
    const t=String(raw||'').replace(/[：﹕]/g,':').replace(/[|｜]/g,' ').replace(/\s+/g,' ').trim();if(!t)return {};
    const pats=labels.slice().sort((a,b)=>b.pat.length-a.pat.length),union=pats.map(l=>'(?:'+l.pat+')').join('|'),re=new RegExp('('+union+')\\s*[:\\-]?\\s*','gi');
    const hits=[],KO=/[가-힣]/;let m;
    while((m=re.exec(t))!==null){const key=labelKeyOf(m[1],pats),prev=m.index>0?t[m.index-1]:' ',after=t[m.index+m[1].length],buried=KO.test(prev)||(after!==undefined&&KO.test(after)&&!/\s/.test(after));if(key&&!buried)hits.push({key,start:m.index,end:m.index+m[0].length});if(re.lastIndex===m.index)re.lastIndex++;}
    const out={};for(let i=0;i<hits.length;i++){const h=hits[i],stop=i+1<hits.length?hits[i+1].start:t.length,val=t.slice(h.end,stop).trim();if(val&&!out[h.key])out[h.key]=val;}return out;
  }
  function firstMatch(text,re){const m=String(text||'').match(re);return m?(m[1]!==undefined?m[1]:m[0]).trim():'';}
  function cleanText(v){return String(v||'').replace(/\s*[0-9]{2,4}-[0-9]{3,4}-[0-9]{4}.*$/,'').replace(/\s*(공\s*병\s*창\s*고|TEL|Tel|전화).*$/i,'').replace(/[:\-]\s*$/,'').trim();}
  function parseLabelText(raw){
    const g=segmentByLabels(raw,WMS_LABELS),out={};out.inboundNo=firstMatch(g.inboundNo,/([0-9]{5,})/);out.product=cleanText(g.product);out.itemCode=firstMatch(g.itemCode,/([A-Za-z0-9\-]{3,})/);
    const q=firstMatch(g.qty,/([0-9][0-9,]*(?:\.[0-9]+)?)/);if(q){const n=Number(fixDigits(q).replace(/,/g,''));if(n>0)out.displayQty=String(n);}
    const u=firstMatch(g.qty,/(?:[0-9,.]+)\s*(EA|개|본|BOX|박스)/i);if(u)out.unit=u.toUpperCase()==='EA'?'EA':u;
    out.manufacturer=cleanText(g.manufacturer);out.supplier=cleanText(g.supplier);out.inboundDate=normalizeDate(g.inboundDate);out.expiryDate=normalizeDate(g.expiryDate);
    if(g.containerNo){const c=g.containerNo.match(/([0-9]{2,8})\s*[\/～~\-]\s*([0-9]{2,8})/);if(c){out.containerFrom=c[1];out.containerTo=c[2];}else{const c1=g.containerNo.match(/([0-9]{2,8})/);if(c1)out.containerFrom=c1[1];}}
    const code=String(raw||'').match(/(?<!\d)([0-9]{6,12}-[0-9]{3,8})(?!\d)/);if(code){out.codeRaw=code[1];if(!out.inboundNo)out.inboundNo=code[1].split('-')[0];if(!out.containerFrom)out.containerFrom=code[1].split('-')[1];}
    return out;
  }
  function parseVendorLabel(raw){
    const g=segmentByLabels(raw,VENDOR_LABELS),out={};out.product=cleanText(g.product);const spec=cleanText(g.spec);if(spec&&out.product&&out.product.indexOf(spec)===-1)out.product=(out.product+' '+spec).trim();
    let qtyRaw=g.qty||g.packSpec||'',qty='';const eq=qtyRaw.match(/[=:]\s*([0-9][0-9,]{2,})/);if(eq)qty=eq[1];if(!qty){const all=qtyRaw.match(/[0-9][0-9,]{2,}/g)||[];if(all.length)qty=all.sort((a,b)=>Number(b.replace(/,/g,''))-Number(a.replace(/,/g,'')))[0];}
    if(qty){const n=Number(fixDigits(qty).replace(/,/g,''));if(n>0)out.qty=String(n);}
    const dtText=[g.prodDate,g.time].filter(Boolean).join(' ');if(dtText){out.prodDate=normalizeDate(dtText);const tm=dtText.match(/([0-9]{1,2})\s*[:시]\s*([0-9]{1,2})/);if(tm){const hh=Number(tm[1]),mi=Number(tm[2]);if(hh>=0&&hh<=23&&mi>=0&&mi<=59)out.prodTime=String(hh).padStart(2,'0')+':'+String(mi).padStart(2,'0');}}
    if(g.lotNo){const pair=g.lotNo.match(/^([A-Za-z0-9]{1,4})\s*[\/]\s*([A-Za-z0-9\-]{1,10})/);if(pair){out.line=pair[1];out.lotNo=pair[2];}else out.lotNo=firstMatch(g.lotNo,/([A-Za-z0-9\-]{2,})/);}
    if(!out.line)out.line=cleanText(g.line);if(g.palletNo)out.palletNo=firstMatch(g.palletNo,/([A-Za-z0-9][A-Za-z0-9_.\/-]{0,20})/);out.maker=cleanText(g.maker)||cleanText(g.producer);out.deliverTo=cleanText(g.deliverTo);return out;
  }
  window.fixDigits=fixDigits;window.normalizeDate=normalizeDate;window.parseLabelText=parseLabelText;window.parseVendorLabel=parseVendorLabel;
})();