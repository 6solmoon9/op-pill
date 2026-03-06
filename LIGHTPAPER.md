# PILL_VERSE — Lightpaper v1.0

## What is PILL_VERSE?
PILL_VERSE is a Bitcoin-native Play-to-Earn (P2E) platform built on OP_NET (Bitcoin L1). It combines NFT minting, a skill-based arcade game (PILL_CATCHER), and a daily prize distribution system — all powered by real BTC.

## The NFT Collection: OP_PILL
- Total Supply: 5,000 NFTs
- Mint Price: 0.0005 BTC per NFT
- Network: Bitcoin L1 via OP_NET (Testnet → Mainnet Q2 2026)
- Mint is 100% random and provably fair
- Rarities: COMMON (70%) / RARE (20%) / MYTHICAL (10%)

## NFT Benefits in Game
| Rarity | Lives | Score Multiplier | Bonus Pool Share |
|--------|-------|-----------------|-----------------|
| No NFT | 1 | x1.0 | None |
| COMMON | 2 | x1.2 | 1 share |
| RARE | 3 | x2.5 | 2.5 shares |
| MYTHICAL | 5 | x6.0 | 6 shares |

## The Game: PILL_CATCHER
PILL_CATCHER is a skill-based arcade game where players control a pill capsule character.

### How to Play
1. Connect your Bitcoin wallet (OP_Wallet / UniSat / OKX)
2. Choose your Entry Fee tier before starting
3. Catch falling Bitcoin icons to earn points
4. Dodge falling viruses — each hit costs one life
5. Build combos by catching consecutive Bitcoins
6. Game ends when all lives are lost

### Score Formula
Final Score = Coins × Entry Multiplier × NFT Multiplier × Combo

### Entry Fee Tiers
| Tier | Cost | Score Multiplier |
|------|------|-----------------|
| BRONZE | $0.10 in BTC | x1 |
| SILVER | $1.00 in BTC | x10 |
| GOLD | $10.00 in BTC | x100 |

## Daily Prize Distribution
Every 24 hours at 00:00 UTC, the entire daily treasury is distributed:

| Recipient | Share | Condition |
|-----------|-------|-----------|
| 🥇 1st Place | 15% | Highest score of the day |
| 🥈 2nd Place | 10% | — |
| 🥉 3rd Place | 8% | — |
| 4th Place | 7% | — |
| 💊 NFT Holders | 25% | Hold any OP_PILL NFT |
| 👥 Participation | 20% | Play 10+ paid games in a day |
| 🔄 Liquidity | 10% | NFT marketplace support |

## Reward Rules
- Rewards never expire — they accumulate in your dashboard until claimed
- NFT Holder bonus requires NFT to be in wallet at time of CLAIM
- Participation pool requires minimum 10 paid games in a single day
- All rewards are claimed manually via the Player Dashboard

## How to Get Started
1. Install OP_Wallet Chrome extension from opnet.org
2. Create a wallet and switch to Testnet network
3. Get testnet BTC from a faucet
4. Visit PILL_VERSE and click CONNECT WALLET
5. Mint an OP_PILL NFT for bonus multipliers (optional)
6. Click PLAY NOW and select your entry fee
7. Play, earn points, climb the leaderboard
8. Claim your daily rewards in the Dashboard

## Security & Fair Play
- All scores validated server-side via Supabase
- Wallet signature required for every score submission
- Anti-cheat: scores exceeding physical maximum are rejected
- 3 warnings = permanent wallet ban from rewards
- Mint randomness uses crypto.getRandomValues() — cannot be influenced by anyone

## Roadmap
- Q1 2026: Testnet launch, PILL_CATCHER game, NFT minting ✓
- Q2 2026: Mainnet launch, real BTC rewards, Supabase leaderboard

## Supported Wallets
- OP_Wallet (Recommended) — opnet.org/wallet
- UniSat Wallet — unisat.io
- OKX Wallet — okx.com/web3
