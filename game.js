/* =========================================================
   PILL_VERSE — game.js
   PILL_CATCHER Game Engine
   Pure Vanilla JS + Canvas 2D API — no frameworks
   ========================================================= */

'use strict';

// ─── CONSTANTS ─────────────────────────────────────────────

const NFT_BONUSES = {
  none:     { lives: 1, multiplier: 1.0, label: 'NO NFT'   },
  common:   { lives: 2, multiplier: 1.2, label: 'COMMON'   },
  rare:     { lives: 3, multiplier: 2.5, label: 'RARE'     },
  mythical: { lives: 5, multiplier: 6.0, label: 'MYTHICAL' },
};

const TICKET_TIERS = {
  bronze: { price: 0.1,  label: 'BRONZE', multiplier: 1,  color: '#CD7F32' },
  silver: { price: 1.0,  label: 'SILVER', multiplier: 2,  color: '#C0C0C0' },
  gold:   { price: 10.0, label: 'GOLD',   multiplier: 5,  color: '#FFD700' },
};

const CANVAS_W  = 700;
const CANVAS_H  = 520;
const PILL_W    = 64;
const PILL_H    = 26;
const BASE_PTS  = 10;
const SPAWN_RATIO_BITCOIN = 0.65; // 65% bitcoins, 35% viruses

// ─── GAME STATE ─────────────────────────────────────────────

let gameRunning    = false;
let gameLoopId     = null;
let currentScore   = 0;
let currentLevel   = 1;
let currentCombo   = 1;
let currentLives   = 1;
let maxLives       = 1;
let coinsCollected = 0;
let gameStartTime  = 0;

let playerNFT    = 'none';
let playerWallet = null;
let selectedTier = 'bronze';

// Pill position
let pillX = CANVAS_W / 2;
const PILL_Y = CANVAS_H - 55;

// Falling objects & particles
let objects   = [];
let particles = [];

// Speed / intervals
let baseSpeed     = 2.5;
let spawnIntervalId = null;
let speedIntervalId = null;

// Visual effects
let comboFlashTime = 0;
let comboFlashText = '';
let screenFlashAlpha = 0;

// High score (persisted)
let highScore = parseInt(localStorage.getItem('pill_verse_hiScore') || '0', 10);

// ─── CANVAS REFERENCE (resolved after DOM ready) ────────────

let canvas = null;
let ctx    = null;

// ─── NFT DETECTION ──────────────────────────────────────────

function detectPlayerNFT() {
  if (!window._walletState?.connected) return 'none';
  return localStorage.getItem('pill_verse_nft') || 'none';
}

// ─── OVERLAY OPEN / CLOSE ───────────────────────────────────

function openGameOverlay() {
  playerNFT    = detectPlayerNFT();
  playerWallet = window._walletState?.address || null;
  // Raise matrix canvas above body background so it shows through the semi-transparent overlay
  const mc = document.getElementById('matrix-canvas');
  if (mc) mc.style.zIndex = '998';
  document.getElementById('game-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  showLobbyScreen();
}

function closeGameOverlay() {
  stopGame();
  document.getElementById('game-overlay').style.display = 'none';
  document.body.style.overflow = '';
  // Restore matrix canvas to its normal position behind page content
  const mc = document.getElementById('matrix-canvas');
  if (mc) mc.style.zIndex = '';
}

// ─── LOBBY SCREEN ───────────────────────────────────────────

function showLobbyScreen() {
  _section('game-lobby',       'flex');
  _section('game-area',        'none');
  _section('game-over-screen', 'none');
  _section('hud-left',         'none');
  _section('hud-right',        'none');

  // NFT info
  const nftInfo = NFT_BONUSES[playerNFT] || NFT_BONUSES.none;
  _setText('lobby-nft-label', nftInfo.label);
  _setText('lobby-nft-lives', String(nftInfo.lives));
  _setText('lobby-nft-mult',  `x${nftInfo.multiplier}`);

  // Daily pot
  const pot = parseFloat(localStorage.getItem('daily_pot') || '0');
  _setText('lobby-pot', `$${pot.toFixed(2)}`);

  // Hi-score
  _setText('lobby-hiscore', highScore.toLocaleString());

  updateTicketUI();
}

function updateTicketUI() {
  document.querySelectorAll('.ticket-btn').forEach(btn => {
    const tier = btn.dataset.tier;
    const t    = TICKET_TIERS[tier];
    const sel  = tier === selectedTier;
    btn.classList.toggle('selected', sel);
    btn.style.borderColor = sel ? t.color : '';
    btn.style.color       = sel ? t.color : '';
    btn.style.boxShadow   = sel ? `0 0 14px ${t.color}55` : '';
  });
}

// ─── GAME START ─────────────────────────────────────────────

function startGame() {
  _section('game-lobby',       'none');
  _section('game-area',        'flex');
  _section('game-over-screen', 'none');
  _section('hud-left',         'flex');
  _section('hud-right',        'flex');

  const nftBonus = NFT_BONUSES[playerNFT] || NFT_BONUSES.none;
  maxLives       = nftBonus.lives;
  currentLives   = maxLives;
  currentScore   = 0;
  currentLevel   = 1;
  currentCombo   = 1;
  coinsCollected = 0;
  pillX          = CANVAS_W / 2;
  objects        = [];
  particles      = [];
  baseSpeed      = 2.5;
  screenFlashAlpha = 0;
  comboFlashTime   = 0;
  gameStartTime    = Date.now();
  gameRunning      = true;

  resizeCanvas();
  updateHUD();
  _startSpawner();
  _startSpeedTimer();

  gameLoopId = requestAnimationFrame(_gameStep);
}

function stopGame() {
  gameRunning = false;
  if (gameLoopId)       { cancelAnimationFrame(gameLoopId); gameLoopId = null; }
  if (spawnIntervalId)  { clearInterval(spawnIntervalId); spawnIntervalId = null; }
  if (speedIntervalId)  { clearInterval(speedIntervalId); speedIntervalId = null; }
  objects   = [];
  particles = [];
}

// ─── CANVAS RESIZE ──────────────────────────────────────────

function resizeCanvas() {
  if (!canvas) return;
  const overlay = document.getElementById('game-overlay');
  const maxW    = Math.min(overlay ? overlay.clientWidth - 32 : CANVAS_W, CANVAS_W);
  const scale   = maxW / CANVAS_W;
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.style.width  = `${Math.round(CANVAS_W  * scale)}px`;
  canvas.style.height = `${Math.round(CANVAS_H  * scale)}px`;
}

// ─── SPAWNER ────────────────────────────────────────────────

function _startSpawner() {
  clearInterval(spawnIntervalId);
  const rate = Math.max(500, 1200 - (currentLevel - 1) * 80);
  spawnIntervalId = setInterval(_spawnObject, rate);
}

function _spawnObject() {
  if (!gameRunning) return;
  const isBitcoin = Math.random() < SPAWN_RATIO_BITCOIN;
  const r = isBitcoin ? 16 : 14;
  objects.push({
    type:     isBitcoin ? 'bitcoin' : 'virus',
    x:        r + Math.random() * (CANVAS_W - r * 2),
    y:        -r * 2,
    r,
    speed:    baseSpeed + Math.random() * 1.8,
    rotation: 0,
    rotSpeed: (Math.random() - 0.5) * 0.1,
  });
}

function _startSpeedTimer() {
  clearInterval(speedIntervalId);
  speedIntervalId = setInterval(() => {
    if (!gameRunning) return;
    baseSpeed    += 0.4;
    currentLevel += 1;
    updateHUD();
    _startSpawner(); // reset interval with tighter rate
  }, 30000);
}

// ─── MAIN GAME LOOP ─────────────────────────────────────────

function _gameStep() {
  if (!gameRunning) return;
  _update();
  _draw();
  gameLoopId = requestAnimationFrame(_gameStep);
}

function _update() {
  // Move falling objects
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    obj.y        += obj.speed;
    obj.rotation += obj.rotSpeed || 0;

    if (obj.y > CANVAS_H + obj.r * 2) {
      objects.splice(i, 1);
      continue;
    }

    if (_checkCollision(obj)) {
      objects.splice(i, 1);
      if (obj.type === 'bitcoin') _collectBitcoin(obj);
      else                        _hitVirus(obj);
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x     += p.vx;
    p.y     += p.vy;
    p.vy    += 0.18; // gravity
    p.life  -= 1;
    p.alpha  = p.life / p.maxLife;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (screenFlashAlpha > 0) screenFlashAlpha -= 0.012;
  if (comboFlashTime   > 0) comboFlashTime   -= 1;
}

function _checkCollision(obj) {
  const dx = obj.x - pillX;
  const dy = obj.y - PILL_Y;
  return Math.abs(dx) < (PILL_W / 2 + obj.r) * 0.72 &&
         Math.abs(dy) < (PILL_H / 2 + obj.r) * 0.85;
}

// ─── GAME EVENTS ────────────────────────────────────────────

function _collectBitcoin(obj) {
  coinsCollected++;
  currentCombo++;

  const nftMult    = (NFT_BONUSES[playerNFT] || NFT_BONUSES.none).multiplier;
  const ticketMult = TICKET_TIERS[selectedTier].multiplier;
  const pts        = Math.round(BASE_PTS * currentCombo * nftMult * ticketMult);
  currentScore    += pts;

  if (currentScore > highScore) {
    highScore = currentScore;
    localStorage.setItem('pill_verse_hiScore', String(highScore));
  }

  _spawnParticles(obj.x, obj.y, '#FFD700', 12);

  if (currentCombo > 2) {
    comboFlashText = `COMBO x${currentCombo}!`;
    comboFlashTime = 55;
  }

  updateHUD();
}

function _hitVirus(obj) {
  currentCombo     = 1;
  currentLives    -= 1;
  screenFlashAlpha = 0.18;

  _spawnParticles(obj.x, obj.y, '#FF003C', 20);
  updateHUD();
  _renderLives();

  if (currentLives <= 0) {
    _triggerGameOver();
  }
}

function _triggerGameOver() {
  gameRunning = false;
  clearInterval(spawnIntervalId);
  clearInterval(speedIntervalId);
  cancelAnimationFrame(gameLoopId);
  gameLoopId = null;

  // Burst particles
  for (let i = 0; i < 50; i++) {
    const colors = ['#FFD700', '#FF003C', '#00FFFF', '#8B00FF', '#00FF88'];
    _spawnParticle(
      CANVAS_W / 2 + (Math.random() - 0.5) * 280,
      CANVAS_H / 2 + (Math.random() - 0.5) * 160,
      colors[i % colors.length]
    );
  }
  _draw(); // one last frame with particles

  setTimeout(_showGameOver, 700);
}

function _showGameOver() {
  _section('game-area',        'none');
  _section('game-over-screen', 'flex');
  _section('hud-left',         'none');
  _section('hud-right',        'none');

  _setText('go-score',  currentScore.toLocaleString());
  _setText('go-high',   highScore.toLocaleString());
  _setText('go-coins',  String(coinsCollected));
  _setText('go-level',  String(currentLevel));
  _setText('go-nft',    (NFT_BONUSES[playerNFT] || NFT_BONUSES.none).label);
  _setText('go-ticket', TICKET_TIERS[selectedTier].label.toUpperCase());

  // Check leaderboard
  const lb   = _getLeaderboardData();
  const isTopTen = lb.length < 10 || currentScore > (lb[9]?.score ?? 0);
  const notice = document.getElementById('go-leaderboard-notice');
  if (notice) notice.style.display = isTopTen ? 'block' : 'none';

  _submitToLeaderboard();

  if (typeof updatePrizePool === 'function') updatePrizePool(selectedTier);
}

// ─── DRAW ───────────────────────────────────────────────────

function _draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Screen flash (virus hit)
  if (screenFlashAlpha > 0) {
    ctx.fillStyle = `rgba(255,0,60,${screenFlashAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Falling objects
  for (const obj of objects) {
    if (obj.type === 'bitcoin') _drawBitcoin(ctx, obj.x, obj.y, obj.r);
    else                        _drawVirus(ctx, obj.x, obj.y, obj.r, obj.rotation);
  }

  // Pill
  _drawPill(ctx, pillX, PILL_Y, PILL_W, PILL_H);

  // Particles
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Combo flash
  if (comboFlashTime > 0 && comboFlashText) {
    const a = comboFlashTime > 15 ? 1 : comboFlashTime / 15;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font        = 'bold 20px Orbitron, monospace';
    ctx.fillStyle   = '#FFD700';
    ctx.textAlign   = 'center';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur  = 22;
    ctx.fillText(comboFlashText, pillX, PILL_Y - 44);
    ctx.restore();
  }
}

// ─── DRAW HELPERS ───────────────────────────────────────────

function _drawPill(ctx, x, y, w, h) {
  const r = h / 2;
  ctx.save();
  ctx.shadowColor = '#00FFFF';
  ctx.shadowBlur  = 20;

  // Left half — violet
  const gL = ctx.createLinearGradient(x - w / 2, y - r, x, y + r);
  gL.addColorStop(0, '#B060FF');
  gL.addColorStop(1, '#6B00D7');
  ctx.fillStyle = gL;
  ctx.beginPath();
  ctx.arc(x - w / 2 + r, y, r, Math.PI / 2, 3 * Math.PI / 2);
  ctx.lineTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.closePath();
  ctx.fill();

  // Right half — gold
  const gR = ctx.createLinearGradient(x, y - r, x + w / 2, y + r);
  gR.addColorStop(0, '#FFE55C');
  gR.addColorStop(1, '#CC8800');
  ctx.fillStyle = gR;
  ctx.beginPath();
  ctx.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x, y - r);
  ctx.closePath();
  ctx.fill();

  // Shine
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.32, w * 0.32, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function _drawBitcoin(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur  = 18;

  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#FFE55C');
  g.addColorStop(1, '#CC8800');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // ₿ symbol
  ctx.font         = `bold ${Math.round(r * 1.15)}px Orbitron, monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#5A3800';
  ctx.fillText('₿', x, y + 1);

  ctx.restore();
}

function _drawVirus(ctx, x, y, r, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.shadowColor = '#FF003C';
  ctx.shadowBlur  = 14;

  // 8 spikes
  ctx.strokeStyle = '#FF003C';
  ctx.lineWidth   = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r,       Math.sin(a) * r);
    ctx.lineTo(Math.cos(a) * (r + 7), Math.sin(a) * (r + 7));
    ctx.stroke();
  }

  // Body
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#FF4060');
  g.addColorStop(1, '#7A0000');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.2, r * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( r * 0.3, -r * 0.2, r * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.18, r * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( r * 0.3, -r * 0.18, r * 0.09, 0, Math.PI * 2); ctx.fill();

  // Smile
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(0, r * 0.1, r * 0.32, 0.25, Math.PI - 0.25);
  ctx.stroke();

  ctx.restore();
}

// ─── PARTICLES ──────────────────────────────────────────────

function _spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) _spawnParticle(x, y, color);
}

function _spawnParticle(x, y, color) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 1.5 + Math.random() * 3.5;
  particles.push({
    x, y,
    vx:      Math.cos(angle) * speed,
    vy:      Math.sin(angle) * speed - 2,
    color,
    size:    2 + Math.random() * 3,
    life:    30 + Math.floor(Math.random() * 25),
    maxLife: 55,
    alpha:   1,
  });
}

// ─── HUD ────────────────────────────────────────────────────

function updateHUD() {
  _setText('score-val', currentScore.toLocaleString());
  _setText('level-val', String(currentLevel));
  _setText('combo-val', `x${currentCombo}`);

  const pot = parseFloat(localStorage.getItem('daily_pot') || '0');
  _setText('pot-val', `$${pot.toFixed(2)}`);

  const nftBonus = NFT_BONUSES[playerNFT] || NFT_BONUSES.none;
  _setText('game-nft-status',  `\u{1F48A} ${nftBonus.label} \u00B7 x${nftBonus.multiplier}`);

  const tier = TICKET_TIERS[selectedTier];
  _setText('game-ticket-info', `${tier.label} \u00B7 $${tier.price} \u00B7 x${tier.multiplier}`);

  _renderLives();
}

function _renderLives() {
  const el = document.getElementById('lives-display');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < maxLives; i++) {
    const span       = document.createElement('span');
    span.className   = 'life-pip';
    span.textContent = '\u{1F48A}';
    span.style.opacity = i < currentLives ? '1' : '0.15';
    el.appendChild(span);
  }
}

// ─── CONTROLS ───────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (!gameRunning) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); pillX = Math.max(PILL_W / 2, pillX - 20); }
  if (e.key === 'ArrowRight') { e.preventDefault(); pillX = Math.min(CANVAS_W - PILL_W / 2, pillX + 20); }
});

// Mouse
document.addEventListener('mousemove', (e) => {
  if (!gameRunning || !canvas) return;
  const rect   = canvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const nx     = (e.clientX - rect.left) * scaleX;
  if (nx >= 0 && nx <= CANVAS_W) {
    pillX = Math.max(PILL_W / 2, Math.min(CANVAS_W - PILL_W / 2, nx));
  }
});

// Touch
let _touchStartX = 0;
document.addEventListener('touchstart', (e) => {
  _touchStartX = e.touches[0].clientX;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!gameRunning) return;
  const dx   = e.touches[0].clientX - _touchStartX;
  _touchStartX = e.touches[0].clientX;
  pillX = Math.max(PILL_W / 2, Math.min(CANVAS_W - PILL_W / 2, pillX + dx * 2.2));
}, { passive: true });

// ─── LEADERBOARD ────────────────────────────────────────────

function _getLeaderboardData() {
  try { return JSON.parse(localStorage.getItem('pill_verse_leaderboard') || '[]'); }
  catch { return []; }
}

function _submitToLeaderboard() {
  if (currentScore === 0) return;
  const lb    = _getLeaderboardData();
  const entry = {
    wallet: playerWallet
      ? `${playerWallet.slice(0, 6)}...${playerWallet.slice(-4)}`
      : 'ANON',
    nft:    playerNFT.toUpperCase(),
    ticket: selectedTier.toUpperCase(),
    score:  currentScore,
    ts:     Date.now(),
  };
  lb.push(entry);
  lb.sort((a, b) => b.score - a.score);
  lb.splice(20);
  localStorage.setItem('pill_verse_leaderboard', JSON.stringify(lb));
  if (typeof renderLeaderboard === 'function') renderLeaderboard();
}

// ─── UTILS ──────────────────────────────────────────────────

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _section(id, display) {
  const el = document.getElementById(id);
  if (el) el.style.display = display;
}

// ─── DOM INIT ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas ? canvas.getContext('2d') : null;

  // Buttons
  const _on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };

  _on('btn-launch-game', openGameOverlay);
  _on('btn-exit-game',   closeGameOverlay);
  _on('btn-start-game',  startGame);
  _on('btn-play-again',  showLobbyScreen);
  _on('btn-go-mint', () => {
    closeGameOverlay();
    document.getElementById('mint')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Ticket tier buttons
  document.querySelectorAll('.ticket-btn').forEach(btn => {
    btn.onclick = () => { selectedTier = btn.dataset.tier; updateTicketUI(); };
  });

  // Wallet connected
  window.addEventListener('wallet:connected', () => {
    playerNFT    = detectPlayerNFT();
    playerWallet = window._walletState?.address || null;
  });

  // Resize
  window.addEventListener('resize', () => {
    if (document.getElementById('game-overlay')?.style.display !== 'none') resizeCanvas();
  });
});
