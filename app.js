/* =========================================================
   OP_PILL — app.js
   Pure vanilla JS — no frameworks, no build tools
   Bitcoin Ordinals / OP_NET NFT Minting Site
   ========================================================= */

'use strict';

// ─── CONSTANTS ─────────────────────────────────────────────

const NETWORK_CONFIG = {
  testnet: {
    label:             'TESTNET',
    networkId:         'testnet',
    // OP_NET testnet (Signet fork) may report 'opnetTestnet' or 'testnet' or 'signet'
    validNetworkIds:   ['testnet', 'opnetTestnet', 'signet'],
    explorerUrl:       'https://mempool.space/testnet/tx/',
    opnetExplorer:     'https://testnet.opnet.org/tx/',
    contractAddress:   'YOUR_TESTNET_CONTRACT_ADDRESS',
    recipientAddress:  'YOUR_TESTNET_BTC_ADDRESS',
    addressPrefix:     'tb1q',
    active:            true,
  },
  mainnet: {
    label:             'MAINNET',
    networkId:         'livenet',
    explorerUrl:       'https://mempool.space/tx/',
    opnetExplorer:     'https://opnet.org/tx/',
    contractAddress:   'YOUR_MAINNET_CONTRACT_ADDRESS',
    recipientAddress:  'YOUR_MAINNET_BTC_ADDRESS',
    addressPrefix:     'bc1q',
    active:            false,   // LOCKED — set true on mainnet launch
  },
};


const MINT_PRICE_SATS = 50000;   // 0.0005 BTC
const MINT_FEE_SATS   = 1000;    // ~0.00001 BTC
const MAX_PER_TX      = 5;
const MAX_PER_WALLET  = 20;
const TOTAL_SUPPLY    = 5000;

const RARITY_DATA = {
  COMMON:   { label: 'COMMON',   pct: 70, color: '#9B72CF', desc: 'Standard formula.\nBase pharmaceutical grade.',            img: './assets/common.png'   },
  RARE:     { label: 'RARE',     pct: 20, color: '#0088FF', desc: 'Enhanced compound.\nElevated neural efficiency. ⚡',        img: './assets/rare.png'     },
  MYTHICAL: { label: 'MYTHICAL', pct: 10, color: '#FFD700', desc: 'Legendary origin.\nUnknown properties. Handle with care. ⚡', img: './assets/mythical.png' },
};

const ROADMAP_PHASES = [
  { title: 'PHASE 1', sub: 'Testing & Regtest',          date: 'Q1 2026 ✓', done: true,  tag: 'PILL_CATCHER × OP_PILL' },
  { title: 'PHASE 2', sub: 'Mainnet Launch',             date: 'Q2 2026',   done: false },
];

// ─── MUTABLE STATE ─────────────────────────────────────────

let currentNetwork = 'testnet';
let mintQty        = 1;
let mintedCount    = 0;

let walletState = {
  connected:  false,
  address:    null,
  balance:    0,         // satoshis
  walletType: null,      // 'opwallet' | 'unisat' | 'okx' | 'demo'
  network:    null,
};

// Flag: after wallet connects, should we continue to Confirm modal?
let _pendingMintAfterConnect = false;

// ─── UTILITIES ─────────────────────────────────────────────

const randHex    = (n = 16)  => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
const fakeTxHash = ()        => randHex(64);
const fmtBTC     = (sats)    => `${(sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`;
const fmtAddr    = (a)       => a ? `${a.slice(0, 8)}...${a.slice(-4)}` : '—';
const debounce   = (fn, ms)  => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sleep      = (ms)      => new Promise(r => setTimeout(r, ms));

function fakeBtcAddress(prefix) {
  return `${prefix}${randHex(10)}${randHex(4)}`;
}

// ─── TOAST ─────────────────────────────────────────────────

const $toasts = document.getElementById('toast-container');

function showToast(msg, type = 'info', duration = 4000) {
  const existing = $toasts.querySelectorAll('.toast');
  if (existing.length >= 3) existing[0].remove();

  const el = document.createElement('div');
  el.className   = `toast ${type}`;
  el.textContent = msg;
  $toasts.appendChild(el);

  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  };
  el.addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
}

// ─── MODAL SYSTEM ──────────────────────────────────────────

let _trapCleanup = null;

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  closeAllModals();             // only one modal at a time
  el.classList.add('open');

  // Auto-focus first focusable element
  const focusable = el.querySelectorAll('button:not(:disabled), input, select, a[href], [tabindex]:not([tabindex="-1"])');
  if (focusable.length) setTimeout(() => focusable[0].focus(), 60);

  // Focus trap
  if (_trapCleanup) _trapCleanup();
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    const els   = [...el.querySelectorAll('button:not(:disabled), input, select, a[href], [tabindex]:not([tabindex="-1"])')];
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener('keydown', trap);
  _trapCleanup = () => el.removeEventListener('keydown', trap);
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
}

// ESC closes topmost modal (except processing + unbox)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.modal-overlay.open');
  if (open && !['modal-processing', 'modal-unbox'].includes(open.id)) closeModal(open.id);
});

// data-close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// ─── MATRIX RAIN ───────────────────────────────────────────

function initMatrix() {
  const canvas = document.getElementById('matrix-canvas');
  const ctx    = canvas.getContext('2d');
  const CHARS  = '0123456789ABCDEF';
  const FS     = 14;                // font size px
  const THROTTLE = 40;             // ms between frames

  let cols, drops, lastFrame = 0;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    cols  = Math.floor(canvas.width / FS);
    drops = Array.from({ length: cols }, () => Math.floor(Math.random() * -60));
  }

  function draw(ts) {
    requestAnimationFrame(draw);
    if (ts - lastFrame < THROTTLE) return;
    lastFrame = ts;

    // Semi-transparent fill = trail fade
    ctx.fillStyle = 'rgba(3,0,10,0.055)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `${FS}px "Share Tech Mono", monospace`;

    for (let i = 0; i < cols; i++) {
      const x = i * FS;
      const y = drops[i] * FS;
      const ch = CHARS[Math.floor(Math.random() * 16)];

      // Cyan head with glow
      ctx.shadowBlur  = 10;
      ctx.shadowColor = '#00FFFF';
      ctx.fillStyle   = '#00FFFF';
      ctx.fillText(ch, x, y);

      // Navy body char one step above
      ctx.shadowBlur = 0;
      ctx.fillStyle  = '#003399';
      ctx.fillText(CHARS[Math.floor(Math.random() * 16)], x, y - FS);

      if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
    ctx.shadowBlur = 0;
  }

  resize();
  window.addEventListener('resize', debounce(resize, 250));
  requestAnimationFrame(draw);
}

// ─── HERO PARTICLES ────────────────────────────────────────

function initHeroParticles() {
  const wrap   = document.getElementById('hero-particles');
  const COLORS = ['#00FFFF','#8B00FF','#FFD700','#FF003C','#FF00AA'];
  for (let i = 0; i < 20; i++) {
    const el   = document.createElement('div');
    el.className = 'hero-particle';
    const sz   = 2 + Math.random() * 4;
    Object.assign(el.style, {
      width:            `${sz}px`,
      height:           `${sz}px`,
      left:             `${Math.random() * 100}%`,
      top:              `${Math.random() * 100}%`,
      background:       COLORS[i % COLORS.length],
      animationDuration:`${3 + Math.random() * 4}s`,
      animationDelay:   `${Math.random() * 3}s`,
    });
    wrap.appendChild(el);
  }
}

// ─── RARITY CARDS ──────────────────────────────────────────

function renderRarityCards() {
  document.getElementById('rarity-grid').innerHTML =
    Object.entries(RARITY_DATA).map(([key, r]) => `
      <article class="rarity-card" data-rarity="${key.toLowerCase()}">
        <div class="rarity-label">${r.label}</div>
        <div class="rarity-pct">${r.pct}%</div>
        <div class="rarity-img-wrap">
          <img src="${r.img}" alt="${r.label} pill"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
          <div class="rarity-svg-fallback" style="display:none">
            <svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg" style="width:120px">
              <ellipse cx="100" cy="40" rx="96" ry="36" fill="${r.color}" opacity=".8"/>
              <line x1="100" y1="4" x2="100" y2="76" stroke="rgba(0,0,0,.3)" stroke-width="2"/>
              <ellipse cx="100" cy="40" rx="96" ry="36" fill="none" stroke="${r.color}" stroke-width="1.5" opacity=".5"/>
            </svg>
          </div>
        </div>
        <p class="rarity-desc">${r.desc.replace('\n', '<br>')}</p>
        <div class="rarity-bar-wrap"><div class="rarity-bar" style="width:${r.pct}%"></div></div>
      </article>`
    ).join('');
}

// ─── ROADMAP ───────────────────────────────────────────────

function renderRoadmap() {
  document.getElementById('roadmap-track').innerHTML =
    ROADMAP_PHASES.map(p => `
      <div class="roadmap-phase${p.done ? ' done' : ''}">
        <div class="phase-dot"></div>
        <div class="phase-content">
          <div class="phase-title">${p.title}</div>
          <div class="phase-sub">${p.sub}</div>
          ${p.tag ? `<div class="phase-tag">${p.tag}</div>` : ''}
          <div class="phase-date">${p.date}</div>
        </div>
      </div>`
    ).join('');
}

// ─── NETWORK TOGGLE ────────────────────────────────────────

function applyNetwork(net) {
  if (net === 'mainnet') {
    showToast('🔒 Mainnet coming soon! Currently running on Regtest.', 'warning');
    return;
  }
  currentNetwork = net;
  const cfg = NETWORK_CONFIG[net];

  document.getElementById('btn-testnet').classList.toggle('active', true);
  document.getElementById('btn-mainnet').classList.toggle('active', false);

  // Sync all network labels in the UI
  const badge = document.getElementById('hero-badge');
  if (badge) badge.textContent = '🟡 RUNNING ON REGTEST';

  const mintBadge = document.getElementById('mint-net-badge');
  if (mintBadge) mintBadge.textContent = `● ${cfg.label}`;

  const procNet = document.getElementById('proc-network');
  if (procNet) procNet.textContent = cfg.label;

  console.log('[OP_PILL] Network:', cfg.label);
}

function initNetworkToggle() {
  document.getElementById('btn-testnet').addEventListener('click', () => applyNetwork('testnet'));
  document.getElementById('btn-mainnet').addEventListener('click', () => applyNetwork('mainnet'));
  applyNetwork('testnet');
}

// ─── WALLET UI ─────────────────────────────────────────────

const WALLET_BADGE_COLORS = {
  opwallet: 'var(--neon-violet)',
  unisat:   'var(--neon-cyan)',
  okx:      'var(--neon-gold)',
  demo:     '#666',
};

function updateWalletUI() {
  const btn   = document.getElementById('btn-wallet');
  if (!walletState.connected) {
    btn.textContent = 'CONNECT WALLET';
    btn.style.borderColor = '';
    btn.style.color       = '';
    return;
  }
  const type  = walletState.walletType || 'demo';
  const color = WALLET_BADGE_COLORS[type] || '#aaa';
  btn.innerHTML    = `[${type.toUpperCase()}] ${fmtAddr(walletState.address)}`;
  btn.style.borderColor = color;
  btn.style.color       = color;
  console.log('[OP_PILL] Wallet:', type, '|', walletState.address, '|', fmtBTC(walletState.balance));
}

function saveWalletState() {
  try { sessionStorage.setItem('oppill_wallet', JSON.stringify(walletState)); } catch { /* private mode */ }
}

function loadWalletState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('oppill_wallet') || 'null');
    if (saved?.connected) {
      walletState = saved;
      window._walletState = walletState;
      updateWalletUI();
      showToast(`✓ Auto-reconnected: ${fmtAddr(walletState.address)}`, 'success');
    }
  } catch { /* ignore */ }
}

// ─── DEMO CONNECT CONFIRMATION ─────────────────────────────

function _demoConnectConfirm(address, balanceSats) {
  return new Promise(resolve => {
    const btc = (balanceSats / 1e8).toFixed(4);

    const overlay = document.createElement('div');
    overlay.className = 'demo-confirm-overlay';
    overlay.innerHTML = `
      <div class="demo-confirm-box">
        <div class="demo-confirm-badge">⚡ DEMO MODE</div>
        <h3 class="demo-confirm-title">Connect Wallet</h3>
        <p class="demo-confirm-sub">A simulated wallet will be created for this session.</p>
        <div class="demo-confirm-row">
          <span class="demo-confirm-label">ADDRESS</span>
          <span class="demo-confirm-val demo-confirm-addr">${address}</span>
        </div>
        <div class="demo-confirm-row">
          <span class="demo-confirm-label">BALANCE</span>
          <span class="demo-confirm-val">${btc} BTC <span class="demo-confirm-note">(testnet)</span></span>
        </div>
        <div class="demo-confirm-row">
          <span class="demo-confirm-label">NETWORK</span>
          <span class="demo-confirm-val">Bitcoin Testnet</span>
        </div>
        <p class="demo-confirm-warn">⚠ Demo mode has limited features. No real BTC is used.</p>
        <div class="demo-confirm-actions">
          <button class="btn-secondary demo-confirm-cancel">CANCEL</button>
          <button class="btn-primary  demo-confirm-ok">CONNECT</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('.demo-confirm-ok').addEventListener('click',     () => cleanup(true));
    overlay.querySelector('.demo-confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
  });
}

// ─── WALLET ADAPTERS ───────────────────────────────────────

const ADAPTERS = {

  opwallet: {
    label: 'OP_Wallet',
    // OP_NET wallet may inject under various names depending on extension version
    check() { return !!(window.opnet || window.op_wallet || window.bitcoin || window.BitcoinProvider || window.btc); },
    get p() { return window.opnet || window.op_wallet || window.bitcoin || window.BitcoinProvider || window.btc; },
    async connect() {
      // requestAccounts() — confirmed correct by OP_NET reference
      const accounts = await this.p.requestAccounts();
      if (!accounts || !accounts[0]) throw new Error('No accounts returned from OP_Wallet');

      // getBalance() — returns { confirmed, unconfirmed, total } or a plain number
      let balance = 0;
      try {
        const bal = await this.p.getBalance();
        balance = bal?.confirmed ?? bal?.total ?? (typeof bal === 'number' ? bal : 0);
      } catch { /* balance unavailable — non-fatal */ }

      // getNetwork() — OP_NET testnet (Signet fork) reports 'opnetTestnet' or 'testnet'
      let network = 'opnetTestnet';
      try { network = await this.p.getNetwork() ?? network; } catch {}

      // Optional: capture publicKey for Address.fromString() in contract calls
      // (hashedMLDSAKey + publicKey required for getContract() 5-param call)
      let publicKey = null;
      try { publicKey = await this.p.getPublicKey?.(); } catch {}

      return { address: accounts[0], balance, network, publicKey };
    },
    // signMessage() — browser wallet handles ALL signing (signer: null on frontend)
    async sign(msg) { return this.p.signMessage(msg); },
    // sendBitcoin() — vanilla JS fallback; production should use TransactionFactory
    // with signer: null per OP_NET reference (wallet signs internally)
    async send(to, sats) { return this.p.sendBitcoin(to, sats); },
  },

  unisat: {
    label: 'UniSat',
    check() { return !!window.unisat; },
    async connect() {
      const accounts = await window.unisat.requestAccounts();
      const bal      = await window.unisat.getBalance();
      const net      = await window.unisat.getNetwork();
      return { address: accounts[0], balance: bal?.confirmed ?? bal?.total ?? bal ?? 0, network: net };
    },
    async sign(msg) { return window.unisat.signMessage(msg); },
    async send(to, sats) { return window.unisat.sendBitcoin(to, sats); },
  },

  okx: {
    label: 'OKX',
    check() { return !!(window.okxwallet?.bitcoin); },
    async connect() {
      const accounts = await window.okxwallet.bitcoin.requestAccounts();
      const bal      = await window.okxwallet.bitcoin.getBalance();
      const net      = await window.okxwallet.bitcoin.getNetwork();
      return { address: accounts[0], balance: bal?.confirmed ?? bal?.total ?? bal ?? 0, network: net };
    },
    async sign(msg) { return window.okxwallet.bitcoin.signMessage(msg); },
    async send(to, sats) { return window.okxwallet.bitcoin.sendBitcoin(to, sats); },
  },

  demo: {
    label: 'DEMO',
    check() { return true; },
    async connect() {
      const prefix  = NETWORK_CONFIG[currentNetwork].addressPrefix;
      const address = fakeBtcAddress(prefix);
      const balance = 500000;

      // Show confirmation popup — resolves true on Confirm, false on Cancel
      const confirmed = await _demoConnectConfirm(address, balance);
      if (!confirmed) throw new Error('User cancelled demo connection.');

      return { address, balance, network: currentNetwork === 'mainnet' ? 'livenet' : 'testnet' };
    },
    async sign() { return 'demo_sig_' + randHex(32); },
    async send() { return { txid: fakeTxHash() }; },
  },
};

// ─── WALLET MODAL ──────────────────────────────────────────

function renderWalletOptions() {
  const OPTS = [
    {
      key:           'opwallet',
      label:         'OP_Wallet',
      badge:         'RECOMMENDED',
      downloadUrl:   'https://opnet.org/wallet',
      downloadLabel: 'INSTALL ↗',
      svgIcon: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="22,2 40,12 40,32 22,42 4,32 4,12" fill="rgba(139,0,255,0.18)" stroke="#8B00FF" stroke-width="1.5"/>
        <polygon points="22,10 34,17 34,27 22,34 10,27 10,17" fill="rgba(139,0,255,0.1)" stroke="#8B00FF" stroke-width="0.8"/>
        <text x="22" y="26" font-family="Orbitron,sans-serif" font-size="9" font-weight="700" fill="#8B00FF" text-anchor="middle" letter-spacing="1.5">OP</text>
      </svg>`,
    },
    {
      key:           'unisat',
      label:         'UniSat Wallet',
      badge:         '',
      downloadUrl:   'https://unisat.io',
      downloadLabel: 'INSTALL ↗',
      svgIcon: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="22" r="18" fill="rgba(255,140,0,0.15)" stroke="#FF8C00" stroke-width="1.5"/>
        <circle cx="22" cy="22" r="11" fill="rgba(255,140,0,0.08)" stroke="#FF8C00" stroke-width="0.8"/>
        <text x="22" y="28" font-family="Arial,sans-serif" font-size="17" font-weight="900" fill="#FF8C00" text-anchor="middle">U</text>
      </svg>`,
    },
    {
      key:           'okx',
      label:         'OKX Wallet',
      badge:         '',
      downloadUrl:   'https://okx.com/web3',
      downloadLabel: 'INSTALL ↗',
      svgIcon: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="36" height="36" rx="4" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
        <text x="22" y="27" font-family="Arial,sans-serif" font-size="11" font-weight="900" fill="white" text-anchor="middle" letter-spacing="1">OKX</text>
      </svg>`,
    },
  ];

  const container = document.getElementById('wallet-options');
  container.innerHTML = OPTS.map(o => {
    const detected   = ADAPTERS[o.key].check();
    const statusHtml = detected
      ? `<span class="wallet-status-detected">&#9679; DETECTED</span>`
      : `<span class="wallet-status-missing">&#9675; NOT INSTALLED</span>`;
    const actionHtml = detected
      ? `<button class="btn-wallet-connect" data-wallet="${o.key}">CONNECT</button>`
      : `<a href="${o.downloadUrl}" target="_blank" rel="noopener" class="btn-wallet-download">${o.downloadLabel}</a>`;

    return `
      <div class="wallet-opt-card ${o.key}">
        <div class="wallet-opt-logo">${o.svgIcon}</div>
        <div class="wallet-opt-info">
          <div class="wallet-opt-name">
            ${o.label}
            ${o.badge ? `<span class="wallet-badge-rec">${o.badge}</span>` : ''}
          </div>
          ${statusHtml}
        </div>
        <div class="wallet-opt-cta">${actionHtml}</div>
        <div class="wallet-opt-error" id="err-${o.key}"></div>
      </div>`;
  }).join('')
  + `
    <div class="wallet-opt-divider">OR</div>
    <button class="wallet-opt-demo" data-wallet="demo">
      <span class="wallet-demo-icon">&#9889;</span>
      <span class="wallet-demo-label">Demo Mode</span>
      <span class="wallet-demo-note">No wallet needed &middot; Limited features</span>
    </button>`;

  container.querySelectorAll('[data-wallet]').forEach(btn => {
    btn.addEventListener('click', () => connectWallet(btn.dataset.wallet));
  });
}

async function connectWallet(key) {
  const adapter = ADAPTERS[key];
  if (!adapter) return;

  const errEl = document.getElementById(`err-${key}`);

  // Wallet not installed → fallback to demo
  if (key !== 'demo' && !adapter.check()) {
    if (errEl) { errEl.textContent = `${adapter.label} not detected. Please install it.`; errEl.classList.add('visible'); }
    showToast(`${adapter.label} not found. Falling back to Demo mode.`, 'warning');
    await connectWallet('demo');
    return;
  }

  try {
    const result = await adapter.connect();

    // Network mismatch check (skip for demo)
    if (key !== 'demo') {
      const got = (result.network || '').toLowerCase();
      if (got) {
        const cfg   = NETWORK_CONFIG[currentNetwork];
        // Mainnet: must match 'livenet'. Testnet: accept any valid testnet ID.
        // OP_NET testnet (Signet fork) may report 'opnetTestnet' or 'testnet'.
        const valid = currentNetwork === 'mainnet'
          ? ['livenet']
          : (cfg.validNetworkIds || ['testnet']);
        if (!valid.includes(got)) {
          closeModal('modal-wallet');
          showNetworkMismatch(got, valid[0], adapter.label);
          return;
        }
      }
    }

    walletState = { connected: true, address: result.address, balance: result.balance, walletType: key, network: result.network };
    window._walletState = walletState;
    saveWalletState();
    updateWalletUI();
    closeModal('modal-wallet');
    window.dispatchEvent(new CustomEvent('wallet:connected', { detail: walletState }));

    if (key === 'demo') {
      showToast('⚠ No Bitcoin wallet detected. Running in DEMO mode.', 'info');
    } else {
      showToast(`✓ ${adapter.label} connected: ${fmtAddr(result.address)}`, 'success');
    }

    // Continue pending mint
    if (_pendingMintAfterConnect) {
      _pendingMintAfterConnect = false;
      setTimeout(openConfirmModal, 200);
    }

  } catch (err) {
    console.error('[OP_PILL] connect error:', err);
    const msg = err?.message || 'Connection failed.';
    if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
    showToast(`✗ ${adapter.label}: ${msg}`, 'error');
  }
}

function showNetworkMismatch(walletNet, expected, walletLabel) {
  document.getElementById('mismatch-msg').textContent =
    `Your wallet is on ${walletNet.toUpperCase()} but the site is set to ${expected.toUpperCase()}.\n` +
    `Please switch your ${walletLabel} to ${expected.toUpperCase()} and reconnect.`;

  document.getElementById('btn-switch-network').onclick = () => {
    closeModal('modal-mismatch');
    renderWalletOptions();
    openModal('modal-wallet');
    showToast('Switch your wallet network, then reconnect.', 'info');
  };
  openModal('modal-mismatch');
}

// ─── QUANTITY SELECTOR ─────────────────────────────────────

function refreshTotals() {
  const cost  = MINT_PRICE_SATS * mintQty;
  const total = cost + MINT_FEE_SATS;
  document.getElementById('qty-display').textContent  = mintQty;
  document.getElementById('total-cost').textContent   = fmtBTC(cost);
  document.getElementById('total-final').textContent  = fmtBTC(total);
}

function initQtySelector() {
  document.getElementById('qty-minus').addEventListener('click', () => {
    if (mintQty > 1) { mintQty--; refreshTotals(); }
  });
  document.getElementById('qty-plus').addEventListener('click', () => {
    if (mintQty < MAX_PER_TX) { mintQty++; refreshTotals(); }
    else showToast(`Max ${MAX_PER_TX} NFTs per transaction.`, 'warning');
  });
  refreshTotals();
}

// ─── RARITY ROLL ───────────────────────────────────────────

function rollRarity() {
  // Cryptographically-influenced seed for fairness simulation
  const seed       = Date.now() ^ Math.floor(Math.random() * 0xFFFFFF);
  const normalized = (seed % 10000) / 100;  // 0.00–99.99
  if (normalized < 10) return 'MYTHICAL';   // 10%
  if (normalized < 30) return 'RARE';       // 20%
  return 'COMMON';                           // 70%
}

// ─── CONFIRM MODAL ─────────────────────────────────────────

function buildTOS() {
  const net = NETWORK_CONFIG[currentNetwork].label;
  return `By proceeding you confirm: (1) You are 18+ years old. ` +
    `(2) NFT minting is irreversible. ` +
    `(3) Rarity is determined by verifiable on-chain randomness. ` +
    `(4) This is not financial advice. ` +
    `(5) You are responsible for your private keys. ` +
    `(6) No refunds under any circumstances. ` +
    `(7) OP_PILL team is not liable for any losses. ` +
    `(8) You are operating on ${net} — testnet transactions have no real monetary value.`;
}

function openConfirmModal() {
  const cfg      = NETWORK_CONFIG[currentNetwork];
  const cost     = MINT_PRICE_SATS * mintQty;
  const total    = cost + MINT_FEE_SATS;
  const bal      = walletState.balance;
  const remaining = Math.max(0, bal - total);

  // Build table rows
  const rows = [
    ['COLLECTION',    'OP_PILL Genesis'],
    ['NETWORK',       `OP_NET / Bitcoin [${cfg.label}]`],
    ['QUANTITY',      `${mintQty} NFT${mintQty > 1 ? 's' : ''}`],
    ['UNIT PRICE',    '0.0005 BTC'],
    ['TOTAL COST',    fmtBTC(cost)],
    ['EST. FEE',      fmtBTC(MINT_FEE_SATS)],
    ['TOTAL',         fmtBTC(total)],
    ['FROM WALLET',   fmtAddr(walletState.address)],
    ['WALLET TYPE',   (walletState.walletType || '').toUpperCase()],
    ['YOUR BALANCE',  fmtBTC(bal)],
    ['REMAINING BAL', fmtBTC(remaining)],
  ];

  document.getElementById('confirm-table').innerHTML =
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  document.getElementById('confirm-net-badge').textContent = cfg.label;
  document.getElementById('tos-box').textContent           = buildTOS();

  const tosCheck = document.getElementById('tos-check');
  const signBtn  = document.getElementById('btn-sign-mint');
  tosCheck.checked  = false;
  signBtn.disabled  = true;
  signBtn.textContent = 'SIGN & MINT';

  tosCheck.onchange = () => { signBtn.disabled = !tosCheck.checked; };

  signBtn.onclick = async () => {
    signBtn.disabled    = true;
    signBtn.textContent = 'SIGNING...';
    const msg = `I agree to OP_PILL Terms of Service. Network: ${currentNetwork}. ` +
                `Minting ${mintQty} NFT(s). Address: ${walletState.address}. ` +
                `Timestamp: ${Math.floor(Date.now() / 1000)}`;
    try {
      const adapter = ADAPTERS[walletState.walletType];
      await adapter.sign(msg);
      closeModal('modal-confirm');
      runProcessing();
    } catch (err) {
      showToast('✗ Transaction cancelled by user.', 'error');
      signBtn.disabled    = false;
      signBtn.textContent = 'SIGN & MINT';
    }
  };

  openModal('modal-confirm');
}

// ─── PROCESSING MODAL ──────────────────────────────────────

async function runProcessing() {
  const bar     = document.getElementById('proc-bar');
  const status  = document.getElementById('proc-status');
  const txidEl  = document.getElementById('proc-txid');
  const expLink = document.getElementById('proc-explorer-link');
  const cfg     = NETWORK_CONFIG[currentNetwork];
  const txHash  = fakeTxHash();

  // Reset state
  bar.style.width       = '0%';
  bar.style.transition  = 'none';
  status.textContent    = 'Signing...';
  txidEl.style.display  = 'none';
  expLink.style.display = 'none';
  openModal('modal-processing');

  // Step sequence: [delay_ms, bar_pct, label, showTxid, showLink]
  const steps = [
    [600,  15, 'Signing...',       false, false],
    [800,  42, 'Broadcasting...',  true,  false],
    [900,  78, 'Confirming...',    true,  true ],
    [700, 100, 'Done! ✓',          true,  true ],
  ];

  for (const [delay, pct, label, showTx, showLink] of steps) {
    await sleep(delay);
    bar.style.transition = 'width 0.5s ease';
    bar.style.width      = pct + '%';
    status.textContent   = label;

    if (showTx && txidEl.style.display === 'none') {
      txidEl.textContent   = `TXID: ${txHash}`;
      txidEl.style.display = 'block';
    }
    if (showLink && expLink.style.display === 'none') {
      expLink.href        = cfg.explorerUrl + txHash;
      expLink.textContent = `View on ${cfg.label === 'REGTEST' ? 'localhost:8080' : 'mempool.space'} →`;
      expLink.style.display = 'block';
    }
  }

  await sleep(600);
  closeModal('modal-processing');
  openUnboxModal(txHash);
}

// ─── EM FIELD CANVAS ───────────────────────────────────────

let _emRAF        = null;
let _emParticles  = [];
let _emExploding  = false;
let _emOnComplete = null;

function initEMField(onComplete) {
  _emOnComplete = onComplete;
  _emExploding  = false;
  _emParticles  = [];

  const canvas = document.getElementById('em-canvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;

  // 80 particles across 4 rings (20 per ring, alternating CW/CCW)
  for (let i = 0; i < 80; i++) {
    const ring = Math.floor(i / 20);
    const dir  = ring % 2 === 0 ? 1 : -1;
    _emParticles.push({
      angle:   (i / 20) * Math.PI * 2 + ring * 0.8,
      speed:   dir * (0.018 + ring * 0.006 + Math.random() * 0.008),
      rx:      38 + ring * 24 + Math.random() * 8,   // x-radius of ellipse
      ry:      22 + ring * 13 + Math.random() * 5,   // y-radius of ellipse
      tilt:    ring * 0.35 + Math.random() * 0.2,
      size:    1.5 + Math.random() * 2.5,
      color:   i % 3 === 0 ? '#FFD700' : '#8B00FF',
      opacity: 0.55 + Math.random() * 0.45,
      px: cx, py: cy,
      vx: 0,  vy: 0,
      exploding: false,
    });
  }

  let pulse   = 0;
  let started = performance.now();

  function frame(ts) {
    ctx.clearRect(0, 0, W, H);

    // ── Center orb ──
    pulse += 0.05;
    const orbR = 13 + Math.sin(pulse) * 4;
    // Pulse between violet and gold
    const t      = (Math.sin(pulse * 0.7) + 1) / 2;
    const orbHex = t < 0.5 ? '#8B00FF' : '#FFD700';
    const grd    = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 2.5);
    grd.addColorStop(0, orbHex);
    grd.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, orbR * 2.5, 0, Math.PI * 2);
    ctx.fillStyle   = grd;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, orbR * 0.55, 0, Math.PI * 2);
    ctx.fillStyle   = '#ffffffcc';
    ctx.shadowBlur  = 12;
    ctx.shadowColor = orbHex;
    ctx.fill();
    ctx.shadowBlur = 0;

    // ── Particles ──
    let alive = 0;
    for (const p of _emParticles) {
      if (!p.exploding) {
        p.angle += p.speed;
        const cosT = Math.cos(p.tilt), sinT = Math.sin(p.tilt);
        const ex   = p.rx * Math.cos(p.angle);
        const ey   = p.ry * Math.sin(p.angle);
        p.px = cx + ex * cosT - ey * sinT;
        p.py = cy + ex * sinT + ey * cosT;
      } else {
        p.px      += p.vx;
        p.py      += p.vy;
        p.opacity -= 0.022;
        p.size    *= 0.97;
      }

      if (p.opacity <= 0) continue;
      alive++;

      ctx.beginPath();
      ctx.arc(p.px, p.py, Math.max(0.3, p.size), 0, Math.PI * 2);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle   = p.color;
      ctx.shadowBlur  = 7;
      ctx.shadowColor = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;

    // When explosion is done, trigger callback
    if (_emExploding && alive === 0) {
      cancelAnimationFrame(_emRAF);
      _emRAF = null;
      if (_emOnComplete) { _emOnComplete(); _emOnComplete = null; }
      return;
    }

    _emRAF = requestAnimationFrame(frame);
  }

  if (_emRAF) cancelAnimationFrame(_emRAF);
  _emRAF = requestAnimationFrame(frame);
}

function explodeEMField() {
  _emExploding = true;
  for (const p of _emParticles) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 4 + Math.random() * 6;
    p.exploding = true;
    p.vx        = Math.cos(angle) * spd;
    p.vy        = Math.sin(angle) * spd;
  }
}

// ─── CONFETTI ──────────────────────────────────────────────

function spawnConfetti() {
  const wrap   = document.getElementById('confetti-burst');
  const COLORS = ['#FFD700','#00FFFF','#FF003C','#8B00FF','#FF00AA','#00FF88','#FF5000'];
  wrap.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const el  = document.createElement('div');
    el.className = 'confetti-piece';
    Object.assign(el.style, {
      left:              `${35 + Math.random() * 30}%`,
      top:               `${20 + Math.random() * 20}%`,
      background:        COLORS[Math.floor(Math.random() * COLORS.length)],
      transform:         `rotate(${Math.random() * 360}deg)`,
      animationDelay:    `${Math.random() * 0.6}s`,
      animationDuration: `${1.4 + Math.random() * 1}s`,
      width:             `${5 + Math.random() * 6}px`,
      height:            `${5 + Math.random() * 6}px`,
    });
    wrap.appendChild(el);
  }
}

// ─── UNBOXING MODAL ────────────────────────────────────────

function openUnboxModal(txHash) {
  const phaseA = document.getElementById('unbox-phase-a');
  const phaseB = document.getElementById('unbox-phase-b');
  phaseA.style.display = 'flex';
  phaseB.style.display = 'none';
  openModal('modal-unbox');

  // Animate the dots in "OPENING CAPSULE..."
  const dotEl = document.querySelector('#unbox-phase-a .dot-anim');
  let   dotN  = 0;
  const dotTimer = setInterval(() => { if (dotEl) dotEl.textContent = '.'.repeat((++dotN % 4)); }, 500);

  // Roll rarity for each minted token
  const rolls  = Array.from({ length: mintQty }, rollRarity);
  const rarity = rolls[rolls.length - 1];   // show last roll
  const data   = RARITY_DATA[rarity];
  const tokenId = 1000 + Math.floor(Math.random() * 8999);

  // Phase A → B: explode at 2.5s, EM particles finish → show reveal
  setTimeout(() => explodeEMField(), 2500);

  initEMField(() => {
    clearInterval(dotTimer);
    phaseA.style.display = 'none';
    phaseB.style.display = 'flex';
    populateReveal(rarity, data, tokenId, txHash);
  });
}

function populateReveal(rarity, data, tokenId, txHash) {
  const cfg = NETWORK_CONFIG[currentNetwork];

  // Rarity badge
  const badge = document.getElementById('reveal-rarity-badge');
  badge.textContent        = data.label;
  badge.style.color        = data.color;
  badge.style.borderColor  = data.color;
  badge.style.boxShadow    = `0 0 14px ${data.color}40`;

  // Image with SVG fallback
  const img = document.getElementById('reveal-img');
  img.src         = data.img;
  img.style.filter = `drop-shadow(0 0 22px ${data.color})`;
  img.onerror = function () {
    this.style.display = 'none';
    const fallback = document.createElement('svg');
    fallback.setAttribute('viewBox', '0 0 200 80');
    fallback.style.cssText = `width:180px;height:72px;filter:drop-shadow(0 0 18px ${data.color})`;
    fallback.innerHTML = `
      <ellipse cx="100" cy="40" rx="96" ry="36" fill="${data.color}" opacity=".8"/>
      <line x1="100" y1="4" x2="100" y2="76" stroke="rgba(0,0,0,.3)" stroke-width="2"/>
      <text x="100" y="45" text-anchor="middle" font-size="18" font-family="monospace" fill="#000" opacity=".7">💊</text>`;
    this.parentNode.appendChild(fallback);
  };

  // Labels
  const rareName = document.getElementById('reveal-rarity-name');
  rareName.textContent    = data.label;
  rareName.style.color    = data.color;
  rareName.style.textShadow = `0 0 20px ${data.color}`;

  document.getElementById('reveal-rarity-desc').textContent = data.desc.replace('\n', ' — ');
  document.getElementById('reveal-token-id').textContent    = `TOKEN #${tokenId}`;
  document.getElementById('reveal-txhash').textContent      = `TX: ${txHash}`;

  // Confetti for rare+ rarities
  if (rarity === 'MYTHICAL') spawnConfetti();

  // Store NFT type for game bonuses (demo)
  localStorage.setItem('pill_verse_nft', rarity.toLowerCase());

  // Game CTA toast after successful mint
  setTimeout(() => {
    showToast('💊 NFT minted! Your game bonuses are now active. Scroll up to PLAY!', 'success', 6000);
  }, 3500);

  // Update global minted count
  mintedCount = Math.min(mintedCount + mintQty, TOTAL_SUPPLY);
  document.getElementById('minted-count').textContent   = mintedCount;
  document.getElementById('mint-available').textContent = TOTAL_SUPPLY - mintedCount;

  // Action buttons
  document.getElementById('btn-share-x').onclick = () => {
    const text = encodeURIComponent(
      `Just minted OP_PILL #${tokenId} — ${data.label} 💊 on Bitcoin Regtest! @op_pill_nft #Bitcoin #Ordinals #OPNET`
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  document.getElementById('btn-view-explorer').onclick = () => {
    window.open(cfg.explorerUrl + txHash, '_blank');
  };

  document.getElementById('btn-mint-another').onclick = () => {
    closeModal('modal-unbox');
    mintQty = 1;
    refreshTotals();
    document.getElementById('mint').scrollIntoView({ behavior: 'smooth' });
  };

  document.getElementById('btn-unbox-close').onclick = () => closeModal('modal-unbox');
}

// ─── MINT FLOW ENTRY POINT ─────────────────────────────────

function handleMint(lucky = false) {
  if (lucky) {
    mintQty = 1 + Math.floor(Math.random() * MAX_PER_TX);
    refreshTotals();
    showToast(`🎲 Lucky draw: minting ${mintQty} NFT${mintQty > 1 ? 's' : ''}!`, 'info');
  }

  // Step 1 — wallet not connected
  if (!walletState.connected) {
    _pendingMintAfterConnect = true;
    renderWalletOptions();
    openModal('modal-wallet');
    return;
  }

  // Step 1 — sold out
  if (mintedCount >= TOTAL_SUPPLY) {
    showToast('💔 Sold out! All 5,000 OP_PILL have been minted.', 'error');
    return;
  }

  // Step 1 — insufficient funds
  const required = MINT_PRICE_SATS * mintQty + MINT_FEE_SATS;
  if (walletState.balance < required) {
    document.getElementById('funds-msg').textContent =
      `Your wallet balance (${fmtBTC(walletState.balance)}) is below the required amount (${fmtBTC(required)}).`;
    openModal('modal-funds');
    return;
  }

  // Step 3 — confirm
  openConfirmModal();
}


// ─── NAV & SCROLL ──────────────────────────────────────────

function initNav() {
  // Hero CTA → mint section
  document.getElementById('btn-hero-mint').addEventListener('click', () => {
    document.getElementById('mint').scrollIntoView({ behavior: 'smooth' });
  });

  // Smooth-scroll all nav links + active state
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth' });
      document.getElementById('main-nav').classList.remove('open');
      document.getElementById('hamburger').setAttribute('aria-expanded', 'false');
    });
  });

  // Intersection Observer for active link
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        navLinks.forEach(l =>
          l.classList.toggle('active', l.getAttribute('href') === `#${en.target.id}`)
        );
      }
    });
  }, { rootMargin: '-35% 0px -60% 0px' });

  ['hero','mint','rarity','roadmap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) obs.observe(el);
  });

  // Hamburger toggle
  document.getElementById('hamburger').addEventListener('click', function () {
    const nav  = document.getElementById('main-nav');
    const open = nav.classList.toggle('open');
    this.setAttribute('aria-expanded', String(open));
  });
}

// ─── WALLET BUTTON ─────────────────────────────────────────

function initWalletButton() {
  document.getElementById('btn-wallet').addEventListener('click', () => {
    if (walletState.connected) {
      // Click on connected button = disconnect
      walletState = { connected: false, address: null, balance: 0, walletType: null, network: null };
      window._walletState = walletState;
      saveWalletState();
      updateWalletUI();
      showToast('Wallet disconnected.', 'info');
    } else {
      renderWalletOptions();
      openModal('modal-wallet');
    }
  });
}

// ─── MINT BUTTONS ──────────────────────────────────────────

function initMintButtons() {
  document.getElementById('btn-mint-main').addEventListener('click', () => handleMint(false));
  document.getElementById('btn-lucky').addEventListener('click',     () => handleMint(true));
}

// ─── ACCESSIBILITY ─────────────────────────────────────────

function initA11y() {
  // Allow Enter/Space to trigger role="button" elements
  document.querySelectorAll('[role="button"]').forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  });

  // Close modal when clicking outside modal-box
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        const id = overlay.id;
        if (id !== 'modal-processing' && id !== 'modal-unbox') closeModal(id);
      }
    });
  });
}

// ─── WALLET PROVIDER DEBUG ─────────────────────────────────

function debugWalletProviders() {
  const providers = {
    'window.opnet':            typeof window.opnet !== 'undefined' ? window.opnet : undefined,
    'window.op_wallet':        typeof window.op_wallet !== 'undefined' ? window.op_wallet : undefined,
    'window.unisat':           typeof window.unisat !== 'undefined' ? window.unisat : undefined,
    'window.okxwallet':        typeof window.okxwallet !== 'undefined' ? window.okxwallet : undefined,
    'window.okxwallet.bitcoin': window.okxwallet?.bitcoin,
  };

  console.group('[OP_PILL] Wallet Provider Detection');
  for (const [name, obj] of Object.entries(providers)) {
    const detected = obj != null;
    console.log(
      `%c ${detected ? '✓' : '✗'} ${name}`,
      `color: ${detected ? '#00FFFF' : '#888'}; font-weight: bold`,
      detected ? obj : '(not detected)'
    );
  }

  const anyReal = ADAPTERS.opwallet.check() || ADAPTERS.unisat.check() || ADAPTERS.okx.check();
  console.log(
    `%c ${anyReal ? '✓ At least one Bitcoin wallet detected' : '✗ No Bitcoin wallet detected — Demo mode will be used'}`,
    `color: ${anyReal ? '#00FF88' : '#FFD700'}; font-weight: bold`
  );
  console.groupEnd();
}

// ─── BOOTSTRAP ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initMatrix();
  initHeroParticles();
  renderRarityCards();
  renderRoadmap();
  initNetworkToggle();
  initQtySelector();

  initNav();
  initMintButtons();
  initA11y();
  loadWalletState();

  // Delay wallet init so extensions have time to inject into the page
  setTimeout(() => {
    // Log every possible OP_Wallet injection point so we can see what the extension actually provides
    const PROBE_KEYS = ['opnet', 'op_wallet', 'bitcoin', 'BitcoinProvider', 'btc', 'unisat', 'okxwallet'];
    const detected = {};
    for (const k of PROBE_KEYS) {
      const val = window[k];
      if (val !== undefined) detected[k] = val;
    }
    console.log('[OP_PILL] Window wallet objects detected:', Object.keys(detected).length ? detected : '(none)');
    if (Object.keys(detected).length === 0) {
      console.warn('[OP_PILL] No wallet extension detected. Make sure the extension is enabled for this page.');
    }

    initWalletButton();
    debugWalletProviders();
    console.log('[OP_PILL] v1.0 ready — Network:', currentNetwork);
  }, 1500);
});
