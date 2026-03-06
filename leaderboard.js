/* =========================================================
   PILL_VERSE — leaderboard.js
   Leaderboard + Daily Prize Pool
   Step 4 placeholder — rendering wired to game.js data
   ========================================================= */

'use strict';

// ─── DEMO DATA ──────────────────────────────────────────────

const DEMO_LEADERS = [
  { rank:1, wallet:'bc1q...a7f2', nft:'MYTHICAL', ticket:'GOLD',   score:128400 },
  { rank:2, wallet:'bc1q...3k91', nft:'RARE',     ticket:'SILVER', score:89200  },
  { rank:3, wallet:'bc1q...m4n8', nft:'MYTHICAL', ticket:'GOLD',   score:76100  },
  { rank:4, wallet:'bc1q...x5p2', nft:'RARE',     ticket:'SILVER', score:61800  },
  { rank:5, wallet:'bc1q...n9q1', nft:'COMMON',   ticket:'BRONZE', score:45300  },
];

// ─── PRIZE POOL ─────────────────────────────────────────────

function updatePrizePool(ticketTier) {
  const prices = { bronze: 0.1, silver: 1.0, gold: 10.0 };
  const contribution = (prices[ticketTier] || 0) * 0.95;
  const today = new Date().toISOString().split('T')[0];

  // Reset pot if day changed
  const savedDate = localStorage.getItem('daily_pot_date');
  if (savedDate !== today) {
    localStorage.setItem('daily_pot', '0');
    localStorage.setItem('daily_pot_date', today);
  }

  const pot = parseFloat(localStorage.getItem('daily_pot') || '0') + contribution;
  localStorage.setItem('daily_pot', pot.toFixed(2));

  renderPrizePool();
}

function renderPrizePool() {
  const pot = parseFloat(localStorage.getItem('daily_pot') || '0');

  const _t = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  _t('pool-amount', `$${pot.toFixed(2)}`);
  _t('prize-1st',  `$${(pot * 0.15).toFixed(2)}`);
  _t('prize-2nd',  `$${(pot * 0.10).toFixed(2)}`);
  _t('prize-3rd',  `$${(pot * 0.08).toFixed(2)}`);

  // Also update game-section preview
  _t('preview-pot', `$${pot.toFixed(2)}`);
}

function startPotTimer() {
  function tick() {
    const now   = new Date();
    const next  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const diff  = next - now;

    const h  = Math.floor(diff / 3600000);
    const m  = Math.floor((diff % 3600000) / 60000);
    const s  = Math.floor((diff % 60000)  / 1000);
    const pad = n => String(n).padStart(2, '0');

    const el = document.getElementById('pool-timer');
    if (el) el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ─── LEADERBOARD RENDER ─────────────────────────────────────

function renderLeaderboard() {
  const tbody = document.getElementById('lb-body');
  if (!tbody) return;

  // Merge demo + localStorage entries
  let entries = [];
  try {
    const stored = JSON.parse(localStorage.getItem('pill_verse_leaderboard') || '[]');
    entries = stored.length ? stored : DEMO_LEADERS;
  } catch {
    entries = DEMO_LEADERS;
  }

  entries = entries.slice(0, 20);
  const playerWallet = window._walletState?.address;

  // Prize pool distribution
  const pot = parseFloat(localStorage.getItem('daily_pot') || '0');
  const prizeMap = { 0: pot * 0.15, 1: pot * 0.10, 2: pot * 0.08, 3: pot * 0.07 };

  tbody.innerHTML = '';
  entries.forEach((e, i) => {
    const isPlayer = playerWallet && e.wallet &&
      (e.wallet.startsWith(playerWallet.slice(0, 6)) || e.wallet === playerWallet);

    const nft    = (e.nft || 'NONE').toLowerCase();
    const score  = typeof e.score === 'number' ? e.score.toLocaleString() : (e.score || '0');
    const prize  = e.prize || (prizeMap[i] != null ? `$${prizeMap[i].toFixed(2)}` : '—');

    const tr = document.createElement('tr');
    if (isPlayer) tr.classList.add('is-player');
    tr.style.animationDelay = `${i * 0.05}s`;

    const nftClass = nft === 'mythical' ? 'mythical' : nft === 'rare' ? 'rare' : nft === 'common' ? 'common' : '';

    tr.innerHTML = `
      <td>${_rankIcon(i + 1)}</td>
      <td>${e.wallet || '—'}</td>
      <td><span class="lb-nft-badge ${nftClass}">${(e.nft || 'NONE').toUpperCase()}</span></td>
      <td>${(e.ticket || '—').toUpperCase()}</td>
      <td>${score}</td>
      <td>${prize}</td>
    `;
    tbody.appendChild(tr);
  });

  // Update top score preview
  if (entries.length) {
    const el = document.getElementById('preview-top');
    if (el) el.textContent = entries[0].score?.toLocaleString?.() || entries[0].score || '—';
  }
}

function _rankIcon(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

// ─── INIT ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Check/reset daily pot
  const today = new Date().toISOString().split('T')[0];
  if (localStorage.getItem('daily_pot_date') !== today) {
    localStorage.setItem('daily_pot', '0');
    localStorage.setItem('daily_pot_date', today);
  }

  renderPrizePool();
  renderLeaderboard();
  startPotTimer();

  // Hi-score preview
  const hs = localStorage.getItem('pill_verse_hiScore') || '0';
  const el = document.getElementById('preview-best');
  if (el) el.textContent = parseInt(hs, 10).toLocaleString();

  // Wallet connected event — refresh leaderboard to highlight player row
  window.addEventListener('wallet:connected', renderLeaderboard);
});
