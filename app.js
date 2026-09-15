const $ = (id) => document.getElementById(id);
const screens = ['setupScreen','countdownScreen','trainingScreen','resultScreen'];
const LEVEL_PACE = {1:2500,2:2100,3:1750,4:1450,5:1200};
const HISTORY_KEY = 'takeback_history_v42';

let state = {
  running:false,
  reps:0,
  duration:30,
  startedAt:0,
  timer:null,
  loopTimer:null,
  hand:'right',
  mode:'fb',
  level:3,
  pace:1750,
  sound:true
};
let audioCtx = null;

function show(id){ screens.forEach(s => $(s).classList.toggle('active', s===id)); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function randomInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

$('startBtn').addEventListener('click', startSession);
$('againBtn').addEventListener('click', startSession);
$('homeBtn').addEventListener('click', ()=>{ show('setupScreen'); renderHistory(); });
$('stopBtn').addEventListener('click', ()=>finishSession(false));
$('clearHistoryBtn').addEventListener('click', ()=>{
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

renderHistory();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
document.addEventListener('visibilitychange', ()=>{ if(document.hidden && state.running) finishSession(false); });

async function startSession(){
  state.duration = Number($('durationSelect').value);
  state.hand = $('handSelect').value;
  state.mode = $('modeSelect').value;
  state.level = Number($('levelSelect').value);
  state.pace = LEVEL_PACE[state.level];
  state.sound = $('soundToggle').checked;
  state.reps = 0;

  if(state.sound) unlockAudio();
  $('repCount').textContent = '0';
  $('timeLeft').textContent = state.duration;
  $('levelValue').textContent = state.level;
  $('progressBar').style.transform = 'scaleX(1)';
  $('levelLabel').textContent = state.mode==='survival' ? `SURVIVAL / Lv.${state.level}` : `Lv.${state.level}`;
  resetStage();

  show('countdownScreen');
  for(let n=3;n>=1;n--){
    $('countdownValue').textContent=n;
    playTick(480);
    await sleep(650);
  }
  $('countdownValue').textContent='GO!';
  playTick(860);
  await sleep(420);

  show('trainingScreen');
  state.running = true;
  state.startedAt = performance.now();
  tickClock();
  await sleep(250);
  nextShot();
}

function tickClock(){
  clearInterval(state.timer);
  state.timer = setInterval(()=>{
    if(!state.running) return;
    const elapsed=(performance.now()-state.startedAt)/1000;
    const left=Math.max(0,state.duration-elapsed);
    $('timeLeft').textContent=Math.ceil(left);
    $('progressBar').style.transform=`scaleX(${left/state.duration})`;
    if(left<=0) finishSession(true);
  },80);
}

async function nextShot(){
  if(!state.running) return;
  clearTimeout(state.loopTimer);
  resetStage();
  $('trainingCue').textContent='相手の準備を見る';

  const effectivePace = getEffectivePace();
  const waitBeforePrep = Math.max(260, effectivePace*0.30 + randomInt(-120,120));
  const prepWindow = Math.max(240, effectivePace*0.28 + randomInt(-50,70));

  await sleep(waitBeforePrep);
  if(!state.running) return;

  const opponentStroke = Math.random()<0.5 ? 'FH' : 'BH';
  const targetSide = Math.random()<0.5 ? 'forehand' : 'backhand';
  let depth='none';
  if(state.mode==='four' || state.mode==='survival') depth=Math.random()<0.42?'short':'deep';

  showPreparation(opponentStroke);
  $('trainingCue').textContent='打点に注目';

  await sleep(prepWindow);
  if(!state.running) return;

  state.reps++;
  $('repCount').textContent = state.reps;
  doImpact(opponentStroke,targetSide,depth);
  $('trainingCue').textContent='すぐテイクバック！';

  const visibleTime = Math.max(560, effectivePace*0.48);
  state.loopTimer = setTimeout(()=>{ if(state.running) nextShot(); }, visibleTime);
}

function getEffectivePace(){
  if(state.mode!=='survival') return state.pace;
  const elapsed=(performance.now()-state.startedAt)/1000;
  const step=Math.min(6,Math.floor(elapsed/7));
  return Math.max(900,state.pace-step*100);
}

function showPreparation(stroke){
  $('opponent').className='opponent '+(stroke==='FH'?'prep-fh':'prep-bh');
}

function doImpact(stroke,targetSide,depth){
  $('opponent').className='opponent '+(stroke==='FH'?'hit-fh':'hit-bh');

  const sideOnScreen=screenSideFor(targetSide,state.hand);
  const stage=$('stage');
  stage.className='stage';
  const shotClass=depth==='short'?`shot-short-${sideOnScreen}`:`shot-${sideOnScreen}`;
  stage.classList.add(shotClass);

  $('impactFlash').classList.remove('flash');
  void $('impactFlash').offsetWidth;
  $('impactFlash').classList.add('flash');

  $('answerBadge').textContent=cueLabel(targetSide,depth);
  $('answerBadge').classList.remove('show');
  setTimeout(()=>{ if(state.running) $('answerBadge').classList.add('show'); },300);

  playCueSound(targetSide);
  if(navigator.vibrate) navigator.vibrate(18);
}

function cueLabel(targetSide,depth){
  let label=targetSide==='forehand'?'フォア':'バック';
  if(depth!=='none') label+=depth==='short'?'・前':'・後ろ';
  return label;
}

function screenSideFor(targetSide,hand){
  if(hand==='right') return targetSide==='forehand'?'right':'left';
  return targetSide==='forehand'?'left':'right';
}

function resetStage(){
  $('stage').className='stage';
  $('opponent').className='opponent prep-fh';
  $('answerBadge').classList.remove('show');
}

function finishSession(completed){
  if(!state.running && !$('trainingScreen').classList.contains('active')) return;
  state.running=false;
  clearInterval(state.timer);
  clearTimeout(state.loopTimer);
  resetStage();

  $('resultTitle').textContent=completed?'セット終了！':'途中終了';
  $('resultReps').textContent=state.reps;
  $('resultDuration').textContent=`${state.duration}秒`;
  $('resultLevel').textContent=`Lv.${state.level}`;
  $('resultMode').textContent=modeText(state.mode);

  let advice='';
  if(state.level<=2){
    advice='<strong>まずは打点で準備する習慣づけ</strong><p>ボールがネットを越えてからではなく、相手が当てた瞬間に肩を回し始めることを意識してください。</p>';
  }else if(state.level===3){
    advice='<strong>試合につながる基本速度です</strong><p>フォアかバックを当てることより、迷わず最初の一歩と肩の準備を出すことを優先してください。</p>';
  }else{
    advice='<strong>速いテンポでは小さく早く</strong><p>大きくラケットを引く必要はありません。スプリットからユニットターンまでを早く終えることが目標です。</p>';
  }
  $('resultAdvice').innerHTML=advice;

  saveHistory({
    at:new Date().toLocaleString('ja-JP'),
    mode:state.mode,
    level:state.level,
    duration:state.duration,
    reps:state.reps
  });
  show('resultScreen');
}

function saveHistory(entry){
  const list=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
  list.unshift(entry);
  localStorage.setItem(HISTORY_KEY,JSON.stringify(list.slice(0,10)));
}

function renderHistory(){
  const root=$('historyList');
  const list=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
  if(!list.length){
    root.innerHTML='<div class="empty-history">まだ記録がありません</div>';
    return;
  }
  root.innerHTML=list.map(item=>`
    <div class="history-row">
      <div><strong>${modeText(item.mode)} / Lv.${item.level}</strong><small>${item.at}</small></div>
      <div><b>${item.reps}球</b><span>${item.duration}秒</span></div>
    </div>`).join('');
}

function modeText(mode){
  if(mode==='fb') return '左右';
  if(mode==='four') return '4方向';
  return 'SURVIVAL';
}

function unlockAudio(){
  if(audioCtx) return;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass) return;
  audioCtx=new AudioContextClass();
}
function tone(freq,duration=0.1,volume=0.05,delay=0){
  if(!audioCtx) return;
  try{
    const osc=audioCtx.createOscillator();
    const gain=audioCtx.createGain();
    const now=audioCtx.currentTime+delay;
    osc.type='sine';
    osc.frequency.value=freq;
    gain.gain.setValueAtTime(0.001,now);
    gain.gain.exponentialRampToValueAtTime(volume,now+0.01);
    gain.gain.exponentialRampToValueAtTime(0.001,now+duration);
    osc.connect(gain);gain.connect(audioCtx.destination);
    osc.start(now);osc.stop(now+duration+0.02);
  }catch{}
}
function playTick(freq){ if(state.sound) tone(freq,0.08,0.035); }
function playCueSound(target){ if(state.sound) tone(target==='forehand'?920:720,0.10,0.05); }
