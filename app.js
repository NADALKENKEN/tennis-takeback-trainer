const $ = (id) => document.getElementById(id);
const screens = ['setupScreen','videoScreen','countdownScreen','trainingScreen','resultScreen'];
const videoDefs = [
  {key:'oppFH_childFH', label:'相手フォア → 自分フォア', short:'F→F'},
  {key:'oppFH_childBH', label:'相手フォア → 自分バック', short:'F→B'},
  {key:'oppBH_childFH', label:'相手バック → 自分フォア', short:'B→F'},
  {key:'oppBH_childBH', label:'相手バック → 自分バック', short:'B→B'},
];

let state = { running:false, reps:0, good:0, late:0, duration:60, startedAt:0, timer:null, shotTimer:null, current:null, coach:false, pace:1800, hand:'right', mode:'fb' };
let dbPromise = openDB();

function show(id){ screens.forEach(s => $(s).classList.toggle('active', s===id)); }
function rnd(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

$('startBtn').addEventListener('click', startSession);
$('videoSettingsBtn').addEventListener('click', ()=>show('videoScreen'));
$('backFromVideo').addEventListener('click', ()=>show('setupScreen'));
$('stopBtn').addEventListener('click', finishSession);
$('againBtn').addEventListener('click', startSession);
$('homeBtn').addEventListener('click', ()=>show('setupScreen'));
$('goodBtn').addEventListener('click', ()=>judge('good'));
$('lateBtn').addEventListener('click', ()=>judge('late'));
$('clearVideosBtn').addEventListener('click', clearVideos);

renderVideoSlots();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});

document.addEventListener('visibilitychange', ()=>{ if(document.hidden && state.running) finishSession(); });

async function startSession(){
  state.duration = Number($('durationSelect').value);
  state.pace = Number($('paceSelect').value);
  state.coach = $('coachToggle').checked;
  state.hand = $('handSelect').value;
  state.mode = $('modeSelect').value;
  state.reps = state.good = state.late = 0;
  $('coachPanel').classList.toggle('hidden', !state.coach);
  $('repCount').textContent='0'; $('timeLeft').textContent=state.duration;
  $('progressBar').style.transform='scaleX(1)';
  show('countdownScreen');
  for(let n=3;n>=1;n--){ $('countdownValue').textContent=n; await sleep(700); }
  $('countdownValue').textContent='GO'; await sleep(420);
  show('trainingScreen');
  state.running=true; state.startedAt=performance.now();
  tickClock();
  await sleep(350);
  nextShot();
}

function tickClock(){
  clearInterval(state.timer);
  state.timer=setInterval(()=>{
    if(!state.running) return;
    const elapsed=(performance.now()-state.startedAt)/1000;
    const left=Math.max(0,state.duration-elapsed);
    $('timeLeft').textContent=Math.ceil(left);
    $('progressBar').style.transform=`scaleX(${left/state.duration})`;
    if(left<=0) finishSession();
  },100);
}

async function nextShot(){
  if(!state.running) return;
  clearTimeout(state.shotTimer);
  $('answerBadge').classList.remove('show');
  $('stage').className='stage';
  $('animatedOpponent').className='opponent';
  $('trainingCue').textContent='相手の打点を見る';

  const targetSide = Math.random()<.5 ? 'forehand':'backhand';
  const depth = state.mode==='fb' ? 'deep' : (Math.random()<.35 ? 'short':'deep');
  const opponentStroke = Math.random()<.5 ? 'FH':'BH';
  state.current={targetSide,depth,opponentStroke,judged:false};

  const childSideOnScreen = screenSideFor(targetSide, state.hand);
  const clipKey=`opp${opponentStroke}_child${targetSide==='forehand'?'FH':'BH'}`;
  const clip=await getVideo(clipKey);

  const prepDelay = Math.max(260, Math.min(650, state.pace * .28));
  if(clip){
    await playClip(clip, targetSide, depth);
  }else{
    const cls=opponentStroke==='FH'?'prep-fh':'prep-bh';
    $('animatedOpponent').classList.add(cls);
    await sleep(prepDelay);
    if(!state.running) return;
    $('animatedOpponent').className='opponent '+(opponentStroke==='FH'?'hit-fh':'hit-bh');
    impact(childSideOnScreen, depth);
  }

  state.reps++; $('repCount').textContent=state.reps;
  if(state.coach){
    $('trainingCue').textContent='準備できた？ 保護者が判定';
  } else {
    state.shotTimer=setTimeout(()=>{ if(state.running) nextShot(); }, Math.max(480,state.pace-520));
  }
}

function screenSideFor(targetSide, hand){
  // Player faces the phone. Screen left/right corresponds to the player's own left/right.
  if(hand==='right') return targetSide==='forehand' ? 'right':'left';
  return targetSide==='forehand' ? 'left':'right';
}

function impact(side, depth){
  const stage=$('stage');
  const shotClass = depth==='short' ? `shot-short-${side}` : `shot-${side}`;
  stage.classList.add(shotClass);
  $('impactFlash').classList.remove('flash'); void $('impactFlash').offsetWidth; $('impactFlash').classList.add('flash');
  if(navigator.vibrate) navigator.vibrate(18);
  const text = `${state.current.targetSide==='forehand'?'フォア':'バック'}${state.mode==='fb'?'':(depth==='short'?'・前':'・後ろ')}`;
  setTimeout(()=>{ if(state.running){ $('answerBadge').textContent=text; $('answerBadge').classList.add('show'); }}, 520);
}

async function playClip(blob, targetSide, depth){
  const video=$('opponentVideo');
  const url=URL.createObjectURL(blob);
  $('stage').classList.add('video-mode');
  video.src=url; video.currentTime=0;
  try{ await video.play(); }catch(e){}
  const impactMs=Math.min(900, Math.max(250, ((video.duration||1.1)*1000)*0.62));
  await sleep(impactMs);
  if(state.running) impact(screenSideFor(targetSide,state.hand), depth);
  await new Promise(resolve=>{
    const done=()=>{ video.removeEventListener('ended',done); resolve(); };
    video.addEventListener('ended',done,{once:true});
    setTimeout(done,1400);
  });
  video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  $('stage').classList.remove('video-mode');
}

function judge(type){
  if(!state.running || !state.current || state.current.judged) return;
  state.current.judged=true;
  if(type==='good') state.good++; else state.late++;
  $('trainingCue').textContent=type==='good'?'OK！ 次も相手の打点を見る':'次は打点の瞬間に準備';
  clearTimeout(state.shotTimer);
  state.shotTimer=setTimeout(()=>{ if(state.running) nextShot(); }, 300);
}

function finishSession(){
  if(!state.running && !$('trainingScreen').classList.contains('active')) return;
  state.running=false; clearInterval(state.timer); clearTimeout(state.shotTimer);
  const video=$('opponentVideo'); video.pause(); video.removeAttribute('src');
  $('resultReps').textContent=state.reps;
  if(state.coach){
    const total=state.good+state.late; const rate=total?Math.round(state.good/total*100):0;
    $('resultGood').textContent=state.good; $('resultLate').textContent=state.late; $('resultRate').textContent=rate+'%';
    $('resultAdvice').innerHTML = rate>=85 ? '<strong>かなり良い準備です</strong><p>次は「次の球まで」を1段階速くして、同じ準備率を維持できるか試してください。</p>' : rate>=65 ? '<strong>狙いどおりの練習ゾーンです</strong><p>遅れた球だけを意識して、相手のラケットが前に出る前からスプリットを終えることを目標に。</p>' : '<strong>速さより予測を先に</strong><p>一度ペースをゆっくりに戻し、相手の肩・ラケット・打点を見ることを優先してください。</p>';
  } else {
    $('resultGood').textContent='—'; $('resultLate').textContent='—'; $('resultRate').textContent='—';
    $('resultAdvice').innerHTML='<strong>次のセットのポイント</strong><p>ボールがこちらへ飛んできてからではなく、相手がインパクトした瞬間にフォア/バックの準備を始めます。3セット程度で十分です。</p>';
  }
  show('resultScreen');
}

function renderVideoSlots(){
  const root=$('videoSlots'); root.innerHTML='';
  videoDefs.forEach(def=>{
    const item=document.createElement('div'); item.className='video-slot';
    item.innerHTML=`<div class="row"><div><strong>${def.label}</strong><small id="status-${def.key}">未登録（アニメーション使用）</small></div><label class="file-btn">動画選択<input type="file" accept="video/*" data-key="${def.key}"></label></div>`;
    root.appendChild(item);
    item.querySelector('input').addEventListener('change', async (e)=>{
      const file=e.target.files?.[0]; if(!file) return;
      await saveVideo(def.key,file); updateVideoStatuses();
    });
  });
  updateVideoStatuses();
}

async function updateVideoStatuses(){
  for(const def of videoDefs){
    const blob=await getVideo(def.key); const el=$('status-'+def.key); if(el) el.textContent=blob?'登録済み ✓':'未登録（アニメーション使用）';
  }
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('TakebackTrainerDB',1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains('videos')) db.createObjectStore('videos'); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function saveVideo(key,blob){ const db=await dbPromise; return new Promise((res,rej)=>{ const tx=db.transaction('videos','readwrite'); tx.objectStore('videos').put(blob,key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }
async function getVideo(key){ try{ const db=await dbPromise; return await new Promise((res,rej)=>{ const tx=db.transaction('videos','readonly'); const req=tx.objectStore('videos').get(key); req.onsuccess=()=>res(req.result||null); req.onerror=()=>rej(req.error); }); }catch{return null;} }
async function clearVideos(){ const db=await dbPromise; await new Promise((res,rej)=>{ const tx=db.transaction('videos','readwrite'); tx.objectStore('videos').clear(); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); updateVideoStatuses(); }
