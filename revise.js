import { mountTimeline, timelineHtml, length } from './timeline.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const subtitle = (p,s) => s.telop ?? (s.type === 'eyecatch' ? p.catch.lines.join('\n') : (s.lines || []).join('\n'));
export const seconds = length;
export const formatSeconds = s => `${Number(s).toFixed(1)} 秒`;
let composition=null;
export function sceneCards() {
  return `<div id="composition-timeline"><video class="finished" controls playsinline></video>${timelineHtml()}<h2 class="ttl2" id="scene-title"></h2><label class="lb">字幕<textarea class="in" id="plan-caption"></textarea></label><label class="lb">ナレーション<textarea class="in" id="plan-narration"></textarea></label></div>`;
}
export function bindComposition(j,grabFrame) {
  composition?.destroy();const root=document.getElementById('composition-timeline');if(!root){composition=null;return;}
  const caption=root.querySelector('#plan-caption'),narration=root.querySelector('#plan-narration');
  composition=mountTimeline(root,j,{video:root.querySelector('video'),grabFrame,onSelect:s=>{root.querySelector('#scene-title').textContent=s.room || '選んだ場面';caption.value=subtitle(j.plan,s);narration.value=s.narration;}});
  caption.oninput=()=>{composition.current().telop=caption.value;};narration.oninput=()=>{composition.current().narration=narration.value;};
}
export const readComposition = () => composition.read();
export async function fillFrames(j, grabFrame, completed=false) {
  const srcs=j.files.filter(f=>f.kind==='source');
  for (const [i,s] of j.plan.segments.entries()) {
    const url=completed ? j.outputs?.publish : window.maDemo.file(srcs[s.src || 0]?.id);
    const t=completed ? (j.timeline.find(t=>t.id===s.id)?.start ?? i*3)+0.15 : (s.in || 0)+0.15;
    const img=await grabFrame(url,t,240,true);
    document.querySelectorAll(`[data-frame="${s.id}"]`).forEach(el=>{if(img)el.src=img;});
  }
}
export function revisionEditor(j, { app, shell, post, reload, grabFrame }) {
  let notes=[],point=null,changes=new Map(),timeline;
  const record=(id,text)=>{changes.set(id,text);drawList();};
  app.innerHTML=shell(j,`<h1 class="ttl">場面を修正</h1><div class="revise"><div id="revision-timeline"><div class="video-preview"><img class="loading-poster" src="${esc(j.outputs.publish_thumbnail || j.outputs.thumbnail)}" alt=""><video class="finished" playsinline preload="auto" poster="${esc(j.outputs.publish_thumbnail || j.outputs.thumbnail)}" src="${esc(j.outputs.publish)}"></video><button type="button" class="preview-play pill sub" aria-label="動画を再生">再生</button></div>${timelineHtml()}</div><h2 class="ttl2" id="scene-title"></h2><div class="part-actions"><button class="pill sub" id="cut-part">切る</button><button class="pill sub" id="edit-caption">字幕を直す</button><button class="pill sub" id="write-note">修正指示</button></div><div class="scroll revision-fields"><div id="caption-panel" hidden><label class="lb">字幕<textarea class="in" id="rev-caption"></textarea></label></div><div class="correction" id="note-panel" hidden><div class="frame-point" id="frame-point" role="button" tabindex="0" aria-label="修正箇所に印を付ける"><img id="large-frame" alt="選んだコマ"><span id="pin" hidden></span></div><div class="correction-fields"><label class="lb" id="note-label">修正箇所<textarea class="in" id="rev-note" placeholder="例 この場面が暗い"></textarea></label><button class="pill sub" id="add-note">指示を追加</button></div></div><h2 class="ttl2">変更一覧</h2><ul id="revision-list" class="revision-list"></ul><p role="alert" id="revision-error"></p><button class="pill main" id="send-revision">修正して書き出す</button><button class="pill sub" id="cancel-revision">完成動画に戻る</button></div></div>`);
  const get=id=>document.getElementById(id),video=app.querySelector('video');
  window.maDemo.play(video,j);
  const preview=video.closest(".video-preview");const loading=()=>{preview.classList.add('loading');video.controls=false;};const ready=()=>{if(video.readyState>=2&&!video.seeking){preview.classList.remove('loading');video.controls=false;}};for(const event of ['loadstart','waiting','seeking'])video.addEventListener(event,loading);for(const event of ['loadeddata','canplay','seeked','playing'])video.addEventListener(event,ready);loading();ready();const play=preview.querySelector('.preview-play');play.onclick=()=>video.paused?video.play():video.pause();video.addEventListener('play',()=>{play.textContent='一時停止';play.setAttribute('aria-label','動画を一時停止');});video.addEventListener('pause',()=>{play.textContent='再生';play.setAttribute('aria-label','動画を再生');});
  const current=()=>timeline.current();
  const addNote=()=>{const text=get('rev-note').value.trim();if(!text)return;notes.push({id:current().id,text,point});get('rev-note').value='';point=null;get('pin').hidden=true;drawList();drawPins();};
  function drawPins(){
    get('frame-point').querySelectorAll('.saved-pin').forEach(el=>el.remove());
    notes.forEach((n,i)=>{if(n.id!==current().id||!n.point)return;const el=document.createElement('span');el.className='saved-pin';el.style.left=`${n.point.x*100}%`;el.style.top=`${n.point.y*100}%`;el.textContent=String(i+1);get('frame-point').append(el);});
  }
  function drawList(){get('revision-list').innerHTML=[...changes.values()].map(t=>`<li><span data-phrases>${esc(t)}</span></li>`).join('')+notes.map((n,i)=>`<li><span data-phrases>${n.point?'印の所 ':''}${esc(n.text)}</span><button class="pill sub" data-drop-note="${i}" aria-label="指示を削除">取り消す</button></li>`).join('');get('revision-list').querySelectorAll('[data-drop-note]').forEach(b=>b.onclick=()=>{notes.splice(Number(b.dataset.dropNote),1);drawList();drawPins();});}
  let shown=null,frameRequest=0;
  const show=s=>{
    if(shown&&shown!==s.id&&get('rev-note').value.trim()){notes.push({id:shown,text:get('rev-note').value.trim(),point});get('rev-note').value='';drawList();}
    shown=s.id;get('scene-title').textContent=s.room || '選んだ場面';get('rev-caption').value=subtitle(j.plan,s);
    point=null;get('pin').hidden=true;get('note-label').firstChild.textContent='修正箇所';
    get('large-frame').src=j.outputs.publish_thumbnail || j.outputs.thumbnail;
    if(timeline)drawPins();
  };
  timeline=mountTimeline(get('revision-timeline'),j,{video,grabFrame,completed:true,onSelect:show,onChange:t=>record('timeline',t)});
  async function updateFrame(){const token=++frameRequest,img=await grabFrame(video.src,video.currentTime || 0,360,true);if(token===frameRequest&&get('large-frame')&&img)get('large-frame').src=img;}
  video.addEventListener('seeked',()=>{if(!get('note-panel')?.hidden)updateFrame();});
  get('edit-caption').onclick=()=>{if(get('caption-panel').hidden)timeline.isolate();get('caption-panel').hidden=!get('caption-panel').hidden;get('note-panel').hidden=true;if(!get('caption-panel').hidden)get('rev-caption').focus();};
  get('write-note').onclick=()=>{if(get('note-panel').hidden)timeline.isolate();get('note-panel').hidden=!get('note-panel').hidden;get('caption-panel').hidden=true;if(!get('note-panel').hidden){updateFrame();get('note-panel').parentElement.scrollTop=0;}};
  get('rev-caption').oninput=e=>{current().telop=e.target.value;record(current().id+'caption',`${current().room || '場面'}の字幕を変更`);};
  get('cut-part').onclick=()=>{addNote();const id=current().id;if(!timeline.cut()){get('revision-error').textContent='動画全体は削除できません';return;}const ids=new Set(timeline.read().map(s=>s.id));notes=notes.filter(n=>ids.has(n.id));record(id+'cut','選択範囲をカット');drawPins();};
  const pin=(x,y)=>{point={x,y};Object.assign(get('pin').style,{left:`${x*100}%`,top:`${y*100}%`});get('pin').hidden=false;get('note-label').firstChild.textContent='指定箇所の修正';};
  get('frame-point').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();pin((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);};
  get('frame-point').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pin(.5,.5);}};
  get('add-note').onclick=addNote;
  get('send-revision').onclick=async e=>{
    addNote();if(!changes.size&&!notes.length){get('revision-error').textContent='修正箇所を選択してください';return;}
    if(!confirm('この内容で書き出しますか\n読み上げと仕上がりチェックで数円かかります'))return;
    e.target.disabled=true;
    try{await post(`/api/jobs/${j.id}/revise`,{segments:timeline.read(),notes});await post(`/api/jobs/${j.id}/approve`);timeline.destroy();await reload();}catch(err){get('revision-error').textContent=err.message;e.target.disabled=false;}
  };
  get('cancel-revision').onclick=()=>{if(changes.size||notes.length||get('rev-note').value.trim()){if(!confirm('変更を破棄して戻りますか'))return;}timeline.destroy();reload();};
  drawList();
}
