/* =========================================================
   PILL_VERSE — supabase.js
   Supabase integration + localStorage demo fallback.

   pending_claims schema (one active record per wallet+type):
     wallet_address     TEXT
     reward_type        TEXT  -- 'tournament' | 'nft_bonus' | 'participation'
     total_amount_usd   DECIMAL  -- running total, grows with each distribution
     accumulated_since  DATE     -- date of the FIRST distribution (never changes)
     distributions_count INTEGER -- how many daily cycles have contributed
     last_updated       TIMESTAMPTZ
     is_claimed         BOOLEAN  -- TRUE after CLAIM; new cycle creates a fresh record
     claimed_at         TIMESTAMPTZ
     tx_hash            TEXT

   Partial unique index keeps one unclaimed record per wallet+type:
     CREATE UNIQUE INDEX idx_active_claim
       ON pending_claims (wallet_address, reward_type)
       WHERE is_claimed = FALSE;
   ========================================================= */

'use strict';

// ─── CONFIG ─────────────────────────────────────────────────

const SUPABASE_URL      = 'https://ebmuodthqcfxafybqxkj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_klHSSbE-Aw11jBavgfKdjg_8Q976D7U';

const _supaReady = !SUPABASE_URL.startsWith('YOUR_') &&
                   typeof window.supabase !== 'undefined';

const _db = _supaReady
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ─── TREASURY SPLIT (matches CURSOR_PROMPT spec) ─────────────

const TREASURY_SPLIT = {
  devFee:            0.05,
  nftHolderPool:     0.25,
  liquidityPool:     0.10,
  place1:            0.15,
  place2:            0.10,
  place3:            0.08,
  place4:            0.07,
  participationPool: 0.20,
};

// ─── LOCAL STORAGE HELPERS ──────────────────────────────────

function _ls(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function _lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function _getClaims()         { return _ls('pill_verse_claims',        {}); }
function _saveClaims(data)    { _lsSet('pill_verse_claims',        data); }
function _getHistory()        { return _ls('pill_verse_claim_history', []); }
function _saveHistory(data)   { _lsSet('pill_verse_claim_history',  data); }

function _rand16() {
  return [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

// ─── PENDING CLAIMS — GET ────────────────────────────────────

/**
 * Returns all unclaimed reward records for a wallet.
 * Each record: { reward_type, total_amount_usd, accumulated_since,
 *                distributions_count, last_updated }
 */
async function getPlayerClaims(wallet) {
  if (!wallet) return [];

  if (_db) {
    const { data } = await _db
      .from('pending_claims')
      .select('*')
      .eq('wallet_address', wallet)
      .eq('is_claimed', false);
    return data || [];
  }

  // Demo: localStorage
  const all = _getClaims();
  return Object.entries(all)
    .filter(([k, v]) => k.startsWith(wallet + ':') && !v.is_claimed)
    .map(([k, v]) => ({ reward_type: k.split(':')[1], ...v }));
}

// ─── PENDING CLAIMS — ADD (accumulate) ──────────────────────

/**
 * Add amountUsd to the wallet's running balance for rewardType.
 * If an unclaimed record exists → increments it.
 * If not → creates a new record with accumulated_since = today.
 * Rewards NEVER expire; each daily distribution stacks on top.
 */
async function addRewardToBalance(wallet, rewardType, amountUsd) {
  if (!wallet || !(amountUsd > 0)) return;

  const today = _today();
  const now   = new Date().toISOString();

  if (_db) {
    const { data: existing } = await _db
      .from('pending_claims')
      .select('*')
      .eq('wallet_address', wallet)
      .eq('reward_type',    rewardType)
      .eq('is_claimed',     false)
      .maybeSingle();

    if (existing) {
      await _db.from('pending_claims').update({
        total_amount_usd:    existing.total_amount_usd + amountUsd,
        distributions_count: (existing.distributions_count || 1) + 1,
        last_updated:        now,
      }).eq('id', existing.id);
    } else {
      await _db.from('pending_claims').insert({
        wallet_address:      wallet,
        reward_type:         rewardType,
        total_amount_usd:    amountUsd,
        accumulated_since:   today,
        distributions_count: 1,
        last_updated:        now,
        is_claimed:          false,
      });
    }
    return;
  }

  // Demo: localStorage
  const all = _getClaims();
  const key = `${wallet}:${rewardType}`;
  const rec = all[key];

  if (rec && !rec.is_claimed) {
    // Accumulate on top of existing balance
    all[key] = {
      ...rec,
      total_amount_usd:    rec.total_amount_usd + amountUsd,
      distributions_count: (rec.distributions_count || 1) + 1,
      last_updated:        now,
    };
  } else {
    // New record — accumulated_since never changes after creation
    all[key] = {
      total_amount_usd:    amountUsd,
      accumulated_since:   today,
      distributions_count: 1,
      last_updated:        now,
      is_claimed:          false,
    };
  }
  _saveClaims(all);
}

// ─── PENDING CLAIMS — CLAIM ──────────────────────────────────

/**
 * Claim the full accumulated balance for rewardType.
 * Marks the record as claimed (a new distribution will create a fresh record).
 * Returns { amount, txHash }.
 */
async function claimReward(wallet, rewardType) {
  if (!wallet) throw new Error('No wallet connected');

  if (_db) {
    const { data: claim } = await _db
      .from('pending_claims')
      .select('*')
      .eq('wallet_address', wallet)
      .eq('reward_type',    rewardType)
      .eq('is_claimed',     false)
      .maybeSingle();

    if (!claim || !(claim.total_amount_usd > 0)) throw new Error('Nothing to claim');

    const txHash = 'tx_' + _rand16();
    await _db.from('pending_claims').update({
      is_claimed: true,
      claimed_at: new Date().toISOString(),
      tx_hash:    txHash,
    }).eq('id', claim.id);

    _appendClaimHistory({ date: _fmtDate(new Date()), type: rewardType, amount: claim.total_amount_usd, txHash });
    return { amount: claim.total_amount_usd, txHash };
  }

  // Demo: localStorage
  const all = _getClaims();
  const key = `${wallet}:${rewardType}`;
  const rec = all[key];

  if (!rec || rec.is_claimed || !(rec.total_amount_usd > 0)) {
    throw new Error('Nothing to claim');
  }

  const amount = rec.total_amount_usd;
  const txHash = 'tx_' + _rand16();

  all[key] = { ...rec, is_claimed: true, claimed_at: new Date().toISOString(), tx_hash: txHash };
  _saveClaims(all);

  _appendClaimHistory({ date: _fmtDate(new Date()), type: rewardType, amount, txHash });
  return { amount, txHash };
}

function _appendClaimHistory(entry) {
  const history = _getHistory();
  history.unshift(entry);
  _saveHistory(history.slice(0, 50));
}

// ─── DAILY DISTRIBUTION ──────────────────────────────────────

/**
 * Called at 00:00 UTC each day.
 * Adds new rewards ON TOP of existing unclaimed balances (never resets them).
 * In demo mode, distributes based on localStorage leaderboard.
 */
async function runDailyDistribution() {
  const pot = parseFloat(localStorage.getItem('daily_pot') || '0');
  if (pot <= 0) return;

  const wallet = window._walletState?.address;
  if (!wallet) return;

  let lb = [];
  try { lb = JSON.parse(localStorage.getItem('pill_verse_leaderboard') || '[]'); } catch {}

  // Tournament prizes for top 4
  const placeShares = [
    TREASURY_SPLIT.place1,
    TREASURY_SPLIT.place2,
    TREASURY_SPLIT.place3,
    TREASURY_SPLIT.place4,
  ];

  for (let i = 0; i < Math.min(4, lb.length); i++) {
    const entry = lb[i];
    if (entry && entry.wallet && entry.wallet.includes(wallet.slice(0, 4))) {
      await addRewardToBalance(wallet, 'tournament', pot * placeShares[i]);
    }
  }

  // NFT holder bonus
  const nftType  = localStorage.getItem('pill_verse_nft') || 'none';
  const nftShare = { none: 0, common: 1, rare: 2.5, mythical: 6 };
  const shares   = nftShare[nftType] || 0;
  if (shares > 0) {
    await addRewardToBalance(wallet, 'nft_bonus', pot * TREASURY_SPLIT.nftHolderPool * (shares / shares));
  }

  // Participation pool (≥10 paid games today)
  const gamesKey   = `pill_verse_games_${_today()}`;
  const gamesToday = parseInt(localStorage.getItem(gamesKey) || '0', 10);
  if (gamesToday >= 10) {
    await addRewardToBalance(wallet, 'participation', pot * TREASURY_SPLIT.participationPool);
  }
}

/**
 * Seed demo rewards for a wallet that has none yet, so the dashboard
 * has something to display on first open.
 */
async function seedDemoRewards(wallet) {
  if (!wallet) return;

  const all    = _getClaims();
  const hasAny = Object.keys(all).some(k => k.startsWith(wallet + ':') && !all[k].is_claimed);
  if (hasAny) return;

  const d0 = _dateOffset(-3);
  const d1 = _dateOffset(-1);

  const seeds = [
    { type: 'tournament',    amount: 2.15, since: d0, count: 3 },
    { type: 'participation', amount: 0.58, since: d1, count: 1 },
  ];

  const nftType = localStorage.getItem('pill_verse_nft') || 'none';
  if (nftType !== 'none') {
    seeds.push({ type: 'nft_bonus', amount: 0.94, since: d0, count: 3 });
  }

  const now = new Date().toISOString();
  for (const s of seeds) {
    all[`${wallet}:${s.type}`] = {
      total_amount_usd:    s.amount,
      accumulated_since:   s.since,
      distributions_count: s.count,
      last_updated:        now,
      is_claimed:          false,
    };
  }
  _saveClaims(all);
}

// ─── GAME SESSION ────────────────────────────────────────────

async function saveGameSession(data) {
  // Track daily game count for participation qualification
  const gamesKey = `pill_verse_games_${_today()}`;
  const count    = parseInt(localStorage.getItem(gamesKey) || '0', 10) + 1;
  localStorage.setItem(gamesKey, String(count));

  // Track total spent for dashboard display
  const fees   = { bronze: 0.1, silver: 1.0, gold: 10.0 };
  const fee    = fees[data.entry_tier] || 0;
  const spent  = parseFloat(localStorage.getItem('pill_verse_spent') || '0') + fee;
  localStorage.setItem('pill_verse_spent', spent.toFixed(2));

  if (_db) {
    await _db.from('game_sessions').insert(data);
  }
}

// ─── LEADERBOARD (Supabase) ───────────────────────────────────

async function updateLeaderboardRecord(wallet, nft, tier, score) {
  if (!_db) return;
  await _db.from('leaderboard_daily').upsert(
    { wallet_address: wallet, nft_type: nft, entry_tier: tier, best_score: score },
    { onConflict: 'wallet_address,day_date' }
  );
}

async function getLeaderboardFromDB() {
  if (!_db) return null;
  const { data } = await _db
    .from('leaderboard_daily')
    .select('*')
    .eq('day_date', _today())
    .order('best_score', { ascending: false })
    .limit(20);
  return data;
}

function subscribeLeaderboard(onUpdate) {
  if (!_db) return;
  _db.channel('lb_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'leaderboard_daily' },
      () => onUpdate()
    )
    .subscribe();
}

// ─── DATE UTILS ──────────────────────────────────────────────

function _today() { return new Date().toISOString().split('T')[0]; }

function _dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function _fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
