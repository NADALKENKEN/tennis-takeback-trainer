const $ = (id) => document.getElementById(id);
const screens = ['setupScreen','countdownScreen','trainingScreen','resultScreen'];
const LEVEL_PACE = {1:2350,2:1950,3:1600,4:1320,5:1080};
const HISTORY_KEY = 'takeback_game_history_v3';

let state = {
  running:false,reps:0,good:0,late:0,score:0,combo:0,bestCombo:0,
  duration:30,startedAt:0,timer:null,cueTimer:null,current:null,
  coach:true,sound:true,hand:'right',mode:'fb',level:3,pace:1600
};
let audioCtx = null;

function show(id){ screens.forEach(s => $(s).classList.toggle('active', s===id)); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function randomInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

$('startBtn').addEventListener('click', startSession);
$('againBtn').addEventListener('click', startSession);
$('homeBtn').addEventListener('click', ()=>{ show('setupScreen'); renderHistory(); });
$('stopBtn').addEventListener('click', ()=>finishSession(false));
$('goodBtn').addEventListener('click', ()=>judge('good'));
$('lateBtn').addEventListener('click', ()=>judge('late'));
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
  state.coach = $('coachToggle').checked;
  state.sound = $('soundToggle').checked;
  state.hand = $('handSelect').value;
  state.mode = $('modeSelect').value;
  state.level = Number($('levelSelect').value);
  state.pace = LEVEL_PACE[state.level];
  state.reps = state.good = state.late = state.score = state.combo = state.bestCombo = 0;
  state.current = null;

  if(state.sound) unlockAudio();
  updateHUD();
  $('coachPanel').classList.toggle('hidden', !state.coach);
  $('timeLeft').textContent = state.duration;
  $('progressBar').style.transform = 'scaleX(1)';
  $('levelLabel').textContent = state.mode==='survival' ? `SURVIVAL / Lv.${state.level}` : `Lv.${state.level}`;
  resetStage();

  show('countdownScreen');
  for(let n=3;n>=1;n--){ $('countdownValue').textContent=n; playTick(480); await sleep(650); }
  $('countdownValue').textContent='GO!'; playTick(820); await sleep(420);

  show('trainingScreen');
  state.running=true;
  state.startedAt=performance.now();
  tickClock();
  await sleep(250);
  nextCue();
}

function tickClock(){
  clearInterval(state.timer);
  state.timer=setInterval(()=>{
    if(!state.running) return;
    const elapsed=(performance.now()-state.startedAt)/1000;
    const left=Math.max(0,state.duration-elapsed);
    $('timeLeft').textContent=Math.ceil(left);
    $('progressBar').style.transform=`scaleX(${left/state.duration})`;
    if(left<=0) finishSession(true);
  },80);
}

async function nextCue(){
  if(!state.running) return;
  clearTimeout(state.cueTimer);
  resetStage();
  state.current = null;
  $('trainingCue').textContent='中央を見て待つ';

  const effectivePace=getEffectivePace();
  const waiting=Math.max(300, effectivePace*0.55 + randomInt(-180,220));
  await sleep(waiting);
  if(!state.running) return;

  flashImpact();
  await sleep(state.level>=4 ? 70 : 100);
  if(!state.running) return;

  const targetSide=Math.random()<0.5?'forehand':'backhand';
  let depth='none';
  if(state.mode==='four' || state.mode==='survival') depth=Math.random()<0.42?'short':'deep';
  state.current={targetSide,depth,judged:false};
  state.reps++;
  showCue(targetSide,depth);
  playCueSound(targetSide);
  if(navigator.vibrate) navigator.vibrate(16);

  if(state.coach){
    $('trainingCue').textContent='すぐ準備！ → 保護者が判定';
  }else{
    $('trainingCue').textContent='すぐテイクバック！';
    state.cueTimer=setTimeout(()=>{ if(state.running) nextCue(); }, Math.max(420,effectivePace*0.55));
  }
}

function getEffectivePace(){
  if(state.mode!=='survival') return state.pace;
  const elapsed=(performance.now()-state.startedAt)/1000;
  const progress=Math.min(1,elapsed/state.duration);
  return Math.max(820,state.pace-(progress*420));
}

function showCue(targetSide,depth){
  const side=screenSideFor(targetSide,state.hand);
  let main=side==='right'?'→':'←';
  let label=targetSide==='forehand'?'フォア':'バック';
  if(depth!=='none'){
    if(depth==='short'){
      main=side==='right'?'↗':'↖';
      label+='・前';
    }else{
      main=side==='right'?'↘':'↙';
      label+='・後ろ';
    }
  }
  $('arrowMain').textContent=main;
  $('arrowSub').textContent=label;
  $('arrowCue').className=`arrow-cue show ${targetSide}`;
  $('stage').classList.add(side==='right'?'cue-right':'cue-left');
}

function screenSideFor(targetSide,hand){
  if(hand==='right') return targetSide==='forehand'?'right':'left';
  return targetSide==='forehand'?'left':'right';
}

function flashImpact(){
  const dot=$('impactDot');
  dot.classList.remove('flash');
  void dot.offsetWidth;
  dot.classList.add('flash');
}

function resetStage(){
  $('arrowCue').className='arrow-cue';
  $('stage').className='stage';
  $('feedbackPop').classList.remove('show','bad');
  $('streakBanner').classList.remove('show');
}

function judge(type){
  if(!state.running || !state.current || state.current.judged) return;
  state.current.judged=true;
  clearTimeout(state.cueTimer);

  if(type==='good'){
    state.good++;
    state.combo++;
    state.bestCombo=Math.max(state.bestCombo,state.combo);
    const bonus=Math.min(150,(state.combo-1)*10);
    const points=100+bonus;
    state.score+=points;
    showFeedback(`+${points}`,false);
    if(state.combo>=3 && (state.combo===3 || state.combo%5===0)) showStreak(`${state.combo} COMBO!`);
    playResultSound(true);
    $('trainingCue').textContent='ナイス！ 次も早く';
  }else{
    state.late++;
    state.combo=0;
    state.score=Math.max(0,state.score-20);
    showFeedback('−20',true);
    playResultSound(false);
    $('trainingCue').textContent='次は矢印と同時に準備';
  }
  updateHUD();
  state.cueTimer=setTimeout(()=>{ if(state.running) nextCue(); },260);
}

function updateHUD(){
  $('scoreValue').textContent=state.score;
  $('comboValue').textContent=state.combo;
}

function showFeedback(text,bad){
  const el=$('feedbackPop');
  el.textContent=text;
  el.classList.remove('show','bad');
  if(bad) el.classList.add('bad');
  void el.offsetWidth;
  el.classList.add('show');
}
function showStreak(text){
  const el=$('streakBanner');
  el.textContent=text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

function finishSession(timeUp=true){
  if(!state.running && !$('trainingScreen').classList.contains('active')) return;
  state.running=false;
  clearInterval(state.timer);
  clearTimeout(state.cueTimer);
  resetStage();

  const total=state.good+state.late;
  const rate=state.coach && total ? Math.round(state.good/total*100) : null;
  const rank=getRank(rate,state.score);

  $('resultTitle').textContent=timeUp?'チャレンジ終了！':'ここまで！';
  $('resultScore').textContent=state.score;
  $('resultRank').textContent=`RANK ${rank}`;
  $('resultRank').className=`rank-badge rank-${rank.toLowerCase()}`;
  $('resultReps').textContent=state.reps;
  $('resultCombo').textContent=state.bestCombo;

  if(state.coach){
    $('resultGood').textContent=state.good;
    $('resultLate').textContent=state.late;
    $('resultRate').textContent=(rate??0)+'%';
    $('resultAdvice').innerHTML=adviceHTML(rate,state.level);
    saveHistory({
      date:new Date().toISOString(),score:state.score,rate:rate??0,reps:state.reps,
      combo:state.bestCombo,level:state.level,mode:state.mode
    });
  }else{
    $('resultGood').textContent='—';
    $('resultLate').textContent='—';
    $('resultRate').textContent='—';
    $('resultAdvice').innerHTML='<strong>動作優先モード</strong><p>採点なしでもOKです。矢印が出た瞬間に肩とラケットの準備が始まることを最優先にしてください。</p>';
  }
  show('resultScreen');
}

function getRank(rate,score){
  if(rate===null) return score>=1500?'A':'B';
  if(rate>=92 && score>=1200) return 'S';
  if(rate>=85) return 'A';
  if(rate>=70) return 'B';
  return 'C';
}

function adviceHTML(rate,level){
  if(rate>=90) return `<strong>かなり速く準備できています</strong><p>成功率${rate}%です。次はLv.${Math.min(5,level+1)}か「4方向」に上げてみましょう。</p>`;
  if(rate>=75) return `<strong>ちょうど良い難易度です</strong><p>成功率${rate}%です。同じレベルで3回続けて85%以上を狙いましょう。</p>`;
  return `<strong>一段ゆっくりで精度を作ろう</strong><p>成功率${rate}%です。矢印を確認してから大きく引くのではなく、見えた瞬間に肩が動き始めればOKです。</p>`;
}

function saveHistory(item){
  const list=loadHistory();
  list.unshift(item);
  localStorage.setItem(HISTORY_KEY,JSON.stringify(list.slice(0,12)));
}
function loadHistory(){
  try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch{return [];}
}
function renderHistory(){
  const root=$('historyList');
  const list=loadHistory();
  if(!list.length){
    root.innerHTML='<div class="empty-history">まだ記録はありません。最初の30秒チャレンジをやってみよう。</div>';
    return;
  }
  root.innerHTML=list.slice(0,5).map(x=>{
    const d=new Date(x.date);
    const date=`${d.getMonth()+1}/${d.getDate()}`;
    return `<div class="history-row"><div><strong>${date}</strong><small>Lv.${x.level} ・ ${modeName(x.mode)}</small></div><div><b>${x.score}</b><span>${x.rate}% / ${x.combo} combo</span></div></div>`;
  }).join('');
}
function modeName(m){ return m==='fb'?'左右':m==='four'?'4方向':'サバイバル'; }

function unlockAudio(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return;
  if(!audioCtx) audioCtx=new AC();
  if(audioCtx.state==='suspended') audioCtx.resume().catch(()=>{});
}
function tone(freq,duration=0.09,volume=0.045,delay=0){
  if(!state.sound) return;
  unlockAudio();
  if(!audioCtx) return;
  try{
    const osc=audioCtx.createOscillator();
    const gain=audioCtx.createGain();
    const now=audioCtx.currentTime+delay;
    osc.type='sine'; osc.frequency.value=freq;
    gain.gain.setValueAtTime(0.001,now);
    gain.gain.exponentialRampToValueAtTime(volume,now+0.008);
    gain.gain.exponentialRampToValueAtTime(0.001,now+duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(now); osc.stop(now+duration+0.02);
  }catch{}
}
function playTick(freq){ if(state.sound) tone(freq,0.08,0.035); }
function playCueSound(target){ if(state.sound) tone(target==='forehand'?920:720,0.10,0.05); }
function playResultSound(ok){
  if(!state.sound) return;
  if(ok){ tone(980,0.08,0.04); tone(1240,0.11,0.035,0.07); }
  else tone(250,0.14,0.045);
}
