(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: true });
  const video = document.getElementById('camera');
  const cameraBtn = document.getElementById('cameraBtn');
  const playBtn = document.getElementById('playBtn');
  const resetBtn = document.getElementById('resetBtn');
  const volumeControl = document.getElementById('volume');

  let W = 0, H = 0, DPR = 1;
  let stars = [], ripples = [], glints = [];
  let audioCtx = null, masterGain = null, hands = null, camera = null;
  let cameraOn = false, demoTimer = null, lastFingerPoints = [];
  let lastTrigger = { left: 0, right: 0 };
  let pointer = null, stepIndex = 0, nowTime = 0;
  const STRING_COUNT = 21;
  const stringState = [];

  // Standard D-pentatonic guzheng tuning from D2 to D6 (MIDI 38..86).
  // The visual rows run from the treble register at the top to the bass register at the bottom.
  const tuningLowToHigh = [38, 40, 42, 45, 47, 50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86];
  const strings = tuningLowToHigh.slice().reverse().map((midi, index) => ({
    index, midi, y: 0, phase: Math.random() * Math.PI * 2, pluck: 0, energy: 0
  }));

  // Water-glass palette: noticeable color, but softened with pearl-like highlights.
  const waterPalette = [
    { deep: '#168f9c', mid: '#53e4d7', light: '#e0fff5', tint: '#8cefe0' },
    { deep: '#416dd1', mid: '#77bdff', light: '#eefaff', tint: '#9caaff' },
    { deep: '#a44fa9', mid: '#e69bdd', light: '#fff0fd', tint: '#c5a4ff' },
    { deep: '#bc5d75', mid: '#ff9db6', light: '#fff0ea', tint: '#ffc5d4' },
    { deep: '#b77a35', mid: '#f2ca78', light: '#fff8d9', tint: '#ffe7a3' },
    { deep: '#378e67', mid: '#8ee5ad', light: '#efffe8', tint: '#b3f0c9' },
    { deep: '#6853c5', mid: '#b4a0ff', light: '#f9f1ff', tint: '#d7c4ff' }
  ];

  // Compact demonstration arrangement inspired by the uploaded numbered score.
  // Each step may ask for the left hand, right hand, or both at once.
  // A following step is revealed only after all notes in the current step are played.
  const score = [
    { l: [15, .29], r: [7, .72] },
    { l: null,       r: [6, .83] },
    { l: [17, .19], r: [9, .64] },
    { l: [13, .39], r: null },
    { l: null,       r: [10, .77] },
    { l: [16, .31], r: [8, .69] },
    { l: [18, .22], r: null },
    { l: null,       r: [5, .86] },
    { l: [14, .42], r: [9, .61] },
    { l: null,       r: [7, .75] },
    { l: [17, .24], r: [11, .66] },
    { l: [15, .36], r: null },
    { l: null,       r: [8, .81] },
    { l: [18, .17], r: [10, .71] },
    { l: [13, .32], r: null },
    { l: null,       r: [6, .62] },
    { l: [16, .40], r: [9, .78] },
    { l: [19, .21], r: null },
    { l: null,       r: [7, .67] },
    { l: [15, .34], r: [11, .82] }
  ];

  let activeStep = null;

  function currentStep() { return score[stepIndex] || null; }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    stars = Array.from({ length: Math.max(95, Math.floor(W * H / 1450)) }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.15 + .16,
      alpha: Math.random() * .62 + .12,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * .012 + .003
    }));
    // Use the entire screen height for all 21 strings, not a compressed middle band.
    const top = 2;
    const bottom = H - 2;
    const gap = (bottom - top) / (STRING_COUNT - 1);
    strings.forEach((s, i) => { s.y = top + i * gap; });
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = Number(volumeControl.value) / 100;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  volumeControl.addEventListener('input', () => {
    if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(Number(volumeControl.value) / 100, audioCtx.currentTime, .035);
  });

  // A softly plucked string approximation. Replace the oscillator source with licensed recordings
  // for sample-accurate real-instrument timbre.
  function playString(index, velocity = .66, side = 'right') {
    const s = strings[index];
    if (!s) return;
    ensureAudio();
    const frequency = 440 * Math.pow(2, (s.midi - 69) / 12);
    const t = audioCtx.currentTime;
    const partials = [1, 2.005, 3.01, 4.08, 5.42];
    const levels = [.22, .075, .04, .022, .012];
    partials.forEach((partial, k) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      osc.type = k === 0 ? 'triangle' : 'sine';
      osc.frequency.value = frequency * partial;
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(7000, 3600 / (1 + k * .44));
      const amp = Math.max(.001, velocity * levels[k]);
      gain.gain.setValueAtTime(.0001, t);
      gain.gain.exponentialRampToValueAtTime(amp, t + .009 + k * .001);
      gain.gain.exponentialRampToValueAtTime(.0001, t + [2.6, 1.9, 1.35, .95, .68][k]);
      osc.connect(filter); filter.connect(gain); gain.connect(masterGain);
      osc.start(t); osc.stop(t + 2.7);
    });
    s.pluck = 1;
    s.energy = velocity;
    const step = currentStep();
    const target = step?.[side];
    const x = target ? target[1] * W : (side === 'left' ? W * .28 : W * .72);
    addWaterRipple(x, s.y, velocity, index, side);
  }

  function addWaterRipple(x, y, velocity, stringIndex, side) {
    const paletteIndex = (stringIndex * 3 + Math.round(velocity * 7) + (side === 'left' ? 2 : 0)) % waterPalette.length;
    const color = waterPalette[paletteIndex];
    // Water rings are deliberately broad. They grow far beyond the tiny point and can overlap.
    ripples.push({
      x, y, color, side, age: 0,
      duration: 2450 + velocity * 500,
      maxRadius: Math.max(180, Math.min(W * .47, H * .54)) * (.78 + velocity * .58),
      strength: .58 + velocity * .42,
      phase: Math.random() * Math.PI * 2,
      seed: Math.random() * 100,
      vertical: .57 + Math.random() * .12
    });
    // Small, luminous droplets provide a little surface sparkle rather than confetti.
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = .35 + Math.random() * 1.55;
      glints.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * .55,
        life: .65 + Math.random() * .55, size: .55 + Math.random() * 1.35,
        color: i % 3 === 0 ? color.light : color.mid
      });
    }
  }

  function drawStars(time) {
    for (const s of stars) {
      s.phase += s.speed;
      ctx.globalAlpha = s.alpha * (.68 + .32 * Math.sin(s.phase));
      ctx.fillStyle = '#f7f0e5';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawStrings(time) {
    // The fine rows continue from one screen edge to the other, including behind the controls.
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      const energy = s.pluck;
      const amplitude = energy * Math.min(10, H * .012);
      const lineY = s.y;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 5) {
        const envelope = Math.sin(Math.PI * x / Math.max(1, W));
        const vibration = Math.sin(x * .046 + time * .026 + s.phase) * amplitude * envelope;
        const yy = lineY + vibration;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      const isAnchor = i % 5 === 0;
      ctx.strokeStyle = isAnchor ? 'rgba(222, 197, 137, .58)' : 'rgba(205, 212, 226, .43)';
      ctx.lineWidth = isAnchor ? 1.05 : .76;
      if (energy > .1) {
        ctx.shadowBlur = 9 + energy * 15;
        ctx.shadowColor = s.energy > .7 ? '#bdebf0' : '#dfc99f';
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      s.pluck *= .956;
      s.energy *= .94;
    }
  }

  function buildIrregularRing(x, y, radius, vertical, phase, seed, width = 1) {
    const segments = 112;
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const irregular = 1
        + .025 * Math.sin(a * 3 + phase + seed * .2)
        + .018 * Math.sin(a * 7 - phase * 1.7 + seed)
        + .009 * Math.sin(a * 13 + phase * .7 + seed * .37)
        + .006 * Math.cos(a * 19 - phase + seed * .11);
      const r = radius * irregular;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * vertical;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawWaterRipple(w, dt) {
    w.age += dt;
    const progress = Math.min(1, w.age / w.duration);
    // Ease outward like a wave spreading through a shallow water surface.
    const eased = 1 - Math.pow(1 - progress, 1.22);
    const baseR = eased * w.maxRadius;
    const fade = Math.pow(1 - progress, 1.12) * w.strength;
    if (fade < .008) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const waveColors = [w.color.deep, w.color.mid, w.color.light, w.color.tint];
    const offsets = [0, .115, .245, .385, .53, .68, .82, .95];
    offsets.forEach((offset, i) => {
      const r = Math.max(1, baseR * offset + 2.5);
      const alpha = fade * ([.62, .85, .54, .74, .47, .63, .34, .48][i]);
      const width = (i % 3 === 1 ? 3.8 : 1.7) * (1 + w.strength * .45) * (1 - progress * .2);
      const grad = ctx.createLinearGradient(w.x - r, w.y - r * .4, w.x + r, w.y + r * .5);
      grad.addColorStop(0, waveColors[(i + 0) % waveColors.length]);
      grad.addColorStop(.38, waveColors[(i + 1) % waveColors.length]);
      grad.addColorStop(.7, waveColors[(i + 2) % waveColors.length]);
      grad.addColorStop(1, waveColors[(i + 3) % waveColors.length]);
      buildIrregularRing(w.x, w.y, r, w.vertical, w.phase + i * .31 + progress * 2.2, w.seed + i * .73);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = alpha * .68;
      ctx.lineWidth = width * 2.2;
      ctx.shadowBlur = 18 * fade;
      ctx.shadowColor = w.color.mid;
      ctx.stroke();
      // Thin porcelain-like specular edge riding alongside the wider colored band.
      buildIrregularRing(w.x + 1.2, w.y - 1.2, Math.max(1, r - 2.2), w.vertical, w.phase + i * .31 + progress * 2.2, w.seed + i * .73);
      ctx.globalAlpha = alpha * .76;
      ctx.lineWidth = Math.max(.55, width * .48);
      ctx.strokeStyle = waveColors[(i + 2) % waveColors.length];
      ctx.shadowBlur = 5 * fade;
      ctx.stroke();
    });

    // A few broken crescent highlights make the rings feel like reflected water, not perfect UI circles.
    for (let i = 0; i < 5; i++) {
      const r = baseR * (.2 + i * .155);
      if (r < 4) continue;
      const start = w.phase + i * 1.11 + progress * .65;
      const span = .24 + (i % 3) * .18;
      ctx.beginPath();
      for (let j = 0; j <= 24; j++) {
        const a = start + (j / 24) * span;
        const rr = r * (1 + .035 * Math.sin(a * 5 + w.seed));
        const px = w.x + Math.cos(a) * rr;
        const py = w.y + Math.sin(a) * rr * w.vertical;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = w.color.light;
      ctx.globalAlpha = fade * .38;
      ctx.lineWidth = 1.2 + w.strength * .7;
      ctx.shadowBlur = 7 * fade;
      ctx.shadowColor = w.color.light;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGlints(dt) {
    for (const p of glints) {
      p.x += p.vx * dt * .05;
      p.y += p.vy * dt * .05;
      p.vx *= .992; p.vy *= .992; p.life -= dt / 1100;
      if (p.life > 0) {
        ctx.globalAlpha = Math.min(.72, p.life) * .8;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    glints = glints.filter(p => p.life > 0 && p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20);
  }

  function activeTargets() {
    const step = currentStep();
    if (!step) return [];
    const out = [];
    if (step.l && !step.hitL) out.push({ side: 'left', stringIndex: step.l[0], x: step.l[1] * W, y: strings[step.l[0]].y });
    if (step.r && !step.hitR) out.push({ side: 'right', stringIndex: step.r[0], x: step.r[1] * W, y: strings[step.r[0]].y });
    return out;
  }

  function drawTarget(target, time) {
    const pulse = 1 + Math.sin(time * .006 + target.stringIndex) * .13;
    const radius = 7.2 * pulse;
    // Soft red halo and a precise, visible center marker.
    const halo = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, radius * 3.5);
    halo.addColorStop(0, 'rgba(255, 74, 64, .5)');
    halo.addColorStop(.35, 'rgba(255, 70, 61, .18)');
    halo.addColorStop(1, 'rgba(255, 70, 61, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(target.x, target.y, radius * 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ff554d'; ctx.shadowColor = '#ff655c'; ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(target.x, target.y, radius * 1.85, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 135, 121, .82)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(target.x - radius * .22, target.y - radius * .25, radius * .28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 231, 214, .92)'; ctx.fill();
  }

  function draw(time) {
    const dt = Math.min(38, time - (nowTime || time));
    nowTime = time;
    ctx.clearRect(0, 0, W, H);
    drawStars(time);
    // Keep the ripple layer visually on top of the string layer, as though sound travels through water.
    drawStrings(time);
    ripples.forEach(w => drawWaterRipple(w, dt));
    ripples = ripples.filter(w => w.age < w.duration);
    drawGlints(dt);
    activeTargets().forEach(t => drawTarget(t, time));

    requestAnimationFrame(draw);
  }

  function finishStepIfReady() {
    const step = currentStep();
    if (!step) return;
    const leftDone = !step.l || step.hitL;
    const rightDone = !step.r || step.hitR;
    if (leftDone && rightDone) {
      stepIndex++;
      if (stepIndex >= score.length && demoTimer) {
        clearInterval(demoTimer); demoTimer = null; playBtn.textContent = '自动演示';
      }
    }
  }

  function tryHit(x, y, preferredSide = null, fromCamera = false) {
    const step = currentStep();
    if (!step) return false;
    const side = preferredSide || (x < W / 2 ? 'left' : 'right');
    const now = performance.now();
    if (now - lastTrigger[side] < (fromCamera ? 390 : 230)) return false;
    const key = side === 'left' ? 'l' : 'r';
    const hitKey = side === 'left' ? 'hitL' : 'hitR';
    const note = step[key];
    if (!note || step[hitKey]) return false;
    const targetX = note[1] * W;
    const targetY = strings[note[0]].y;
    const radius = fromCamera ? Math.max(38, Math.min(W, H) * .052) : Math.max(34, Math.min(W, H) * .045);
    if (Math.hypot(x - targetX, y - targetY) > radius) return false;

    lastTrigger[side] = now;
    step[hitKey] = true;
    const velocity = .48 + Math.random() * .34;
    playString(note[0], velocity, side);
    finishStepIfReady();
    return true;
  }

  canvas.addEventListener('pointermove', e => {
    if (!cameraOn) pointer = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerleave', () => { if (!cameraOn) pointer = null; });
  canvas.addEventListener('pointerdown', e => {
    ensureAudio();
    pointer = { x: e.clientX, y: e.clientY };
    tryHit(e.clientX, e.clientY, e.clientX < W / 2 ? 'left' : 'right');
  });

  async function startCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法访问摄像头，请使用 localhost 或 HTTPS 打开');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false
      });
      video.srcObject = stream;
      await video.play();
      if (!window.Hands || !window.Camera) throw new Error('手部追踪组件没有加载成功，请检查网络后刷新页面');
      hands = new Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: .62, minTrackingConfidence: .58 });
      hands.onResults(results => {
        const points = [];
        const landmarks = results.multiHandLandmarks || [];
        for (let i = 0; i < landmarks.length; i++) {
          const tip = landmarks[i][8];
          // Mirror horizontal movement so it feels like looking into a mirror.
          const p = { x: (1 - tip.x) * W, y: tip.y * H };
          points.push(p);
          const side = p.x < W / 2 ? 'left' : 'right';
          tryHit(p.x, p.y, side, true);
        }
        lastFingerPoints = points;
      });
      camera = new Camera(video, { onFrame: async () => { if (hands) await hands.send({ image: video }); }, width: 960, height: 720 });
      camera.start();
      cameraOn = true;
      cameraBtn.textContent = '关闭摄像头';
    } catch (err) {
      console.error(err);
      cameraBtn.textContent = '开启摄像头';
      alert(err?.message || '无法启动摄像头，请检查摄像头权限。');
    }
  }

  function stopCamera() {
    if (camera?.stop) camera.stop();
    if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
    cameraOn = false; lastFingerPoints = [];
    cameraBtn.textContent = '开启摄像头';
  }

  cameraBtn.addEventListener('click', () => cameraOn ? stopCamera() : startCamera());

  playBtn.addEventListener('click', () => {
    ensureAudio();
    if (demoTimer) {
      clearInterval(demoTimer); demoTimer = null; playBtn.textContent = '自动演示'; return;
    }
    if (stepIndex >= score.length) resetScore();
    playBtn.textContent = '停止演示';
    demoTimer = setInterval(() => {
      const step = currentStep();
      if (!step) {
        clearInterval(demoTimer); demoTimer = null; playBtn.textContent = '自动演示'; return;
      }
      // Paired notes in one score step sound together and bloom from both hands at once.
      if (step.l && !step.hitL) {
        step.hitL = true; playString(step.l[0], .68, 'left');
      }
      if (step.r && !step.hitR) {
        step.hitR = true; playString(step.r[0], .68, 'right');
      }
      finishStepIfReady();
      if (stepIndex >= score.length) {
        clearInterval(demoTimer); demoTimer = null; playBtn.textContent = '自动演示';
      }
    }, 820);
  });

  function resetScore() {
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    stepIndex = 0;
    score.forEach(step => { delete step.hitL; delete step.hitR; });
    ripples = []; glints = [];
    lastTrigger = { left: 0, right: 0 };
    strings.forEach(s => { s.pluck = 0; s.energy = 0; });
    playBtn.textContent = '自动演示';
  }
  resetBtn.addEventListener('click', resetScore);

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();
