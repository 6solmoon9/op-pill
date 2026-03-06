/**
 * deploy.ts — PILL_VERSE OPPill deployment script
 *
 * Prerequisites:
 *   1. Build the contract first:
 *        npm run build
 *      This produces build/OPPill.wasm
 *
 *   2. Set environment variables:
 *        DEPLOYER_WIF    — WIF-encoded private key of the deploying wallet
 *        OPNET_NETWORK   — 'testnet' | 'mainnet' (default: testnet)
 *
 *   3. Run:
 *        npx ts-node contracts/deploy.ts
 *
 * The script will:
 *   - Connect to the OP_NET node
 *   - Read the compiled WASM bytecode
 *   - Broadcast a deployment transaction
 *   - Print the deployed contract address
 *   - Save the address to deploy.json for use in app.js
 */

import * as fs   from 'fs';
import * as path from 'path';

// @btc-vision/transaction provides the deployment utilities
// Install: npm install @btc-vision/transaction
import {
    DeployContractParameters,
    OPNetLimitedProvider,
    TransactionFactory,
    Wallet,
    networks,
} from '@btc-vision/transaction';

// ─── CONFIG ────────────────────────────────────────────────

const NETWORK     = (process.env.OPNET_NETWORK || 'testnet') as 'testnet' | 'mainnet';
const DEPLOYER_WIF = process.env.DEPLOYER_WIF;

const NODE_URL: Record<string, string> = {
    testnet: 'https://testnet.opnet.org',
    mainnet: 'https://opnet.org',
};

const BTC_NETWORK = NETWORK === 'mainnet' ? networks.bitcoin : networks.testnet;
const WASM_PATH   = path.resolve(__dirname, '../build/OPPill.wasm');
const OUT_PATH    = path.resolve(__dirname, '../deploy.json');

// ─── DEPLOY ────────────────────────────────────────────────

async function deploy(): Promise<void> {
    if (!DEPLOYER_WIF) {
        throw new Error('DEPLOYER_WIF env variable is required');
    }

    console.log(`\n[deploy] Network : ${NETWORK}`);
    console.log(`[deploy] Node    : ${NODE_URL[NETWORK]}`);
    console.log(`[deploy] WASM    : ${WASM_PATH}\n`);

    // ── Read compiled WASM ──────────────────────────────────
    if (!fs.existsSync(WASM_PATH)) {
        throw new Error(`WASM not found at ${WASM_PATH}. Run "npm run build" first.`);
    }
    const wasm = fs.readFileSync(WASM_PATH);
    console.log(`[deploy] WASM size: ${wasm.byteLength} bytes`);

    // ── Set up wallet ───────────────────────────────────────
    const wallet = Wallet.fromWIF(DEPLOYER_WIF, BTC_NETWORK);
    console.log(`[deploy] Deployer: ${wallet.address}`);

    // ── Connect to OP_NET node ──────────────────────────────
    const provider = new OPNetLimitedProvider(NODE_URL[NETWORK]);
    const factory  = new TransactionFactory({ provider, network: BTC_NETWORK });

    // ── Build deployment transaction ────────────────────────
    const params: DeployContractParameters = {
        from:     wallet.address,
        bytecode: wasm,
        // No constructor calldata — onDeployment() takes no external args
        calldata: Buffer.alloc(0),
    };

    const { transaction, contractAddress } = await factory.deployContract(params);
    console.log(`[deploy] Contract address (predicted): ${contractAddress}`);

    // ── Sign and broadcast ──────────────────────────────────
    const signed = wallet.signTransaction(transaction);
    const txid   = await provider.broadcastTransaction(signed);
    console.log(`[deploy] TX broadcast: ${txid}`);
    console.log(`[deploy] Explorer   : https://${NETWORK === 'testnet' ? 'testnet.' : ''}opnet.org/tx/${txid}\n`);

    // ── Save result ─────────────────────────────────────────
    const result = {
        network:         NETWORK,
        contractAddress,
        deployTxid:      txid,
        deployedAt:      new Date().toISOString(),
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
    console.log(`[deploy] Saved to ${OUT_PATH}`);
    console.log('\n✅ Deployment complete!');
    console.log(`\nNext step: update app.js:`);
    console.log(`  contractAddress: '${contractAddress}'`);
}

deploy().catch(err => {
    console.error('\n❌ Deployment failed:', err.message);
    process.exit(1);
});
