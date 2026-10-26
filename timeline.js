const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round = n => Math.round(n * 1000) / 1000;
export const length = s => Number(s.duration ?? ((s.out ?? 3) - (s.in ?? 0)));
export const timelineHtml = () => `<div class="timeline-scroll"><div class="timeline" aria-label="動画のタイムライン"><div class="timeline-clips"></div><div class="timeline-selection" hidden><button type="button" class="trim-handle start" aria-label="開始位置"><span></span><small></small></button><button type="button" class="trim-handle end" aria-label="終了位置"><span></span><small></small></button></div><i class="playhead" aria-hidden="true"></i></div></div>`;

// Ranges stay provisional until another scene is selected or the plan is read.
// This lets Cut remove the highlighted interval, while a plain resize keeps it.
export function mountTimeline(root, job, { video, grabFrame, completed=false, editable=true, onSelect=()=>{}, onChange=()=>{}, onOpen=()=>{} }) {
  let scenes=structuredClone(job.plan.segments), selected=null, range=null, gesture=null, disposed=false;
  const band=root.querySelector('.timeline'), clips=root.querySelector('.timeline-clips');
  const selection=root.querySelector('.timeline-selection'), head=root.querySelector('.playhead');
  const sources=job.files.filter(f=>f.kind==='source'), original=new Map();
  let clock=0;
  job.plan.segments.forEach(s=>{const t=job.timeline?.find(t=>t.id===s.id);original.set(s.id,{...s,start:t?.start ?? clock,renderLength:t?.len ?? length(s)});clock+=length(s);});
  const current=()=>scenes.find(s=>s.id===selected);
  const origin=s=>original.get(s.originId || s.id) || s;
  const min=()=>0;
  const max=s=>s.src===undefined?60:Number(sources[s.src]?.duration || Math.max(s.out || 0,60));
  const span=s=>Number(s.out ?? ((s.in || 0)+length(s)))-(s.in || 0);
  const rows=()=>{let x=0;const total=scenes.reduce((n,s)=>n+Math.max(96,length(s)*32),0),scale=Math.max(1,(root.querySelector('.timeline-scroll').clientWidth-44)/total);return scenes.map(s=>{const row={s,x,w:Math.max(96,length(s)*32)*scale};x+=row.w;return row;});};
  const rowFor=id=>rows().find(r=>r.s.id===id);
  const position=(s,t)=>{const r=rowFor(s.id);return r.x+(t-(s.in || 0))/span(s)*r.w;};
  const clean=s=>{const {originId,...rest}=s;return {...rest,...(originId?{originId}:{})};};
  function keepRange() {
    const s=current();if(!s||!range||!range.dirty)return;
    s.in=round(range.a);s.out=round(range.b);s.duration=round(range.b-range.a);
    range={a:s.in,b:s.out,dirty:false};
  }
  function seek(s,t) {
    if(!video)return;
    const o=origin(s);
    if(completed){const raw=o.start+(t-(o.in || 0))/Math.max(.001,span(o))*o.renderLength;video.maPlayer.seek(Math.max(o.start,Math.min(o.start+o.renderLength-.02,raw)));}
    else {const url=window.maDemo.file(sources[s.src ?? 0]?.id);if(video.getAttribute('src')!==url)video.src=url;const move=()=>{video.currentTime=Math.max(0,Math.min(t,(video.duration || t+.1)-.02));};if(video.readyState)move();else video.addEventListener('loadedmetadata',move,{once:true});}
    head.style.left=`${position(s,t)}px`;
  }
  function paintRange(){
    const s=current();selection.hidden=!s||!editable;if(!s)return;
    const a=position(s,range.a),b=position(s,range.b);
    selection.style.left=`${a}px`;selection.style.width=`${b-a}px`;
    clips.querySelectorAll('.timeline-clip').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.scene===selected)));
    for(const [side,t] of [['start',range.a],['end',range.b]])selection.querySelector(`.${side} small`).textContent=`${t.toFixed(1)} 秒`;
    // White selection window and dimmed surrounding footage share the same coordinates.
    band.style.setProperty('--selection-start',`${Math.max(0,a)}px`);band.style.setProperty('--selection-end',`${Math.max(0,b)}px`);
  }
  function select(id,at) {
    if(id!==selected){keepRange();selected=id;const s=current();range={a:s.in || 0,b:s.out ?? (s.in || 0)+length(s),dirty:false};draw();onSelect(s);}
    paintRange();if(at!==undefined)seek(current(),at);
  }
  const cache=new Map();let frameGeneration=0;
  async function frames(){
    const generation=++frameGeneration;
    await Promise.all(scenes.map(async s=>{
      const o=origin(s),count=Math.max(2,Math.ceil(rowFor(s.id).w/44));
      await Promise.all(Array.from({length:count},async (_,i)=>{
        if(disposed||generation!==frameGeneration||!root.isConnected)return;
        const t=(s.in || 0)+span(s)*(i+.5)/count,key=`${s.id}:${i}:${count}:${s.in}:${s.out}`;
        let img=cache.get(key);
        if(!img){const at=t;const url=window.maDemo.file(sources[s.src ?? 0]?.id);img=await grabFrame(url,at,100,true);if(img)cache.set(key,img);}
        const el=clips.querySelector(`[data-scene="${CSS.escape(s.id)}"] img[data-cell="${i}"]`);if(el&&img)el.src=img;
      }));
    }));
  }
  function draw(){
    const rs=rows();band.style.width=`${rs.reduce((n,r)=>n+r.w,0)}px`;
    clips.innerHTML=rs.map(({s,w},i)=>{const count=Math.max(2,Math.ceil(w/44));return `<button type="button" class="timeline-clip" data-scene="${esc(s.id)}" style="width:${w}px" aria-label="場面 ${i+1}${s.room?' '+esc(s.room):''}" aria-pressed="${selected===s.id}"><span class="timeline-frames">${Array.from({length:count},(_,k)=>`<img data-cell="${k}"  alt="">`).join('')}</span><span class="timeline-name">${esc(s.room || `場面 ${i+1}`)}</span></button>`;}).join('');
    paintRange();frames();
  }
  function atX(clientX){const x=Math.max(0,clientX-band.getBoundingClientRect().left);return rows().find(r=>x<r.x+r.w)||rows().at(-1);}
  function scrub(e){const r=atX(e.clientX);const x=e.clientX-band.getBoundingClientRect().left;select(r.s.id);seek(r.s,(r.s.in || 0)+Math.max(0,Math.min(1,(x-r.x)/r.w))*span(r.s));}
  function cancel(){if(!gesture)return;clearTimeout(gesture.timer);band.classList.remove('reordering');clips.querySelectorAll('.dragging').forEach(e=>e.classList.remove('dragging'));gesture=null;}
  band.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const handle=e.target.closest('.trim-handle'),tile=e.target.closest('.timeline-clip');if(!handle&&!tile)return;
    e.preventDefault();video?.pause();
    if(tile)select(tile.dataset.scene);
    const s=current(),r=rowFor(s.id);
    const x=e.clientX-band.getBoundingClientRect().left;
    gesture={id:e.pointerId,x:e.clientX,y:e.clientY,mode:handle?'trim':'waiting',side:Math.abs(x-position(s,range.a))<=Math.abs(x-position(s,range.b))?'a':'b',a:range.a,b:range.b,scale:span(s)/r.w,scene:s.id};
    band.setPointerCapture(e.pointerId);
    if(!handle){scrub(e);if(editable)gesture.timer=setTimeout(()=>{if(!gesture||gesture.mode!=='waiting')return;gesture.mode='order';band.classList.add('reordering');clips.querySelector(`[data-scene="${CSS.escape(gesture.scene)}"]`)?.classList.add('dragging');},450);}
  });
  band.addEventListener('pointermove',e=>{
    const g=gesture;if(!g||g.id!==e.pointerId)return;
    if(g.mode==='trim'){
      const s=current(),delta=(e.clientX-g.x)*g.scale;
      range[g.side]=round(g.side==='a'?Math.max(min(s),Math.min(g.b-.5,g.a+delta)):Math.min(max(s),Math.max(g.a+.5,g.b+delta)));
      if(g.side==='a'&&range.a>(s.in || 0)&&range.a<(s.in || 0)+.5)range.a=s.in || 0;
      if(g.side==='b'&&range.b<(s.out ?? s.in+length(s))&&range.b>(s.out ?? s.in+length(s))-.5)range.b=s.out ?? s.in+length(s);
      range.dirty=true;paintRange();seek(s,range[g.side]);
    }else if(g.mode==='order'){
      const target=atX(e.clientX);clips.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));clips.querySelector(`[data-scene="${CSS.escape(target.s.id)}"]`)?.classList.add('drop-target');g.target=target.s.id;
      const sc=root.querySelector('.timeline-scroll'),rect=sc.getBoundingClientRect();if(e.clientX>rect.right-30)sc.scrollLeft+=12;else if(e.clientX<rect.left+30)sc.scrollLeft-=12;
    }else if(Math.hypot(e.clientX-g.x,e.clientY-g.y)>7||g.mode==='scrub'){clearTimeout(g.timer);g.mode='scrub';scrub(e);}
  });
  band.addEventListener('pointerup',e=>{
    const g=gesture;if(!g||g.id!==e.pointerId)return;
    if(g.mode==='trim')onChange('場面の使う範囲を変更');
    if(g.mode==='order'&&g.target&&g.target!==g.scene){keepRange();const from=scenes.findIndex(s=>s.id===g.scene),to=scenes.findIndex(s=>s.id===g.target);const [s]=scenes.splice(from,1);scenes.splice(to,0,s);onChange('場面の順番を変更');}
    const open=!editable&&g.mode==='waiting';cancel();draw();onSelect(current());if(open)onOpen(current().id);
  });
  band.addEventListener('pointercancel',()=>{if(gesture?.mode==='trim'){range.a=gesture.a;range.b=gesture.b;paintRange();}cancel();draw();});
  band.addEventListener('click',e=>{const tile=e.target.closest('.timeline-clip');if(e.detail===0&&tile){select(tile.dataset.scene);seek(current(),current().in || 0);if(!editable)onOpen(current().id);}});
  selection.querySelectorAll('.trim-handle').forEach(button=>button.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const side=button.classList.contains('start')?'a':'b',s=current(),d=e.key==='ArrowLeft'?-.1:.1;range[side]=round(side==='a'?Math.max(0,Math.min(range.b-.5,range.a+d)):Math.min(max(s),Math.max(range.a+.5,range.b+d)));range.dirty=true;paintRange();seek(s,range[side]);onChange('場面の使う範囲を変更');}));
  const updateHead=()=>{if(gesture)return;const t=video.maPlayer?.time() ?? video.currentTime;if(completed){const s=scenes.find(s=>{const o=origin(s);return t>=o.start&&t<o.start+o.renderLength;});if(s){const o=origin(s);head.style.left=`${position(s,(o.in || 0)+(t-o.start)/o.renderLength*span(o))}px`;}}else if(current())head.style.left=`${position(current(),t)}px`;};
  video?.addEventListener('timeupdate',updateHead);
  root.addEventListener('dragstart',e=>e.preventDefault());
  draw();select(scenes[0].id,scenes[0].in || 0);
  return {
    select:id=>select(id),current,range:()=>({...range}),
    read:()=>{keepRange();return scenes.map(clean);},
    isolate(){
      const s=current();if(!range.dirty)return s;
      const a=s.in || 0,b=s.out ?? a+length(s),parts=[],originId=s.originId || s.id;
      const piece=(start,end)=>({...s,id:`${s.id}_cut_${crypto.randomUUID().slice(0,8)}`,originId,in:round(start),out:round(end),duration:round(end-start)});
      if(range.a-a>=.5)parts.push(piece(a,range.a));
      const middle={...s,in:range.a,out:range.b,duration:round(range.b-range.a)};parts.push(middle);
      if(b-range.b>=.5)parts.push(piece(range.b,b));
      for(const part of parts)original.set(part.id,origin(s));
      scenes.splice(scenes.indexOf(s),1,...parts);range={a:middle.in,b:middle.out,dirty:false};draw();onSelect(middle);return middle;
    },
    cut(){
      const s=current(),i=scenes.indexOf(s),a=s.in || 0,b=s.out ?? a+length(s),parts=[];
      // Keep the footage outside the selected interval and preserve source identity.
      if(range.a-a>=.5)parts.push({...s,out:range.a,duration:round(range.a-a)});
      if(b-range.b>=.5)parts.push({...s,id:parts.length?`${s.id}_cut_${crypto.randomUUID().slice(0,8)}`:s.id,originId:s.originId || s.id,in:range.b,duration:round(b-range.b)});
      if(scenes.length===1&&!parts.length)return false;
      for(const part of parts)original.set(part.id,origin(s));
      scenes.splice(i,1,...parts);selected=null;range=null;select(scenes[Math.min(i,scenes.length-1)].id);draw();onChange('選んだパートを切る');return true;
    },
    destroy(){disposed=true;cancel();video?.removeEventListener('timeupdate',updateHead);}
  };
}

