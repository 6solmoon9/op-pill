/* =========================================================
   PILL_VERSE — dashboard.js
   Player Dashboard: accumulated rewards, claim system,
   stats, and claim history.

   Key behaviour:
   - Rewards NEVER expire and accumulate indefinitely.
   - Each daily distribution ADDS to the existing pending balance.
   - CLAIM withdraws the full accumulated balance for that type.
   - "ACCUMULATED SINCE" shows the date of the oldest contribution.
   ========================================================= */

'use strict';

// ─── REWARD META ────────────────────────────────────────────

const REWARD_META = {
  tournament:    { icon: '🏆', label: 'Tournament Prize',    btnId: 'claim-tournament',    amtId: 'reward-tournament',    sinceId: 'acc-since-tournament'    },
  nft_bonus:     { icon: '💊', label: 'NFT Holder Bonus',    btnId: 'claim-nft',           amtId: 'reward-nft',           sinceId: 'acc-since-nft_bonus'     },
  participation: { icon: '👥', label: 'Participation Reward', btnId: 'claim-participation', amtId: 'reward-participation', sinceId: 'acc-since-participation'  },
};

// ─── OPEN / CLOSE ────────────────────────────────────────────

async function openDashboard() {
  const wallet = window._walletState?.address;
  if (!wallet) {
    showToast('Connect your wallet to view the dashboard.', 'warning');
    return;
  }
  openModal('modal-dashboard');
  await _refreshDashboard(wallet);
}

// ─── REFRESH ─────────────────────────────────────────────────

async function _refreshDashboard(wallet) {
  // Wallet info
  _setText('dash-address', fmtAddr(wallet));

  const nftType = localStorage.getItem('pill_verse_nft') || 'none';
  const nftEl   = document.getElementById('dash-nft-badge');
  if (nftEl) {
    nftEl.textContent = nftType === 'none' ? 'NO NFT' : nftType.toUpperCase();
    nftEl.className   = `dash-nft-badge nft-${nftType}`;
  }

  // Today's stats
  const today    = new Date().toISOString().split('T')[0];
  const gamesKey = `pill_verse_games_${today}`;
  _setText('dash-games',      localStorage.getItem(gamesKey) || '0');
  _setText('dash-best-score', parseInt(localStorage.getItem('pill_verse_hiScore') || '0', 10).toLocaleString());

  const spent = parseFloat(localStorage.getItem('pill_verse_spent') || '0');
  _setText('dash-spent', `$${spent.toFixed(2)}`);

  // Rank
  let rank = '#—';
  try {
    const lb  = JSON.parse(localStorage.getItem('pill_verse_leaderboard') || '[]');
    const idx = lb.findIndex(e => e.wallet && e.wallet.startsWith(wallet.slice(0, 4)));
    if (idx >= 0) rank = `#${idx + 1}`;
  } catch {}
  _setText('dash-rank', rank);

  // Seed demo rewards on first open (gives player something to interact with)
  if (typeof seedDemoRewards === 'function') await seedDemoRewards(wallet);

  // Rewards section
  await _renderRewards(wallet);

  // Claim history
  _renderHistory();
}

// ─── REWARDS ─────────────────────────────────────────────────

async function _renderRewards(wallet) {
  let claims = [];
  if (typeof getPlayerClaims === 'function') {
    claims = await getPlayerClaims(wallet);
  }

  // Build type → record map
  const byType = {};
  for (const c of claims) byType[c.reward_type] = c;

  let totalPending = 0;

  for (const [type, meta] of Object.entries(REWARD_META)) {
    const rec    = byType[type] || null;
    const amount = rec ? rec.total_amount_usd : 0;
    totalPending += amount;

    // Amount
    _setText(meta.amtId, `$${amount.toFixed(2)}`);

    // "ACCUMULATED SINCE" label
    const sinceEl = document.getElementById(meta.sinceId);
    if (sinceEl) {
      if (rec && rec.accumulated_since) {
        const d     = new Date(rec.accumulated_since + 'T00:00:00'); // avoid timezone shift
        const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const days  = rec.distributions_count || 1;
        sinceEl.textContent = `since ${label} · ${days} day${days !== 1 ? 's' : ''}`;
        sinceEl.style.display = 'block';
      } else {
        sinceEl.textContent   = '';
        sinceEl.style.display = 'none';
      }
    }

    // CLAIM button
    const btn = document.getElementById(meta.btnId);
    if (btn) {
      btn.disabled = amount <= 0;
      // Replace previous listener cleanly
      const newBtn = btn.cloneNode(true);
      newBtn.textContent = 'CLAIM';
      newBtn.disabled    = amount <= 0;
      if (amount > 0) {
        newBtn.addEventListener('click', () => _handleClaim(wallet, type, meta));
      }
      btn.replaceWith(newBtn);
    }
  }

  _setText('dash-total-pending', `$${totalPending.toFixed(2)}`);
}

async function _handleClaim(wallet, type, meta) {
  const btn = document.getElementById(meta.btnId);
  if (btn) { btn.disabled = true; btn.textContent = 'CLAIMING...'; }

  try {
    const { amount, txHash } = await claimReward(wallet, type);
    showToast(
      `${meta.icon} Claimed $${amount.toFixed(2)} (${meta.label})! TX: ${txHash.slice(0, 18)}…`,
      'success', 6000
    );
    await _renderRewards(wallet);
    _renderHistory();
  } catch (err) {
    showToast(err.message || 'Claim failed.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'CLAIM'; }
  }
}

// ─── CLAIM HISTORY ───────────────────────────────────────────

function _renderHistory() {
  const tbody = document.getElementById('dash-history-body');
  if (!tbody) return;

  let history = [];
  try { history = JSON.parse(localStorage.getItem('pill_verse_claim_history') || '[]'); } catch {}

  if (history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="dash-empty">No claims yet</td></tr>`;
    return;
  }

  tbody.innerHTML = history.map(h => {
    const m = REWARD_META[h.type] || { icon: '●', label: h.type };
    return `<tr>
      <td>${h.date}</td>
      <td>${m.icon} ${m.label}</td>
      <td class="dash-amount">$${parseFloat(h.amount).toFixed(2)}</td>
      <td><span class="dash-tx" title="${h.txHash}">${h.txHash.slice(0, 16)}…</span></td>
    </tr>`;
  }).join('');
}

// ─── UTILS ──────────────────────────────────────────────────

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─── INIT ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const btnDash = document.getElementById('btn-dashboard-header');
  if (btnDash) btnDash.addEventListener('click', openDashboard);

  // Show DASHBOARD button when wallet connects
  window.addEventListener('wallet:connected', () => {
    if (btnDash) btnDash.style.display = 'inline-flex';
    // If dashboard is open, refresh it
    const modal = document.getElementById('modal-dashboard');
    if (modal && modal.classList.contains('open')) {
      _refreshDashboard(window._walletState?.address);
    }
  });

  // Hide DASHBOARD button on disconnect (wallet button re-used as disconnect)
  document.getElementById('btn-wallet')?.addEventListener('click', () => {
    setTimeout(() => {
      if (btnDash) btnDash.style.display = window._walletState?.connected ? 'inline-flex' : 'none';
    }, 80);
  });
});
