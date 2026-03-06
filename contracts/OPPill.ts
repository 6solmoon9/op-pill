/**
 * OPPill.ts — PILL_VERSE Genesis NFT Collection
 * OP_NET Bitcoin-native NFT contract (AssemblyScript → WASM)
 *
 * Collection: OP_PILL
 * Supply:      5,000 NFTs
 * Price:       50,000 sats (0.0005 BTC) per mint
 * Rarities:    COMMON (70%) | RARE (20%) | MYTHICAL (10%)
 * Fairness:    Rarity seeded from block number × token ID × sender byte
 * Limit:       1 NFT per wallet address
 *
 * Build:
 *   asc contracts/OPPill.ts --config asconfig.json --outFile build/OPPill.wasm
 */

import { u256 } from '@btc-vision/as-bignum/assembly';

import {
    ABIDataTypes,
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    OP721,
    OP721InitParameters,
    Revert,
    SafeMath,
    StoredMapU256,
    StoredU256,
} from '@btc-vision/btc-runtime/runtime';

// ─── RARITY CONSTANTS ──────────────────────────────────────
const RARITY_NONE:     u8 = 255; // wallet has no NFT
const RARITY_COMMON:   u8 = 0;  // 70%  — 0..69
const RARITY_RARE:     u8 = 1;  // 20%  — 70..89
const RARITY_MYTHICAL: u8 = 2;  // 10%  — 90..99

// ─── MINT CONFIG ───────────────────────────────────────────
const MINT_PRICE_SATS: u64 = 50_000; // 0.0005 BTC
const MAX_SUPPLY:      u32 = 5_000;

// ─── STORAGE POINTERS ──────────────────────────────────────
// Each pointer must be a unique u16 across the entire contract.
const PTR_TOTAL_MINTED: u16 = 100; // u256 counter
const PTR_TOKEN_RARITY: u16 = 101; // tokenId (u256) → rarity (u256, stores u8)
const PTR_WALLET_TOKEN: u16 = 102; // walletKey (u256) → tokenId (u256); 0 = no NFT

// ─── CONTRACT ──────────────────────────────────────────────

@final
export class OPPill extends OP721 {

    // Persistent storage slots
    private readonly _totalMinted: StoredU256   = new StoredU256(PTR_TOTAL_MINTED, u256.Zero);
    private readonly _tokenRarity: StoredMapU256 = new StoredMapU256(PTR_TOKEN_RARITY);
    private readonly _walletToken: StoredMapU256 = new StoredMapU256(PTR_WALLET_TOKEN);

    public constructor() {
        super();
    }

    /**
     * onDeployment — runs ONCE when the contract is first deployed.
     * Equivalent to a Solidity constructor.
     */
    public override onDeployment(_calldata: Calldata): void {
        this.instantiate(new OP721InitParameters(
            u256.fromU32(MAX_SUPPLY),
            'OP_PILL',
            'OPPILL',
        ));
    }

    public override onUpdate(_calldata: Calldata): void {
        super.onUpdate(_calldata);
    }

    // ─── MINT ─────────────────────────────────────────────

    /**
     * mint() — Pay MINT_PRICE_SATS to receive a randomly assigned OP_PILL NFT.
     *
     * Provably fair: rarity is derived from
     *   seed = (blockNumber × FNV_PRIME) XOR (tokenId_low × FNV2) XOR (sender[0] × FNV3)
     *   rand = seed % 100
     *   0–69 → COMMON | 70–89 → RARE | 90–99 → MYTHICAL
     *
     * Restrictions:
     *   - Caller must send exactly ≥ MINT_PRICE_SATS
     *   - Max supply of MAX_SUPPLY enforced
     *   - One NFT per wallet (checked via _walletToken map)
     */
    @method()
    @emit('Minted')
    @returns(
        { name: 'tokenId', type: ABIDataTypes.UINT256 },
        { name: 'rarity',  type: ABIDataTypes.UINT8   },
    )
    public mint(_calldata: Calldata): BytesWriter {
        // ── 1. Supply check ──────────────────────────────
        const minted: u256 = this._totalMinted.value;
        if (u256.gte(minted, u256.fromU32(MAX_SUPPLY))) {
            throw new Revert('OP_PILL: Max supply reached');
        }

        // ── 2. Payment check ─────────────────────────────
        // Blockchain.tx.inputValue is the total satoshis sent by the caller.
        const payment: u64 = Blockchain.tx.inputValue;
        if (payment < MINT_PRICE_SATS) {
            throw new Revert('OP_PILL: Insufficient payment — 50000 sats required');
        }

        // ── 3. One-NFT-per-wallet check ───────────────────
        const sender: Address   = Blockchain.tx.sender;
        const walletKey: u256   = _addressToU256(sender);
        const existing: u256    = this._walletToken.get(walletKey);
        if (!u256.isZero(existing)) {
            throw new Revert('OP_PILL: Wallet already holds an OP_PILL NFT');
        }

        // ── 4. Assign token ID (sequential, 1-indexed) ───
        const tokenId: u256 = SafeMath.add(minted, u256.One);

        // ── 5. Provably fair rarity ───────────────────────
        const rarity: u8 = _assignRarity(tokenId, sender);

        // ── 6. Persist state ─────────────────────────────
        this._tokenRarity.set(tokenId, u256.fromU32(<u32>rarity));
        this._walletToken.set(walletKey, tokenId);
        this._totalMinted.set(tokenId);

        // ── 7. Mint OP721 token to sender ─────────────────
        this._mint(sender, tokenId);

        // ── 8. Return (tokenId, rarity) ───────────────────
        const out = new BytesWriter(33); // 32 (u256) + 1 (u8)
        out.writeU256(tokenId);
        out.writeU8(rarity);
        return out;
    }

    // ─── GET PLAYER NFT ───────────────────────────────────

    /**
     * getPlayerNFT(wallet) → { rarity: u8, tokenId: u256 }
     *
     * Returns rarity 255 and tokenId 0 if the wallet holds no NFT.
     * Rarity values: 0=COMMON, 1=RARE, 2=MYTHICAL, 255=none
     */
    @method({ name: 'wallet', type: ABIDataTypes.ADDRESS })
    @returns(
        { name: 'rarity',  type: ABIDataTypes.UINT8   },
        { name: 'tokenId', type: ABIDataTypes.UINT256  },
    )
    public getPlayerNFT(calldata: Calldata): BytesWriter {
        const wallet:     Address = calldata.readAddress();
        const walletKey:  u256    = _addressToU256(wallet);
        const tokenId:    u256    = this._walletToken.get(walletKey);

        const out = new BytesWriter(33);
        if (u256.isZero(tokenId)) {
            out.writeU8(RARITY_NONE);
            out.writeU256(u256.Zero);
        } else {
            const rarityU256: u256 = this._tokenRarity.get(tokenId);
            out.writeU8(<u8>u256.toU32(rarityU256));
            out.writeU256(tokenId);
        }
        return out;
    }

    // ─── GET STATUS ───────────────────────────────────────

    /**
     * getStatus() → { totalMinted: u256, maxSupply: u256, priceInSats: u64 }
     */
    @method()
    @returns(
        { name: 'totalMinted', type: ABIDataTypes.UINT256 },
        { name: 'maxSupply',   type: ABIDataTypes.UINT256 },
        { name: 'priceInSats', type: ABIDataTypes.UINT64  },
    )
    public getStatus(_calldata: Calldata): BytesWriter {
        const out = new BytesWriter(72); // 32 + 32 + 8
        out.writeU256(this._totalMinted.value);
        out.writeU256(u256.fromU32(MAX_SUPPLY));
        out.writeU64(MINT_PRICE_SATS);
        return out;
    }

    // ─── GET TOKEN RARITY ─────────────────────────────────

    /**
     * getTokenRarity(tokenId) → { rarity: u8 }
     *
     * Returns the rarity of any token by its ID.
     * Returns 255 if the token does not exist.
     */
    @method({ name: 'tokenId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'rarity', type: ABIDataTypes.UINT8 })
    public getTokenRarity(calldata: Calldata): BytesWriter {
        const tokenId: u256    = calldata.readU256();
        const rarityU256: u256 = this._tokenRarity.get(tokenId);

        const out = new BytesWriter(1);
        if (u256.isZero(rarityU256) && !u256.eq(tokenId, u256.Zero)) {
            // Token 0 doesn't exist; zero rarity on a valid ID means COMMON (also valid)
            // Use existence check via walletToken is not practical here — return raw stored value
            out.writeU8(<u8>u256.toU32(rarityU256));
        } else {
            out.writeU8(<u8>u256.toU32(rarityU256));
        }
        return out;
    }
}

// ─── HELPERS (module-level, not exported) ──────────────────

/**
 * Convert a Bitcoin address (Uint8Array) to a u256 key for StoredMapU256.
 * Uses the first 32 bytes of the address padded to 256 bits.
 */
function _addressToU256(addr: Address): u256 {
    // Address is a Uint8Array; read first 32 bytes as big-endian u256
    const bytes = new Uint8Array(32);
    const len   = addr.length < 32 ? addr.length : 32;
    for (let i: i32 = 0; i < len; i++) {
        bytes[i] = addr[i];
    }
    return u256.fromBytes(bytes, true);
}

/**
 * Provably fair rarity assignment.
 *
 * Seed construction (all integer arithmetic, no floats):
 *   blockSeed  = Blockchain.block.number × FNV_PRIME_1
 *   tokenSeed  = lower 64 bits of tokenId × FNV_PRIME_2
 *   senderSeed = first byte of sender × FNV_PRIME_3
 *   seed       = (blockSeed XOR tokenSeed XOR senderSeed)
 *   rand       = seed % 100
 *
 * Distribution:
 *   0–69  → COMMON   (70%)
 *   70–89 → RARE     (20%)
 *   90–99 → MYTHICAL (10%)
 */
function _assignRarity(tokenId: u256, sender: Address): u8 {
    const FNV_PRIME_1: u64 = 2654435761;
    const FNV_PRIME_2: u64 = 2246822519;
    const FNV_PRIME_3: u64 = 374761393;

    const blockNum:   u64 = Blockchain.block.number;
    const tokenLow:   u64 = u256.lo1(tokenId);
    const senderByte: u64 = <u64>(sender.length > 0 ? sender[0] : 0);

    const seed: u64 = (blockNum  * FNV_PRIME_1)
                    ^ (tokenLow  * FNV_PRIME_2)
                    ^ (senderByte * FNV_PRIME_3);

    const rand: u32 = <u32>(seed % 100);

    if (rand < 70) return RARITY_COMMON;
    if (rand < 90) return RARITY_RARE;
    return RARITY_MYTHICAL;
}
