(() => {
 const nativeFetch=window.fetch.bind(window), base=new URL('.',document.currentScript.src), KEY='ma_static_demo_v1';
 const clone=x=>structuredClone(x), asset=p=>new URL(p,base).href;
 let state;
 let sample=null;
 const ready=nativeFetch(asset('local-fixtures/plan.json')).then(r=>r.json()).then(p=>{sample=p;
  try{state=JSON.parse(localStorage.getItem(KEY));}catch{}
  if(!state)state={job:seed(p),snapshots:[]};
  save();
 });
 function seed(p){return {id:'j_de0001',title:'ひかりの住まい',created_at:Math.floor(Date.now()/1000),status:'needs_input',form:{property_name:'ひかりの住まい',deal:'rent',price:'12',layout:'1LDK',area:'45',company_name:'間不動産',target:{household:'couple'},catch_strength:'normal',rooms:[{name:'ダイニング',features:'明るい窓'},{name:'リビング',features:'12.5帖'}]},files:[{id:'f_logo',kind:'logo',name:'ロゴ'}],analysis:null,plan:{...clone(p),caption:'光が届く1LDKの住まい',hashtags:[],theme:'modern'},events:[],credits:{used:0,cap:100},versions:[],outputs:null};}
 function save(){localStorage.setItem(KEY,JSON.stringify(state));}
 function file(id){return asset(/logo|floorplan/.test(id)?'assets/ma-logo.png':`local-fixtures/scene-${Number(String(id).match(/\d+$/)?.[0]||0)%4}.mp4`);}
 function finish(j){
  j.status='done';j.caption=j.plan.caption;j.duration=j.plan.segments.reduce((a,s)=>a+s.out-s.in,0);
  let t=0;j.timeline=j.plan.segments.map(s=>{const x={id:s.id,start:t,len:s.out-s.in};t+=x.len;return x;});
  j.outputs={publish:file(j.files.find(f=>f.kind==='source'&&f.id===`f_scene_${j.plan.segments[0].src||0}`)?.id),client:file('f_scene_0'),thumbnail:asset('local-fixtures/thumbnail.jpg')};
  j.outputs.publish_thumbnail=j.outputs.thumbnail;j.review={summary:'',issues:[]};
  j.activeVersion=(state.snapshots.at(-1)?.version||0)+1;
  state.snapshots.push({version:j.activeVersion,plan:clone(j.plan),timeline:clone(j.timeline),duration:j.duration,outputs:clone(j.outputs),notes:clone(j.notes||[])});
  j.versions=state.snapshots.map(s=>({version:s.version,state:'done'}));delete j.readyAt;
 }
 window.fetch=async(input,opt={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(!url.pathname.includes('/api/')) {
   if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('外部への接続はできません');
   return nativeFetch(input,opt);
  }
  await ready;const p=url.pathname.slice(url.pathname.indexOf('/api/')),method=opt.method||'GET';
  const body=typeof opt.body==='string'?JSON.parse(opt.body):{};let j=state.job,result={};
  if(j.readyAt&&Date.now()>=j.readyAt)finish(j);
  if(p==='/api/me')result={client:{name:'間不動産',company_name:'間不動産',logo_key:'sample'}};
  else if(p==='/api/jobs'&&method==='GET')result={jobs:[j]};
  else if(p==='/api/jobs'&&method==='POST'){j=state.job=seed(j.plan);result={id:j.id};}
  else if(p===`/api/jobs/${j.id}`)result=j;
  else if(p.endsWith('/form')){j.form=body;j.title=body.property_name||j.title;result=j;}
  else if(p.endsWith('/plan')){
   if(method==='PUT')Object.assign(j.plan,body);
   else {j.status='plan_ready';j.plan.caption=`${j.form.layout} 家賃 ${j.form.price}万円`;const s=j.plan.segments.find(s=>s.type==='overview');if(s)s.telop=`家賃 ${j.form.price}万円\n${j.form.area||45}㎡ ${j.form.layout}`;}
   result={plan:j.plan};
  }
  else if(p.endsWith('/revise')){j.plan.segments=body.segments;j.notes=body.notes;j.status='plan_ready';result=j;}
  else if(p.endsWith('/approve')){j.status='rendering';j.readyAt=Date.now()+2200;j.events=[{at:Date.now()/1000,message:'動画を仕上げています'}];result=j;}
  else if(p.endsWith('/versions/restore')){const s=state.snapshots.find(s=>s.version===body.version);if(!s)return Response.json({error:'版が見つかりません'},{status:404});Object.assign(j,clone(s),{activeVersion:s.version,status:'done'});result=j;}
  else if(p.endsWith('/analyze')){j.status='needs_input';result=j;}
  else if(p.endsWith('/files/start')){const id=body.kind==='source'?`f_scene_${j.files.filter(f=>f.kind==='source').length%4}`:`f_${body.kind}_${Date.now()}`;j.pendingFile={id,kind:body.kind,name:body.name,duration:6,size:body.size};result={fileId:id,partSize:Math.max(body.size,1),parts:1};}
  else if(/\/part\/\d+$/.test(p)){result={part:1,etag:'sample'};}
  else if(p.endsWith('/complete')){if(j.pendingFile){j.files=j.files.filter(f=>f.id!==j.pendingFile.id);j.files.push(j.pendingFile);delete j.pendingFile;}result={};}
  else if(/\/files\/[^/]+$/.test(p)&&method==='DELETE'){j.files=j.files.filter(f=>f.id!==p.split('/').at(-1));result={};}
  else if(/\/files\/[^/]+$/.test(p)&&method==='GET')return nativeFetch(file(p.split('/').at(-1)));
  else return Response.json({error:'この操作は使えません'},{status:400});
  save();return Response.json(clone(result));
 };
 function play(video,j){
  if(!video||video.maPlayer)return;
  const segments=clone(j.plan.segments);let index=0,transition=false,playing=false;
  const wrap=document.createElement('div');wrap.className='ma-playback';video.before(wrap);wrap.append(video);const ready=()=>video.closest('.video-preview')?.classList.remove('loading');if(video.readyState>=2)ready();video.addEventListener('loadeddata',ready);
  const caption=document.createElement('div');caption.className='ma-subtitle';caption.dataset.theme=j.plan.theme;wrap.append(caption);
  const button=document.createElement('button');button.type='button';button.className='pill sub ma-play';button.textContent='再生';button.setAttribute('aria-label','動画を再生');wrap.append(button);
  const seek=document.createElement('input');seek.type='range';seek.min=0;seek.max=segments.reduce((a,s)=>a+s.out-s.in,0);seek.step=.01;seek.value=0;seek.className='ma-seek';seek.setAttribute('aria-label','再生位置');wrap.append(seek);
  video.controls=false;video.muted=true;
  const start=i=>segments.slice(0,i).reduce((a,s)=>a+s.out-s.in,0);
  function load(i,t,resume){
   transition=true;index=i;const s=segments[i];caption.textContent=s.telop??(s.lines||[]).join('\n');
   const src=file(`f_scene_${s.src||0}`);
   const move=()=>{video.currentTime=Math.max(s.in,Math.min(t,s.out-.025));transition=false;if(resume)video.play().catch(()=>{});};
   if(video.src!==src){video.src=src;video.addEventListener('loadedmetadata',move,{once:true});}else if(video.readyState)move();else video.addEventListener('loadedmetadata',move,{once:true});
  }
  video.maPlayer={seek(t){let i=segments.length-1;for(let k=0;k<segments.length;k++)if(t<start(k)+segments[k].out-segments[k].in){i=k;break;}load(i,segments[i].in+t-start(i),!video.paused);},time(){return start(index)+Math.max(0,video.currentTime-segments[index].in);},segments};
  button.onclick=()=>video.paused?video.play():video.pause();
  video.addEventListener('play',()=>{playing=true;button.textContent='一時停止';});
  video.addEventListener('pause',()=>{if(!transition)playing=false;button.textContent='再生';});
  const next=()=>{if(transition)return;if(index+1<segments.length)load(index+1,segments[index+1].in,playing||video.ended);else{video.pause();load(0,segments[0].in,false);}};
  video.addEventListener('timeupdate',()=>{seek.value=video.maPlayer.time();if(video.currentTime>=segments[index].out-.045)next();});video.addEventListener('ended',next);
  seek.oninput=()=>video.maPlayer.seek(Number(seek.value));
  load(0,segments[0].in,false);
 }
 window.maDemo={file,play,job:()=>clone(state.job),useSamples:()=>{const j=state.job;const had=j.files.some(f=>f.kind==='source');if(sample&&!had){j.files.unshift(...sample.segments.map((s,i)=>({id:`f_scene_${i}`,kind:'source',name:`${s.room}.mp4`,duration:s.out,size:1})));j.analysis={rooms:sample.segments.map(s=>({name:s.room,features:[]})),suggest:{},unclear:[],theme:'modern'};}j.status='needs_input';save();if(had){location.hash=`#/job/${state.job.id}/${matchMedia('(min-width:1024px)').matches?'c':'b'}`;return;}const h=`#/job/${state.job.id}/${matchMedia('(min-width:1024px)').matches?'c':'b'}`;if(location.hash===h)location.reload();else{location.hash=h;location.reload();}},ready};
 document.addEventListener('DOMContentLoaded',()=>{
  if(!document.getElementById('app'))return;
  const menu=document.createElement('details');menu.className='ma-menu';menu.innerHTML='<summary aria-label="メニュー">メニュー</summary><button class="pill sub" type="button">最初からやり直す</button>';
  menu.querySelector('button').onclick=()=>{localStorage.removeItem(KEY);localStorage.removeItem('rt_cur_job');location.href=asset('app.html');};document.body.append(menu);
  document.addEventListener('click',e=>{if(e.target.closest('[data-pick]')){
   e.preventDefault();e.stopImmediatePropagation();const dialog=document.createElement('dialog');dialog.className='ma-materials';dialog.innerHTML='<button class="pill main" data-sample>見本の素材を選ぶ</button><button class="pill sub" data-own>自分の素材を選ぶ</button><button class="pill sub" data-close>閉じる</button>';document.body.append(dialog);
   const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-sample]').onclick=()=>{close();window.maDemo.useSamples();};dialog.querySelector('[data-own]').onclick=()=>{close();document.getElementById('pick')?.click();};dialog.querySelector('[data-close]').onclick=close;dialog.oncancel=close;dialog.showModal();
  }},true);
 });
})();
