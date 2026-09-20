/* V55 ROI / Perspective Preprocess V1
 * Benchmark-only image recovery layer.
 * Uses OCR box geometry only; never uses Ground Truth.
 */
(function(){
  'use strict';
  if(window.__V55_ROI_PREPROCESS__)return;
  window.__V55_ROI_PREPROCESS__=true;

  const R=window.V55RoiPreprocess={VERSION:'V55-ROI-PREPROCESS-2'};

  function point(p){
    if(Array.isArray(p))return {x:Number(p[0])||0,y:Number(p[1])||0};
    return {x:Number(p&&p.x)||0,y:Number(p&&p.y)||0};
  }
  function polyBox(poly){
    const pts=(Array.isArray(poly)?poly:[]).map(point);
    if(!pts.length)return null;
    const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
    return {x1:Math.min(...xs),y1:Math.min(...ys),x2:Math.max(...xs),y2:Math.max(...ys),
      cx:(Math.min(...xs)+Math.max(...xs))/2,cy:(Math.min(...ys)+Math.max(...ys))/2,
      w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),pts};
  }
  function loadImage(dataUrl){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('ROI image load failed'));
      img.src=dataUrl;
    });
  }
  function ocrScale(iw,ih){
    const long=Math.max(iw,ih),limit=2300;
    let scale=Math.min(1,limit/Math.max(1,long));
    if(long<1500){
      const target=Math.min(limit,1600);
      scale=Math.min(2.4,Math.max(1,target/Math.max(1,long)));
    }
    return scale;
  }
  function itemBoxes(items,iw,ih){
    const s=ocrScale(iw,ih);
    return (items||[]).filter(it=>it&&String(it.text||'').trim()&&(Number(it.score)||0)>=0.18)
      .map(it=>{
        const b=polyBox(it.poly); if(!b)return null;
        return {text:String(it.text||'').trim(),score:Number(it.score)||0,
          x1:b.x1/s,y1:b.y1/s,x2:b.x2/s,y2:b.y2/s,
          cx:b.cx/s,cy:b.cy/s,w:b.w/s,h:b.h/s,
          pts:b.pts.map(p=>({x:p.x/s,y:p.y/s}))};
      }).filter(Boolean);
  }
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function unionBounds(boxes,iw,ih,padX,padY){
    if(!boxes||boxes.length<2)return null;
    let x1=Math.min(...boxes.map(b=>b.x1)),y1=Math.min(...boxes.map(b=>b.y1));
    let x2=Math.max(...boxes.map(b=>b.x2)),y2=Math.max(...boxes.map(b=>b.y2));
    const w=x2-x1,h=y2-y1;
    if(w<40||h<25)return null;
    x1=clamp(x1-w*(padX??.12),0,iw);x2=clamp(x2+w*(padX??.12),0,iw);
    y1=clamp(y1-h*(padY??.18),0,ih);y2=clamp(y2+h*(padY??.18),0,ih);
    return {x:x1,y:y1,w:x2-x1,h:y2-y1};
  }
  async function cropRect(dataUrl,rect,targetLong,filter){
    const img=await loadImage(dataUrl),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const x=clamp(rect.x,0,iw-1),y=clamp(rect.y,0,ih-1);
    const w=clamp(rect.w,1,iw-x),h=clamp(rect.h,1,ih-y);
    const long=Math.max(w,h),scale=Math.min(3.2,Math.max(1,(targetLong||2100)/Math.max(1,long)));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    try{if(filter)ctx.filter=filter;}catch(_){}
    ctx.drawImage(img,x,y,w,h,0,0,c.width,c.height);
    try{ctx.filter='none';}catch(_){}
    return {dataUrl:c.toDataURL('image/jpeg',.93),rect:{x,y,w,h},scale};
  }

  function otsuThreshold(gray){
    const hist=new Array(256).fill(0);
    for(const v of gray)hist[v]++;
    const total=gray.length;
    let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
    let sumB=0,wB=0,best=127,maxVar=-1;
    for(let t=0;t<256;t++){
      wB+=hist[t]; if(!wB)continue;
      const wF=total-wB; if(!wF)break;
      sumB+=t*hist[t];
      const mB=sumB/wB,mF=(sum-sumB)/wF;
      const between=wB*wF*(mB-mF)*(mB-mF);
      if(between>maxVar){maxVar=between;best=t;}
    }
    return best;
  }

  async function thresholdCrop(dataUrl,rect,targetLong){
    const img=await loadImage(dataUrl),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const x=clamp(rect.x,0,iw-1),y=clamp(rect.y,0,ih-1);
    const w=clamp(rect.w,1,iw-x),h=clamp(rect.h,1,ih-y);
    const long=Math.max(w,h),scale=Math.min(3.2,Math.max(1,(targetLong||1900)/Math.max(1,long)));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));
    const ctx=c.getContext('2d',{alpha:false,willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(img,x,y,w,h,0,0,c.width,c.height);
    const im=ctx.getImageData(0,0,c.width,c.height),d=im.data,gray=new Uint8Array(c.width*c.height);
    for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=Math.round(d[i]*.299+d[i+1]*.587+d[i+2]*.114);
    let t=otsuThreshold(gray);
    // Slightly darker threshold protects thin printed strokes under glare.
    t=Math.max(70,Math.min(210,t-8));
    for(let i=0,j=0;i<d.length;i+=4,j++){
      const v=gray[j]<t?0:255;
      d[i]=v;d[i+1]=v;d[i+2]=v;d[i+3]=255;
    }
    ctx.putImageData(im,0,0);
    return {dataUrl:c.toDataURL('image/png'),rect:{x,y,w,h},scale,threshold:t};
  }

  R.clusterCrop=async function(dataUrl,items){
    const img=await loadImage(dataUrl),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const boxes=itemBoxes(items,iw,ih);
    if(boxes.length<2)return null;
    const b=unionBounds(boxes,iw,ih,.13,.20);
    if(!b)return null;
    const ratio=(b.w*b.h)/(iw*ih);
    if(ratio>.92)return null;
    return {...await cropRect(dataUrl,b,2200,'contrast(1.08) brightness(1.02)'),kind:'cluster_roi',boxCount:boxes.length,areaRatio:ratio};
  };

  function rowGroups(boxes){
    const rows=[];
    for(const it of boxes.sort((a,b)=>a.cy-b.cy||a.x1-b.x1)){
      let r=rows.find(z=>Math.abs(z.cy-it.cy)<=Math.max(12,Math.max(z.h,it.h)*.8));
      if(!r){r={cy:it.cy,h:it.h,items:[]};rows.push(r);}
      r.items.push(it);r.h=Math.max(r.h,it.h);
      r.cy=r.items.reduce((s,x)=>s+x.cy,0)/r.items.length;
    }
    return rows.sort((a,b)=>a.cy-b.cy).map(r=>{r.items.sort((a,b)=>a.x1-b.x1);r.text=r.items.map(x=>x.text).join(' ');return r;});
  }

  function fieldRectFromItems(items,iw,ih,type,field){
    const boxes=itemBoxes(items,iw,ih);
    if(!boxes.length)return null;
    const rows=rowGroups(boxes);
    let re=null;
    if(type==='vendor'&&field==='palletNo')re=/P\s*[/\-]?\s*(?:L\s*)?(?:No\.?|번\s*호)?|P\s*[-/]\s*번호/i;
    if(type==='wms'&&field==='inboundNo')re=/입\s*고\s*번\s*호/i;
    if(!re)return null;

    let row=rows.find(r=>re.test(r.text));
    if(!row){
      row=rows.find(r=>type==='vendor'?/P\s*[/\-]|번\s*호|No\.?/i.test(r.text):/입\s*고|번\s*호/.test(r.text));
    }
    if(!row)return null;

    const x1=Math.min(...row.items.map(x=>x.x1)),x2=Math.max(...row.items.map(x=>x.x2));
    const y1=Math.min(...row.items.map(x=>x.y1)),y2=Math.max(...row.items.map(x=>x.y2));
    const rw=Math.max(80,x2-x1),rh=Math.max(20,y2-y1);

    // WMS first row can be partly hidden by film glare; keep more right-side
    // context. Vendor P/L rows stay tighter to avoid packaging formula numbers.
    const widthFactor=type==='wms'?2.10:1.45;
    const rect={
      x:Math.max(0,x1-rw*.12),
      y:Math.max(0,y1-rh*.85),
      w:Math.min(iw,rw*widthFactor),
      h:Math.min(ih,rh*2.7)
    };
    if(rect.x+rect.w>iw)rect.w=iw-rect.x;
    if(rect.y+rect.h>ih)rect.h=ih-rect.y;
    return {rect,rowText:row.text};
  }

  R.fieldStripVariants=async function(dataUrl,items,type,field){
    const img=await loadImage(dataUrl),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const fr=fieldRectFromItems(items,iw,ih,type,field);
    if(!fr)return [];
    const contrast=await cropRect(dataUrl,fr.rect,2000,'grayscale(1) contrast(1.42) brightness(1.04)');
    const binary=await thresholdCrop(dataUrl,fr.rect,2000);
    return [
      {...contrast,kind:'field_roi_contrast',field,rowText:fr.rowText},
      {...binary,kind:'field_roi_binary',field,rowText:fr.rowText}
    ];
  };

  R.fieldStrip=async function(dataUrl,items,type,field){
    const variants=await R.fieldStripVariants(dataUrl,items,type,field);
    return variants[0]||null;
  };

  function quadFromBoxes(boxes){
    const pts=[];
    for(const b of boxes)for(const p of b.pts)pts.push(p);
    if(pts.length<8)return null;
    const tl=pts.reduce((a,p)=>p.x+p.y<a.x+a.y?p:a,pts[0]);
    const br=pts.reduce((a,p)=>p.x+p.y>a.x+a.y?p:a,pts[0]);
    const tr=pts.reduce((a,p)=>p.x-p.y>a.x-a.y?p:a,pts[0]);
    const bl=pts.reduce((a,p)=>p.x-p.y<a.x-a.y?p:a,pts[0]);
    const area=Math.abs(
      tl.x*tr.y+tr.x*br.y+br.x*bl.y+bl.x*tl.y-
      tl.y*tr.x-tr.y*br.x-br.y*bl.x-bl.y*tl.x
    )/2;
    if(area<2000)return null;
    return [tl,tr,br,bl];
  }
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
  function solveLinear(A,b){
    const n=b.length,M=A.map((r,i)=>r.slice().concat([b[i]]));
    for(let col=0;col<n;col++){
      let pivot=col;
      for(let r=col+1;r<n;r++)if(Math.abs(M[r][col])>Math.abs(M[pivot][col]))pivot=r;
      if(Math.abs(M[pivot][col])<1e-9)return null;
      [M[col],M[pivot]]=[M[pivot],M[col]];
      const d=M[col][col];for(let j=col;j<=n;j++)M[col][j]/=d;
      for(let r=0;r<n;r++){if(r===col)continue;const f=M[r][col];for(let j=col;j<=n;j++)M[r][j]-=f*M[col][j];}
    }
    return M.map(r=>r[n]);
  }
  function homographyDstToSrc(src,w,h){
    const dst=[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}];
    const A=[],b=[];
    for(let i=0;i<4;i++){
      const u=dst[i].x,v=dst[i].y,x=src[i].x,y=src[i].y;
      A.push([u,v,1,0,0,0,-u*x,-v*x]);b.push(x);
      A.push([0,0,0,u,v,1,-u*y,-v*y]);b.push(y);
    }
    return solveLinear(A,b);
  }
  function perspectiveStrength(q){
    if(!q)return 0;
    const top=dist(q[0],q[1]),bottom=dist(q[3],q[2]),left=dist(q[0],q[3]),right=dist(q[1],q[2]);
    const hr=Math.max(top,bottom)/Math.max(1,Math.min(top,bottom));
    const vr=Math.max(left,right)/Math.max(1,Math.min(left,right));
    return Math.max(hr,vr);
  }

  R.perspectiveCrop=async function(dataUrl,items){
    const img=await loadImage(dataUrl),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const boxes=itemBoxes(items,iw,ih);
    if(boxes.length<4)return null;
    let q=quadFromBoxes(boxes);
    if(!q)return null;
    const strength=perspectiveStrength(q);
    if(strength<1.18)return null;

    // Expand quad slightly around centroid so text is not clipped.
    const cx=q.reduce((s,p)=>s+p.x,0)/4,cy=q.reduce((s,p)=>s+p.y,0)/4;
    q=q.map(p=>({x:clamp(cx+(p.x-cx)*1.10,0,iw-1),y:clamp(cy+(p.y-cy)*1.16,0,ih-1)}));

    const workScale=Math.min(1,2100/Math.max(iw,ih));
    const wc=document.createElement('canvas');wc.width=Math.max(1,Math.round(iw*workScale));wc.height=Math.max(1,Math.round(ih*workScale));
    const wctx=wc.getContext('2d',{alpha:false,willReadFrequently:true});
    wctx.fillStyle='#fff';wctx.fillRect(0,0,wc.width,wc.height);wctx.drawImage(img,0,0,wc.width,wc.height);
    const srcq=q.map(p=>({x:p.x*workScale,y:p.y*workScale}));

    const ow0=(dist(srcq[0],srcq[1])+dist(srcq[3],srcq[2]))/2;
    const oh0=(dist(srcq[0],srcq[3])+dist(srcq[1],srcq[2]))/2;
    const scale=Math.min(2.4,Math.max(1,1800/Math.max(ow0,oh0)));
    const ow=Math.max(80,Math.min(2000,Math.round(ow0*scale)));
    const oh=Math.max(60,Math.min(1600,Math.round(oh0*scale)));
    const H=homographyDstToSrc(srcq,ow,oh);
    if(!H)return null;

    const src=wctx.getImageData(0,0,wc.width,wc.height),sd=src.data;
    const oc=document.createElement('canvas');oc.width=ow;oc.height=oh;
    const octx=oc.getContext('2d',{alpha:false});
    const out=octx.createImageData(ow,oh),od=out.data;
    const [a,b,c,d,e,f,g,h]=H;
    for(let y=0;y<oh;y++){
      for(let x=0;x<ow;x++){
        const den=g*x+h*y+1;
        const sx=(a*x+b*y+c)/den,sy=(d*x+e*y+f)/den;
        const ix=Math.round(sx),iy=Math.round(sy),di=(y*ow+x)*4;
        if(ix>=0&&iy>=0&&ix<wc.width&&iy<wc.height){
          const si=(iy*wc.width+ix)*4;
          od[di]=sd[si];od[di+1]=sd[si+1];od[di+2]=sd[si+2];od[di+3]=255;
        }else{od[di]=255;od[di+1]=255;od[di+2]=255;od[di+3]=255;}
      }
    }
    octx.putImageData(out,0,0);
    return {dataUrl:oc.toDataURL('image/jpeg',.93),kind:'perspective_roi',strength,width:ow,height:oh};
  };

  R._test={polyBox,ocrScale,unionBounds,quadFromBoxes,perspectiveStrength,solveLinear,homographyDstToSrc,otsuThreshold};
  console.info('[V55-ROI-PREPROCESS-2] dual target ROI + crop recovery ready');
})();