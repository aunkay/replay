/** Capture the actual chart canvases and vector drawings, with an immutable caption. */
export async function captureChart(caption:string):Promise<Blob> {
 const root=document.querySelector<HTMLElement>('.market-chart');
 if(!root)throw new Error('Chart is not ready');
 const box=root.getBoundingClientRect(),canvas=document.createElement('canvas');
 canvas.width=Math.ceil(box.width);canvas.height=Math.ceil(box.height)+36;
 const context=canvas.getContext('2d')!;context.fillStyle='#101318';context.fillRect(0,0,canvas.width,canvas.height);
 context.fillStyle='#e2e8f0';context.font='12px sans-serif';context.fillText(caption,12,23);
 root.querySelectorAll<HTMLCanvasElement>('canvas').forEach(c=>{const rect=c.getBoundingClientRect();if(rect.width&&rect.height)context.drawImage(c,rect.x-box.x,rect.y-box.y+36,rect.width,rect.height);});
 const drawing=root.querySelector('svg.drawing-layer');
 if(drawing){
  const clone=drawing.cloneNode(true) as SVGSVGElement;clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(box.width));clone.setAttribute('height',String(box.height));
  clone.querySelectorAll('.drawing-hit-shape,.drawing-handle').forEach(e=>e.remove());
  const data=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}),url=URL.createObjectURL(data);
  try{const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Drawing capture failed'));image.src=url;});context.drawImage(image,0,36);}finally{URL.revokeObjectURL(url);}
 }
 root.querySelectorAll<HTMLElement>('.indicator-legend').forEach(legend=>{const rect=legend.getBoundingClientRect();context.fillText(legend.innerText,rect.x-box.x,rect.y-box.y+48);});
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Unable to create chart image')),'image/png'));
}
