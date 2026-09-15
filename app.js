const $ = (id) => document.getElementById(id);
const screens = ['setupScreen','countdownScreen','trainingScreen','resultScreen'];
const LEVEL_PACE = {1:2400,2:2000,3:1650,4:1360,5:1120};
const HISTORY_KEY = 'takeback_game_history_v4';

let state = {
  running:false,reps:0,good:0,late:0,score:0,combo:0,bestCombo:0,
  duration:30,startedAt:0,timer:null,loopTimer:null,current:null,
  coach:true,measure:true,sound:true,hand:'right',mode:'fb',level:3,pace:1650,
  reactionTimes:[],lastReaction:null,lastMeasured:false
};

let audioCtx = null;
let cameraStream = null;
let cameraReady = false;
let motionRaf = null;
let motionState = null;

function show(id){ screens.forEach(s => $(s).classList.toggle('active', s===id)); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function randomInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

$('startBtn').addEventListener('click', startSession);
$('againBtn').addEventListener('click', startSession);
$('homeBtn').addEventListener('click', ()=>{
  stopCamera();
  show('setupScreen');
  renderHistory();
  updateCameraStatus('カメラ未起動');
});
$('stopBtn').addEventListener('click', ()=>finishSession(false));
$('goodBtn').addEventListener('click', ()=>judge('good'));
$('lateBtn').addEventListener('click', ()=>judge('late'));
$('clearHistoryBtn').addEventListener('click', ()=>{
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

renderHistory();
updateCameraBadge();
updateReactionHUD();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

document.addEventListener('visibilitychange', ()=>{ if(document.hidden && state.running) finishSession(false); });

async function startSession(){
  state.duration = Number($('durationSelect').value);
  state.coach = $('coachToggle').checked;
  state.measure = $('measureToggle').checked;
  state.sound = $('soundToggle').checked;
  state.hand = $('handSelect').value;
  state.mode = $('modeSelect').value;
  state.level = Number($('levelSelect').value);
  state.pace = LEVEL_PACE[state.level];
  state.reps = state.good = state.late = state.score = state.combo = state.bestCombo = 0;
  state.current = null;
  state.reactionTimes = [];
  state.lastReaction = null;
  state.lastMeasured = false;

  if(state.sound) unlockAudio();
  if(state.measure) await ensureCamera();
  updateHUD();
  updateReactionHUD();
  $('coachPanel').classList.toggle('hidden', !state.coach);
  $('timeLeft').textContent = state.duration;
  $('progressBar').style.transform = 'scaleX(1)';
  $('levelLabel').textContent = state.mode==='survival' ? `SURVIVAL / Lv.${state.level}` : `Lv.${state.level}`;
  resetStage();

  show('countdownScreen');
  for(let n=3;n>=1;n--){ $('countdownValue').textContent=n; playTick(480); await sleep(650); }
  $('countdownValue').textContent='GO!'; playTick(860); await sleep(420);

  show('trainingScreen');
  if(state.measure && cameraReady){ updateCameraStatus('自動計測中'); }
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
  clearTimeout(state.loopTimer);
  stopMotionMeasurement();
  resetStage();
  state.current = null;
  state.lastReaction = null;
  state.lastMeasured = false;
  $('trainingCue').textContent='相手の準備を見る';

  const effectivePace = getEffectivePace();
  const waitBeforePrep = Math.max(280, effectivePace*0.32 + randomInt(-140,130));
  const prepWindow = Math.max(240, effectivePace*0.28 + randomInt(-60,70));
  await sleep(waitBeforePrep);
  if(!state.running) return;

  const opponentStroke = Math.random()<0.5 ? 'FH' : 'BH';
  const targetSide = Math.random()<0.5 ? 'forehand' : 'backhand';
  let depth = 'none';
  if(state.mode==='four' || state.mode==='survival') depth = Math.random()<0.42 ? 'short' : 'deep';
  state.current = { opponentStroke, targetSide, depth, judged:false };

  showPreparation(opponentStroke);
  $('trainingCue').textContent='打点に注目';
  await sleep(prepWindow);
  if(!state.running) return;

  state.reps++;
  doImpact(opponentStroke, targetSide, depth);

  if(state.measure && cameraReady){
    startMotionMeasurement();
  }

  if(state.coach){
    $('trainingCue').textContent='すぐ準備！ → 保護者が判定';
    if(state.measure && cameraReady){
      state.loopTimer=setTimeout(()=>{ if(state.running && state.current && !state.current.judged){ $('trainingCue').textContent='判定してください'; } }, 700);
    }
  }else{
    $('trainingCue').textContent = state.measure && cameraReady ? '自動計測中…' : 'すぐテイクバック！';
    const autoAdvanceDelay = Math.max(720, effectivePace*0.65);
    state.loopTimer=setTimeout(()=>{
      if(!state.running || !state.current || state.current.judged) return;
      if(state.measure && state.lastMeasured){
        const autoType = state.lastReaction <= 430 ? 'good' : 'late';
        judge(autoType, true);
      }else if(state.measure && cameraReady){
        judge('late', true);
      }else{
        nextCue();
      }
    }, autoAdvanceDelay);
  }
}

function getEffectivePace(){
  if(state.mode !== 'survival') return state.pace;
  const elapsed=(performance.now()-state.startedAt)/1000;
  const step=Math.min(5, Math.floor(elapsed/8));
  return Math.max(860, state.pace - step*110);
}

function showPreparation(stroke){
  const opponent = $('opponent');
  opponent.className = 'opponent ' + (stroke==='FH' ? 'prep-fh' : 'prep-bh');
}

function doImpact(stroke, targetSide, depth){
  const opponent = $('opponent');
  const sideOnScreen = screenSideFor(targetSide, state.hand);
  opponent.className = 'opponent ' + (stroke==='FH' ? 'hit-fh' : 'hit-bh');

  const stage = $('stage');
  stage.className = 'stage';
  const shotClass = depth === 'short' ? `shot-short-${sideOnScreen}` : `shot-${sideOnScreen}`;
  stage.classList.add(shotClass);

  $('impactFlash').classList.remove('flash'); void $('impactFlash').offsetWidth; $('impactFlash').classList.add('flash');
  $('answerBadge').textContent = cueLabel(targetSide, depth);
  $('answerBadge').classList.remove('show');
  setTimeout(()=>{ if(state.running) $('answerBadge').classList.add('show'); }, 280);
  playCueSound(targetSide);
  if(navigator.vibrate) navigator.vibrate(18);
}

function cueLabel(targetSide, depth){
  let label = targetSide === 'forehand' ? 'フォア' : 'バック';
  if(depth !== 'none') label += depth === 'short' ? '・前' : '・後ろ';
  return label;
}

function screenSideFor(targetSide, hand){
  if(hand === 'right') return targetSide === 'forehand' ? 'right' : 'left';
  return targetSide === 'forehand' ? 'left' : 'right';
}

function resetStage(){
  $('stage').className = 'stage';
  $('opponent').className = 'opponent prep-fh';
  $('answerBadge').classList.remove('show');
  $('reactionChip').classList.remove('show');
  $('feedbackPop').classList.remove('show','bad');
}

function judge(type, auto=false){
  if(!state.running || !state.current || state.current.judged) return;
  state.current.judged = true;
  clearTimeout(state.loopTimer);
  stopMotionMeasurement();

  let points = 0;
  if(type === 'good'){
    state.good++;
    state.combo++;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    points = 100 + Math.min(80, (state.combo-1)*10);
    if(state.lastMeasured){
      if(state.lastReaction <= 280) points += 40;
      else if(state.lastReaction <= 360) points += 20;
      else if(state.lastReaction <= 430) points += 10;
    }
    showFeedback(`+${points}`, true, state.combo);
    $('trainingCue').textContent = auto ? '自動判定：OK' : 'OK！ 次も打点で準備';
  }else{
    state.late++;
    state.combo = 0;
    points = 0;
    showFeedback('LATE', false, 0);
    $('trainingCue').textContent = auto ? '自動判定：遅れ' : '次はもう少し早く';
  }
  state.score += points;
  updateHUD();
  playResultSound(type === 'good');

  state.loopTimer = setTimeout(()=>{ if(state.running) nextCue(); }, 380);
}

function showFeedback(text, good, combo){
  const pop = $('feedbackPop');
  pop.textContent = text;
  pop.classList.toggle('bad', !good);
  pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show');
  if(combo >= 3 && good){
    const banner = $('streakBanner');
    banner.textContent = `${combo} COMBO!`;
    banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
  }
}

function updateHUD(){
  $('scoreValue').textContent = state.score;
  $('comboValue').textContent = state.combo;
}

function updateReactionHUD(){
  if(state.reactionTimes.length){
    const avg = Math.round(state.reactionTimes.reduce((a,b)=>a+b,0) / state.reactionTimes.length);
    const best = Math.min(...state.reactionTimes);
    $('avgRtValue').textContent = `${avg}ms`;
    $('bestRtValue').textContent = `${best}ms`;
    $('measureCountValue').textContent = state.reactionTimes.length;
  }else{
    $('avgRtValue').textContent = '—';
    $('bestRtValue').textContent = '—';
    $('measureCountValue').textContent = '0';
  }
}

function finishSession(completed){
  if(!state.running && !$('trainingScreen').classList.contains('active')) return;
  state.running = false;
  clearInterval(state.timer);
  clearTimeout(state.loopTimer);
  stopMotionMeasurement();
  stopCamera();
  updateCameraStatus('カメラ停止');
  resetStage();

  const total = state.good + state.late;
  const rate = total ? Math.round(state.good/total*100) : 0;
  const avgRt = state.reactionTimes.length ? Math.round(state.reactionTimes.reduce((a,b)=>a+b,0) / state.reactionTimes.length) : null;
  const bestRt = state.reactionTimes.length ? Math.min(...state.reactionTimes) : null;

  $('resultTitle').textContent = completed ? 'セット終了！' : '途中終了';
  $('resultScore').textContent = state.score;
  $('resultReps').textContent = state.reps;
  $('resultGood').textContent = state.coach || state.measure ? state.good : '—';
  $('resultLate').textContent = state.coach || state.measure ? state.late : '—';
  $('resultRate').textContent = total ? `${rate}%` : '—';
  $('resultCombo').textContent = state.bestCombo;
  $('resultAvgRt').textContent = avgRt ? `${avgRt}ms` : '—';
  $('resultBestRt').textContent = bestRt ? `${bestRt}ms` : '—';

  const rank = getRank(state.score, rate, avgRt);
  const rankEl = $('resultRank');
  rankEl.textContent = `RANK ${rank}`;
  rankEl.className = 'rank-badge rank-' + rank.toLowerCase();

  let advice = '';
  if(avgRt){
    if(avgRt <= 320) advice = '<strong>かなり速いです</strong><p>平均反応が速く、試合でも有効な初動に近づいています。次は前後判断かレベルアップに進めます。</p>';
    else if(avgRt <= 420) advice = '<strong>良い練習ゾーンです</strong><p>反応は十分実戦的です。遅れた球だけを振り返り、相手のラケットが前に出る瞬間に注目しましょう。</p>';
    else advice = '<strong>まずは予測を早く</strong><p>反応時間はまだ伸ばせます。レベルを1段下げるか、左右モードで「打点で準備」を徹底するのがおすすめです。</p>';
  }else{
    advice = '<strong>自動計測が取れませんでした</strong><p>前面カメラに上半身が入るように立ち、背景が静かな場所でもう一度試してください。</p>';
  }
  $('resultAdvice').innerHTML = advice;

  saveHistory({
    at: new Date().toLocaleString('ja-JP'),
    mode: state.mode,
    level: state.level,
    duration: state.duration,
    score: state.score,
    rate: total ? rate : null,
    avgRt,
    bestRt,
    reps: state.reps
  });
  show('resultScreen');
}

function getRank(score, rate, avgRt){
  if(score >= 1400 && rate >= 85 && avgRt && avgRt <= 320) return 'S';
  if(score >= 1000 && rate >= 75) return 'A';
  if(score >= 600) return 'B';
  return 'C';
}

function saveHistory(entry){
  const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  list.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0,10)));
}

function renderHistory(){
  const root = $('historyList');
  if(!root) return;
  const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if(!list.length){
    root.innerHTML = '<div class="empty-history">まだ記録がありません</div>';
    return;
  }
  root.innerHTML = list.map(item=>`
    <div class="history-row">
      <div><strong>${modeText(item.mode)} / Lv.${item.level}</strong><small>${item.at}</small></div>
      <div><b>${item.score}</b><span>${item.avgRt ? `平均 ${item.avgRt}ms` : '平均 —'}</span></div>
    </div>`).join('');
}
function modeText(mode){
  if(mode==='fb') return '左右';
  if(mode==='four') return '4方向';
  return 'SURVIVAL';
}

async function ensureCamera(){
  if(cameraReady && cameraStream) return true;
  if(!navigator.mediaDevices?.getUserMedia){
    updateCameraStatus('この端末ではカメラ利用不可');
    return false;
  }
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'user', width:{ideal:320}, height:{ideal:240} },
      audio: false
    });
    const video = $('cameraVideo');
    video.srcObject = cameraStream;
    await video.play().catch(()=>{});
    cameraReady = true;
    updateCameraStatus('カメラ準備OK');
    updateCameraBadge();
    return true;
  }catch(err){
    cameraReady = false;
    updateCameraStatus('カメラ許可が必要です');
    updateCameraBadge();
    return false;
  }
}

function stopCamera(){
  if(cameraStream){
    cameraStream.getTracks().forEach(t=>t.stop());
  }
  cameraStream = null;
  cameraReady = false;
  const video = $('cameraVideo');
  if(video){ video.pause(); video.srcObject = null; }
  updateCameraBadge();
}

function updateCameraStatus(text){
  const el = $('cameraStatus');
  if(el) el.textContent = text;
}
function updateCameraBadge(){
  const badge = $('cameraBadge');
  if(!badge) return;
  badge.textContent = (state.measure && cameraReady) ? 'AUTO ON' : 'AUTO OFF';
  badge.classList.toggle('on', state.measure && cameraReady);
}

function startMotionMeasurement(){
  if(!state.measure || !cameraReady) return;
  const baseline = captureMotionSample();
  if(!baseline) return;
  motionState = {
    baseline,
    start: performance.now(),
    hits:0,
    finished:false
  };
  updateCameraBadge();
  trackMotionFrame();
}

function stopMotionMeasurement(){
  if(motionRaf) cancelAnimationFrame(motionRaf);
  motionRaf = null;
  motionState = null;
}

function trackMotionFrame(){
  if(!motionState || motionState.finished || !state.running) return;
  const now = performance.now();
  const sample = captureMotionSample();
  if(sample){
    const diff = meanDiff(sample, motionState.baseline);
    const elapsed = now - motionState.start;
    if(elapsed > 90 && diff > 17) motionState.hits += 1; else motionState.hits = Math.max(0, motionState.hits - 0.5);
    if(motionState.hits >= 2){
      motionState.finished = true;
      const rt = Math.round(elapsed);
      onMotionDetected(rt);
      return;
    }
    if(elapsed > 1200){
      motionState.finished = true;
      return;
    }
  }
  motionRaf = requestAnimationFrame(trackMotionFrame);
}

function onMotionDetected(rt){
  state.lastReaction = rt;
  state.lastMeasured = true;
  state.reactionTimes.push(rt);
  updateReactionHUD();
  const chip = $('reactionChip');
  chip.textContent = `${rt} ms`;
  chip.classList.remove('show'); void chip.offsetWidth; chip.classList.add('show');
  if(!state.coach){
    const autoType = rt <= 430 ? 'good' : 'late';
    judge(autoType, true);
  }
}

function captureMotionSample(){
  const video = $('cameraVideo');
  const canvas = $('motionCanvas');
  if(!video || video.readyState < 2 || !canvas) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  const w = canvas.width, h = canvas.height;
  ctx.save();
  ctx.scale(-1,1);
  ctx.drawImage(video, -w, 0, w, h);
  ctx.restore();
  const { data } = ctx.getImageData(0,0,w,h);
  const out = [];
  const x0 = Math.floor(w*0.2), x1 = Math.floor(w*0.8);
  const y0 = Math.floor(h*0.15), y1 = Math.floor(h*0.95);
  for(let y=y0; y<y1; y+=2){
    for(let x=x0; x<x1; x+=2){
      const i = (y*w + x) * 4;
      const gray = (data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114);
      out.push(gray);
    }
  }
  return out;
}

function meanDiff(a,b){
  if(!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  for(let i=0;i<a.length;i++) sum += Math.abs(a[i]-b[i]);
  return sum / a.length;
}

function unlockAudio(){
  if(audioCtx) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if(!AudioContextClass) return;
  audioCtx = new AudioContextClass();
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
