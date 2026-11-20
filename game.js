(() => {
  "use strict";

  const canvas = document.getElementById("world");
  const ctx = canvas.getContext("2d", { alpha: false });
  const startScreen = document.getElementById("start-screen");
  const pauseScreen = document.getElementById("pause-screen");
  const playButton = document.getElementById("play-button");
  const resumeButton = document.getElementById("resume-button");
  const pauseButton = document.getElementById("pause-button");
  const soundButton = document.getElementById("sound-button");
  const soundStatus = document.getElementById("sound-status");
  const joystick = document.getElementById("joystick");
  const joyKnob = document.getElementById("joy-knob");
  const toast = document.getElementById("toast");
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const player = { x: 0, z: 8, yaw: 0, vx: 0, vz: 0, speed: 0, step: 0, swing: 0 };
  const keys = new Set();
  const projectiles = [];
  let width = 0, height = 0, dpr = 1;
  let running = false, paused = false, soundOn = true, lastTime = 0, toastTimer = 0;
  let audioContext = null, joyPointer = null, joyVector = { x: 0, y: 0 };
  let lookPointer = null, lookX = 0, lookY = 0, lookMoved = false, lastToast = 0;
  const trees = [
    [-19, -10, 1.3], [18, -17, 1.1], [-25, 16, 1.2], [25, 11, 1.5], [-8, -31, 1.1],
    [33, -8, 1.1], [-35, -4, 1.35], [6, 30, 1.4], [42, 18, 1.2], [-45, 22, 1.2],
    [-28, -34, 1.15], [25, -39, 1.4], [49, -30, 1.2], [-42, -39, 1.4]
  ];
  const rocks = [[-11, -18], [21, 21], [35, -23], [-38, 6], [3, 36], [44, 2], [-32, -25], [14, -43]];
  const critters = [
    { x: 5, z: -13, hit: 0, kind: "bunny" }, { x: -14, z: -24, hit: 0, kind: "duck" },
    { x: 24, z: -4, hit: 0, kind: "squirrel" }, { x: -29, z: 31, hit: 0, kind: "bunny" },
    { x: 34, z: 29, hit: 0, kind: "duck" }, { x: -39, z: -17, hit: 0, kind: "squirrel" }
  ].map((critter, index) => ({
    ...critter,
    homeX: critter.x, homeZ: critter.z,
    targetX: critter.x, targetZ: critter.z,
    wanderTimer: index * .7 + .4,
    moveSpeed: .55 + (index % 3) * .12,
    phase: index * 1.7,
    moving: false
  }));
  const grass = [];
  let seed = 93751;
  function random() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 500; i++) grass.push({ x: (random() - .5) * 130, z: (random() - .5) * 130, size: .035 + random() * .07, shade: random() });

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.8);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  function terrain(x, z) {
    const hills = Math.sin(x * .075 + .4) * 1.18 + Math.cos(z * .065 - .6) * .85 +
      Math.sin((x + z) * .047) * .65 + Math.cos((x - z) * .035) * .55;
    const lakeDist = ((x - 11) / 13) ** 2 + ((z + 22) / 8.6) ** 2;
    const shore = clamp((lakeDist - .76) / .95, 0, 1);
    return hills * shore - .17;
  }
  function isLake(x, z) { return ((x - 11) / 13) ** 2 + ((z + 22) / 8.6) ** 2 < 1; }
  function camera() {
    const f = { x: Math.sin(player.yaw), z: -Math.cos(player.yaw) };
    const pos = { x: player.x - f.x * 7.2, y: terrain(player.x, player.z) + 4.0, z: player.z - f.z * 7.2 };
    const target = { x: player.x + f.x * 2.2, y: terrain(player.x, player.z) + 1.35, z: player.z + f.z * 2.2 };
    let fx = target.x - pos.x, fy = target.y - pos.y, fz = target.z - pos.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    const rl = Math.hypot(fz, fx) || 1;
    const right = { x: -fz / rl, y: 0, z: fx / rl };
    const up = { x: right.y * fz - right.z * fy, y: right.z * fx - right.x * fz, z: right.x * fy - right.y * fx };
    return { pos, fx, fy, fz, right, up, focal: height * .92 };
  }
  function project(x, y, z, cam) {
    const dx = x - cam.pos.x, dy = y - cam.pos.y, dz = z - cam.pos.z;
    const depth = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (depth < 2.5) return null;
    const sx = dx * cam.right.x + dy * cam.right.y + dz * cam.right.z;
    const sy = dx * cam.up.x + dy * cam.up.y + dz * cam.up.z;
    const scale = cam.focal / depth;
    return { x: width * .5 + sx * scale, y: height * .49 - sy * scale, scale, depth };
  }
  function clipNear(points, cam, near) {
    const depth = p => (p.x - cam.pos.x) * cam.fx + (p.y - cam.pos.y) * cam.fy + (p.z - cam.pos.z) * cam.fz;
    const clipped = [];
    for (let i = 0; i < points.length; i++) {
      const current = points[i], previous = points[(i + points.length - 1) % points.length];
      const currentDepth = depth(current), previousDepth = depth(previous);
      const currentInside = currentDepth >= near, previousInside = previousDepth >= near;
      if (currentInside !== previousInside) {
        const t = (near - previousDepth) / (currentDepth - previousDepth);
        clipped.push({
          x: previous.x + (current.x - previous.x) * t,
          y: previous.y + (current.y - previous.y) * t,
          z: previous.z + (current.z - previous.z) * t
        });
      }
      if (currentInside) clipped.push(current);
    }
    return clipped;
  }
  function poly(points, fill, stroke) {
    if (points.some(p => !p)) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, height * .72);
    sky.addColorStop(0, "#91c5df");
    sky.addColorStop(.58, "#cce4d9");
    sky.addColorStop(1, "#e4e8c7");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    const sun = ctx.createRadialGradient(width * .78, height * .16, 2, width * .78, height * .16, height * .21);
    sun.addColorStop(0, "rgba(255,251,210,.5)");
    sun.addColorStop(1, "rgba(255,251,210,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(width * .55, 0, width * .45, height * .5);
    ctx.globalAlpha = .23;
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 4; i++) {
      const x = ((i * .29 + .13) * width + (player.z * 1.2) % width) % (width + 120) - 60;
      const y = height * (.11 + (i % 3) * .065);
      ctx.beginPath();
      ctx.ellipse(x, y, 34, 8, 0, 0, TAU);
      ctx.ellipse(x + 18, y - 3, 23, 9, 0, 0, TAU);
      ctx.ellipse(x + 38, y + 1, 30, 7, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawGround(cam) {
    const step = 2.5;
    const cx = Math.floor(player.x / step) * step;
    const cz = Math.floor(player.z / step) * step;
    const half = 54;
    for (let z = cz - half; z < cz + half; z += step) {
      for (let x = cx - half; x < cx + half; x += step) {
        const corners = [
          [x, z], [x + step, z], [x + step, z + step], [x, z + step]
        ];
        const centerX = x + step / 2, centerZ = z + step / 2;
        const h = terrain(centerX, centerZ);
        const near = isLake(centerX, centerZ);
        const tint = h * 8;
        const rgb = near ? [101, 182, 191] : [119 + tint, 159 + tint, 98 + tint];
        const clipped = clipNear(corners.map(([gx, gz]) => ({ x: gx, y: terrain(gx, gz), z: gz })), cam, 4.5);
        if (clipped.length < 3) continue;
        const points = clipped.map(p => project(p.x, p.y, p.z, cam));
        if (points.some(p => !p)) continue;
        const color = `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
        poly(points, color, color);
        if (near && !isLake(x, z)) {
          // A narrow pale shoreline softens the transition into the water.
          const edge = clamp(1.05 - Math.abs(((centerX - 11) / 13) ** 2 + ((centerZ + 22) / 8.6) ** 2 - 1) * 18, 0, .45);
          if (edge > 0) { ctx.globalAlpha = edge; poly(points, "#e5dca6"); ctx.globalAlpha = 1; }
        }
      }
    }
    for (const tuft of grass) {
      const gx = player.x + tuft.x, gz = player.z + tuft.z;
      if (isLake(gx, gz)) continue;
      const p = project(gx, terrain(gx, gz) + .025, gz, cam);
      if (!p || p.scale < 1.4 || p.scale > 15) continue;
      ctx.globalAlpha = .23 + tuft.shade * .19;
      ctx.strokeStyle = tuft.shade > .5 ? "#e6e5a0" : "#507952";
      ctx.lineWidth = Math.max(.5, p.scale * tuft.size * .14);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.scale * tuft.size * .5, p.y - p.scale * tuft.size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawTree(x, z, size, cam) {
    const ground = project(x, terrain(x, z), z, cam);
    if (!ground || ground.scale > 100 || ground.scale < .8) return;
    const s = ground.scale * size;
    const sway = Math.sin(performance.now() * .0007 + x * 2) * s * .03;
    const trunkTop = { x: ground.x + sway, y: ground.y - s * 2.15 };
    ctx.fillStyle = "#735c3c";
    ctx.beginPath();
    ctx.moveTo(ground.x - s * .22, ground.y);
    ctx.lineTo(ground.x - s * .13, trunkTop.y);
    ctx.lineTo(ground.x + s * .13, trunkTop.y);
    ctx.lineTo(ground.x + s * .27, ground.y);
    ctx.fill();
    const layers = [
      [s * 1.25, s * .78, "#507b4f"],
      [s * .97, s * .65, "#689356"],
      [s * .69, s * .54, "#80a760"]
    ];
    layers.forEach(([w, h, color], i) => {
      const cy = trunkTop.y - s * (.33 + i * .48);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(ground.x + sway, cy, w, h, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#a9c779";
      ctx.globalAlpha = .4;
      ctx.beginPath();
      ctx.ellipse(ground.x - w * .18, cy - h * .2, w * .35, h * .22, -.2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }
  function drawRock(x, z, cam) {
    const p = project(x, terrain(x, z), z, cam);
    if (!p || p.scale > 80 || p.scale < .7) return;
    const s = p.scale;
    ctx.fillStyle = "#82917b";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - s * .13, s * .38, s * .2, -.12, Math.PI, TAU);
    ctx.lineTo(p.x + s * .33, p.y);
    ctx.ellipse(p.x, p.y, s * .38, s * .16, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "#c1c6a0";
    ctx.globalAlpha = .55;
    ctx.beginPath();
    ctx.ellipse(p.x - s * .1, p.y - s * .15, s * .11, s * .04, -.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawCritter(critter, cam) {
    const ground = project(critter.x, terrain(critter.x, critter.z), critter.z, cam);
    if (!ground || ground.scale < 1 || ground.scale > 90) return;
    const s = ground.scale;
    const hop = critter.moving ? Math.abs(Math.sin(critter.phase)) * s * (critter.kind === "bunny" ? .13 : .045) : 0;
    ctx.save();
    ctx.translate(ground.x, ground.y - hop);
    ctx.fillStyle = "#334b3d38";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * .38, s * .11, 0, 0, TAU);
    ctx.fill();
    if (critter.kind === "bunny") {
      ctx.fillStyle = "#e8d8bc";
      ctx.beginPath();
      ctx.ellipse(-s * .12, -s * .88, s * .095, s * .32, -.18, 0, TAU);
      ctx.ellipse(s * .12, -s * .9, s * .095, s * .32, .18, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#eaa6a0";
      ctx.beginPath();
      ctx.ellipse(-s * .12, -s * .9, s * .04, s * .21, -.18, 0, TAU);
      ctx.ellipse(s * .12, -s * .92, s * .04, s * .21, .18, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e8d8bc";
      ctx.beginPath();
      ctx.ellipse(0, -s * .4, s * .31, s * .29, 0, 0, TAU);
      ctx.arc(0, -s * .77, s * .22, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#fff5e3";
      ctx.beginPath(); ctx.arc(s * .13, -s * .8, s * .1, 0, TAU); ctx.fill();
      ctx.fillStyle = "#3e4938";
      ctx.beginPath(); ctx.arc(s * .17, -s * .8, s * .035, 0, TAU); ctx.fill();
      ctx.fillStyle = "#dc8f8d";
      ctx.beginPath(); ctx.arc(s * .22, -s * .72, s * .045, 0, TAU); ctx.fill();
    } else if (critter.kind === "duck") {
      ctx.fillStyle = "#f3d16a";
      ctx.beginPath();
      ctx.ellipse(0, -s * .38, s * .33, s * .28, 0, 0, TAU);
      ctx.arc(s * .13, -s * .7, s * .2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e99158";
      ctx.beginPath();
      ctx.moveTo(s * .28, -s * .7); ctx.lineTo(s * .45, -s * .65); ctx.lineTo(s * .28, -s * .6); ctx.fill();
      ctx.fillStyle = "#fff8de";
      ctx.beginPath(); ctx.arc(s * .19, -s * .75, s * .085, 0, TAU); ctx.fill();
      ctx.fillStyle = "#354534";
      ctx.beginPath(); ctx.arc(s * .22, -s * .75, s * .035, 0, TAU); ctx.fill();
      ctx.fillStyle = "#e99158";
      ctx.fillRect(-s * .09, -s * .15, s * .06, s * .12);
      ctx.fillRect(s * .1, -s * .15, s * .06, s * .12);
    } else {
      ctx.fillStyle = "#bb8055";
      ctx.beginPath();
      ctx.arc(-s * .28, -s * .48, s * .2, 0, TAU);
      ctx.ellipse(0, -s * .38, s * .28, s * .26, 0, 0, TAU);
      ctx.arc(s * .13, -s * .7, s * .19, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e0b78c";
      ctx.beginPath(); ctx.ellipse(s * .22, -s * .65, s * .12, s * .085, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#fff5e3";
      ctx.beginPath(); ctx.arc(s * .16, -s * .76, s * .085, 0, TAU); ctx.fill();
      ctx.fillStyle = "#354534";
      ctx.beginPath(); ctx.arc(s * .19, -s * .76, s * .035, 0, TAU); ctx.fill();
    }
    if (critter.hit > 0) {
      ctx.fillStyle = "#fff8ad";
      ctx.font = `bold ${Math.max(9, s * .22)}px ui-rounded, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("✦", 0, -s * 1.15);
    }
    ctx.restore();
  }
  function drawProjectile(projectile, cam) {
    const p = project(projectile.x, projectile.y, projectile.z, cam);
    if (!p || p.scale > 90) return;
    const s = clamp(p.scale, 1, 20);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(projectile.spin);
    ctx.fillStyle = "#4d3e2d";
    ctx.fillRect(-s * .04, -s * .45, s * .08, s * .5);
    ctx.fillStyle = "#f36f64";
    ctx.beginPath();
    ctx.ellipse(0, -s * .45, s * .17, s * .12, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f6f0dc";
    ctx.beginPath();
    ctx.ellipse(0, -s * .29, s * .12, s * .2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  function drawAvatar(cam) {
    const feet = project(player.x, terrain(player.x, player.z), player.z, cam);
    const baseX = feet?.x ?? width * .5;
    const baseY = feet?.y ?? height * .72;
    const scale = clamp(height / 700, .62, 1.45);
    const swing = player.swing;
    const bob = Math.sin(player.step) * Math.min(.09, player.speed * .025);
    const s = scale;
    ctx.save();
    ctx.translate(baseX, baseY + bob * 60 * s);
    // Soft ground shadow
    ctx.fillStyle = "#354e3755";
    ctx.beginPath(); ctx.ellipse(0, 2, 35 * s, 9 * s, 0, 0, TAU); ctx.fill();
    // Socks and legs
    ctx.fillStyle = "#dbb08a";
    ctx.beginPath();
    ctx.moveTo(-12 * s, -45 * s); ctx.lineTo(-5 * s, -45 * s); ctx.lineTo(-7 * s, -12 * s); ctx.lineTo(-17 * s, -12 * s);
    ctx.moveTo(5 * s, -45 * s); ctx.lineTo(12 * s, -45 * s); ctx.lineTo(17 * s, -12 * s); ctx.lineTo(7 * s, -12 * s); ctx.fill();
    ctx.fillStyle = "#f4f1e7";
    ctx.fillRect(-17 * s, -16 * s, 10 * s, 9 * s);
    ctx.fillRect(7 * s, -16 * s, 10 * s, 9 * s);
    ctx.fillStyle = "#354a3e";
    ctx.beginPath(); ctx.ellipse(-12 * s, -5 * s, 9 * s, 4 * s, -.08, 0, TAU); ctx.ellipse(12 * s, -5 * s, 9 * s, 4 * s, .08, 0, TAU); ctx.fill();
    // Blue boxer shorts
    ctx.fillStyle = "#526fc2";
    ctx.beginPath();
    ctx.moveTo(-17 * s, -78 * s); ctx.quadraticCurveTo(0, -82 * s, 17 * s, -78 * s);
    ctx.lineTo(15 * s, -47 * s); ctx.lineTo(3 * s, -45 * s); ctx.lineTo(0, -60 * s); ctx.lineTo(-5 * s, -45 * s);
    ctx.lineTo(-16 * s, -47 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#d5d9c7";
    ctx.fillRect(-17 * s, -80 * s, 34 * s, 5 * s);
    // Athletic back and shoulders
    ctx.fillStyle = "#d9a77e";
    ctx.beginPath();
    ctx.moveTo(-20 * s, -125 * s); ctx.quadraticCurveTo(-31 * s, -127 * s, -31 * s, -111 * s);
    ctx.lineTo(-24 * s, -82 * s); ctx.quadraticCurveTo(0, -75 * s, 24 * s, -82 * s);
    ctx.lineTo(31 * s, -111 * s); ctx.quadraticCurveTo(31 * s, -127 * s, 20 * s, -125 * s);
    ctx.lineTo(13 * s, -130 * s); ctx.quadraticCurveTo(0, -136 * s, -13 * s, -130 * s); ctx.closePath(); ctx.fill();
    // Arms
    ctx.strokeStyle = "#d9a77e";
    ctx.lineWidth = 9 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-22 * s, -120 * s); ctx.lineTo(-28 * s, -94 * s);
    ctx.moveTo(22 * s, -120 * s); ctx.lineTo(28 * s, -95 * s);
    ctx.stroke();
    ctx.fillStyle = "#d9a77e";
    ctx.beginPath(); ctx.arc(-28 * s, -91 * s, 5 * s, 0, TAU); ctx.arc(28 * s, -92 * s, 5 * s, 0, TAU); ctx.fill();
    // Short, tousled hair and ears. The character is turned toward the horizon.
    ctx.fillStyle = "#72533c";
    ctx.beginPath(); ctx.ellipse(0, -145 * s, 14 * s, 17 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#d9a77e";
    ctx.beginPath(); ctx.ellipse(0, -140 * s, 13 * s, 15 * s, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = "#72533c";
    ctx.beginPath();
    ctx.moveTo(-13 * s, -145 * s); ctx.quadraticCurveTo(-15 * s, -162 * s, -5 * s, -158 * s);
    ctx.quadraticCurveTo(2 * s, -165 * s, 8 * s, -157 * s); ctx.quadraticCurveTo(18 * s, -158 * s, 13 * s, -143 * s);
    ctx.quadraticCurveTo(5 * s, -150 * s, -1 * s, -146 * s); ctx.quadraticCurveTo(-8 * s, -150 * s, -13 * s, -145 * s); ctx.fill();
    // The plunger in his right hand
    ctx.save();
    ctx.translate(31 * s, -94 * s);
    ctx.rotate(-.27 + swing * 1.8);
    ctx.strokeStyle = "#604d38"; ctx.lineWidth = 2.5 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(3 * s, -31 * s); ctx.stroke();
    ctx.fillStyle = "#ec765f"; ctx.beginPath(); ctx.ellipse(3 * s, -32 * s, 8 * s, 4 * s, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  function render() {
    drawSky();
    const cam = camera();
    drawGround(cam);
    const things = [];
    for (const [x, z, size] of trees) things.push({ depth: Math.hypot(x - player.x, z - player.z), draw: () => drawTree(x, z, size, cam) });
    for (const [x, z] of rocks) things.push({ depth: Math.hypot(x - player.x, z - player.z), draw: () => drawRock(x, z, cam) });
    for (const critter of critters) things.push({ depth: Math.hypot(critter.x - player.x, critter.z - player.z), draw: () => drawCritter(critter, cam) });
    for (const projectile of projectiles) things.push({ depth: Math.hypot(projectile.x - player.x, projectile.z - player.z), draw: () => drawProjectile(projectile, cam) });
    things.sort((a, b) => b.depth - a.depth);
    for (const thing of things) thing.draw();
    drawAvatar(cam);
  }
  function tone(frequency, duration = .12, type = "sine", volume = .07) {
    if (!soundOn) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * .64), audioContext.currentTime + duration);
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      console.warn("Audio could not be started.", error);
    }
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
  }
  function action(swing) {
    if (!running || paused) return;
    if (swing) {
      player.swing = 1;
      tone(420, .18, "triangle", .08);
    } else {
      const f = { x: Math.sin(player.yaw), z: -Math.cos(player.yaw) };
      projectiles.push({
        x: player.x + f.x * .7, z: player.z + f.z * .7,
        y: terrain(player.x, player.z) + 1.35, vx: f.x * 11, vz: f.z * 11,
        vy: 4.4, spin: 0, life: 4
      });
      tone(560, .22, "sine", .08);
    }
  }
  document.getElementById("swing-button").addEventListener("pointerdown", e => { e.preventDefault(); action(true); });
  document.getElementById("throw-button").addEventListener("pointerdown", e => { e.preventDefault(); action(false); });
  window.addEventListener("keydown", e => {
    const key = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) e.preventDefault();
    keys.add(key);
    if (key === "e" && !e.repeat) action(false);
    if (key === " " && !e.repeat) action(true);
    if (key === "escape" && running) setPaused(!paused);
  });
  window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());
  canvas.addEventListener("click", () => {
    if (!running || paused || matchMedia("(pointer: coarse)").matches) return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    action(true);
  });
  canvas.addEventListener("contextmenu", e => {
    if (!running || paused || matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    action(false);
  });
  document.addEventListener("pointerlockchange", () => {
    const help = document.getElementById("desktop-help");
    if (help && document.pointerLockElement === canvas) help.style.opacity = ".4";
    else if (help) help.style.opacity = "";
  });
  document.addEventListener("mousemove", e => {
    if (document.pointerLockElement === canvas && running && !paused) player.yaw += e.movementX * .0028;
  });
  canvas.addEventListener("pointerdown", e => {
    if (e.pointerType === "touch" && e.clientX > width * .3) {
      lookPointer = e.pointerId; lookX = e.clientX; lookY = e.clientY; lookMoved = false;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener("pointermove", e => {
    if (e.pointerId === lookPointer && running && !paused) {
      const dx = e.clientX - lookX, dy = e.clientY - lookY;
      player.yaw += dx * .008;
      lookX = e.clientX; lookY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) lookMoved = true;
    }
  });
  canvas.addEventListener("pointerup", e => {
    if (e.pointerId === lookPointer) lookPointer = null;
  });
  joystick.addEventListener("pointerdown", e => {
    e.preventDefault(); joyPointer = e.pointerId; joystick.setPointerCapture(e.pointerId); updateJoy(e);
  });
  joystick.addEventListener("pointermove", e => { if (e.pointerId === joyPointer) updateJoy(e); });
  function updateJoy(e) {
    const rect = joystick.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const max = rect.width * .34, length = Math.hypot(dx, dy), scale = length > max ? max / length : 1;
    joyVector = { x: dx * scale / max, y: dy * scale / max };
    joyKnob.style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
  }
  function releaseJoy(e) {
    if (!e || e.pointerId === joyPointer) {
      joyPointer = null; joyVector = { x: 0, y: 0 }; joyKnob.style.transform = "";
    }
  }
  joystick.addEventListener("pointerup", releaseJoy);
  joystick.addEventListener("pointercancel", releaseJoy);
  playButton.addEventListener("click", () => {
    startScreen.classList.add("hidden");
    running = true; paused = false;
    tone(600, .2, "sine", .05);
    if (!matchMedia("(pointer: coarse)").matches) canvas.requestPointerLock?.();
  });
  function setPaused(value) {
    paused = value;
    pauseScreen.classList.toggle("hidden", !value);
    if (value) document.exitPointerLock?.();
  }
  pauseButton.addEventListener("click", () => { if (running) setPaused(!paused); });
  resumeButton.addEventListener("click", () => setPaused(false));
  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    soundStatus.textContent = soundOn ? "SOUND ON" : "SOUND OFF";
    soundButton.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
    if (soundOn) tone(660, .12);
  });

  function update(dt) {
    if (!running || paused) return;
    let forward = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - joyVector.y;
    let sideways = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0) + joyVector.x;
    const magnitude = Math.hypot(forward, sideways);
    if (magnitude > 1) { forward /= magnitude; sideways /= magnitude; }
    const speed = 4.8;
    const fx = Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = Math.sin(player.yaw);
    const targetX = (fx * forward + rx * sideways) * speed;
    const targetZ = (fz * forward + rz * sideways) * speed;
    const response = 1 - Math.exp(-7 * dt);
    player.vx += (targetX - player.vx) * response;
    player.vz += (targetZ - player.vz) * response;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    player.speed = Math.hypot(player.vx, player.vz);
    if (player.speed > .05) player.step += dt * (5 + player.speed * 1.5);
    player.swing = Math.max(0, player.swing - dt * 3.5);
    for (const critter of critters) {
      critter.phase += dt * (critter.kind === "bunny" ? 7 : 4);
      if (!critter.moving) {
        critter.wanderTimer -= dt;
        if (critter.wanderTimer <= 0) {
          let foundDestination = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            const angle = random() * TAU;
            const radius = 2 + random() * 4;
            const x = critter.homeX + Math.cos(angle) * radius;
            const z = critter.homeZ + Math.sin(angle) * radius;
            const crossesLake = Array.from({ length: 5 }, (_, i) => {
              const t = (i + 1) / 5;
              return isLake(critter.x + (x - critter.x) * t, critter.z + (z - critter.z) * t);
            }).some(Boolean);
            if (!isLake(x, z) && !crossesLake) {
              critter.targetX = x;
              critter.targetZ = z;
              foundDestination = true;
              break;
            }
          }
          if (foundDestination) critter.moving = true;
          else critter.wanderTimer = 1.5 + random() * 2;
        }
      } else {
        const dx = critter.targetX - critter.x, dz = critter.targetZ - critter.z;
        const distance = Math.hypot(dx, dz);
        const stride = critter.moveSpeed * dt;
        if (distance <= stride) {
          critter.x = critter.targetX;
          critter.z = critter.targetZ;
          critter.moving = false;
          critter.wanderTimer = 1.5 + random() * 2.5;
        } else {
          critter.x += dx / distance * stride;
          critter.z += dz / distance * stride;
        }
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt; p.vy -= 9 * dt; p.spin += dt * 12;
      for (const critter of critters) {
        if (Math.hypot(p.x - critter.x, p.z - critter.z) < .85 && p.y < terrain(critter.x, critter.z) + 2.7) {
          critter.hit = .6; p.life = 0;
          if (Date.now() - lastToast > 1200) { showToast("PLUNGER POP!"); lastToast = Date.now(); }
          tone(300 + Math.random() * 150, .24, "triangle", .09);
        }
      }
      if (p.y < terrain(p.x, p.z) + .1 || p.life <= 0) projectiles.splice(i, 1);
    }
    for (const critter of critters) critter.hit = Math.max(0, critter.hit - dt);
    if (player.swing > .7) {
      for (const critter of critters) {
        const dx = critter.x - player.x, dz = critter.z - player.z;
        const dist = Math.hypot(dx, dz);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        if (dist < 2.1 && dot > .35) {
          critter.hit = .6;
          if (Date.now() - lastToast > 1200) { showToast("PLUNGER BONK!"); lastToast = Date.now(); }
        }
      }
    }
  }
  function loop(now) {
    const dt = Math.min(.04, (now - (lastTime || now)) / 1000);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
