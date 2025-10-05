/**
 * DCmon agent: handles swaps, reward accounting, and paymaster funding scaffolding.
 * This is a dry-run skeleton that logs intended actions. Swap and on-chain
 * interactions will be plugged in once liquidity routes are ready.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pino = require('pino');
const { ethers } = require('ethers');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const logger = pino({ level: process.env.DCMON_LOG_LEVEL || 'info' });

const CONFIG = {
  rpcUrl: process.env.DCMON_RPC_URL || process.env.MONAD_RPC || '',
  dcmonToken: process.env.DCMON_TOKEN_ADDR || '',
  houseTreasury: process.env.DCMON_HOUSE_TREASURY || '',
  playerRewardPool: process.env.DCMON_PLAYER_REWARD_POOL || '',
  paymasterAddress: process.env.DCMON_PAYMASTER_ADDR || '',
  paymasterMinBalance: ethers.parseEther(process.env.DCMON_PAYMASTER_MIN || '0.50'),
  paymasterTopUpTarget: ethers.parseEther(process.env.DCMON_PAYMASTER_TARGET || '1.00'),
  rewardHarvestIntervalMs: Number(process.env.DCMON_REWARD_INTERVAL_MS || 15 * 60 * 1000),
  paymasterCheckIntervalMs: Number(process.env.DCMON_PAYMASTER_INTERVAL_MS || 5 * 60 * 1000),
  logDir: path.resolve(process.env.DCMON_LOG_DIR || path.join(__dirname, '..', 'artifacts', 'dcmon-agent')),
  dryRun: process.env.DCMON_DRY_RUN !== 'false',
};

if (!fs.existsSync(CONFIG.logDir)) {
  fs.mkdirSync(CONFIG.logDir, { recursive: true });
}

const LOG_FILE = path.join(CONFIG.logDir, 'operations.log');
const ENC_KEY_HEX = process.env.DCMON_LOG_ENC_KEY || '';
let encryptionKey = null;
if (ENC_KEY_HEX) {
  const data = ENC_KEY_HEX.startsWith('0x') ? ENC_KEY_HEX.slice(2) : ENC_KEY_HEX;
  encryptionKey = crypto.createHash('sha256').update(data, 'hex').digest();
} else {
  logger.warn('DCMON_LOG_ENC_KEY not set; operations log will be written in plaintext');
}

function encryptPayload(payloadBuffer) {
  if (!encryptionKey) return { plaintext: payloadBuffer.toString('utf8') };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function persistLog(eventType, payload) {
  const entry = {
    timestamp: new Date().toISOString(),
    eventType,
    ...encryptPayload(Buffer.from(JSON.stringify(payload, null, 2))),
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

function makeProvider() {
  if (!CONFIG.rpcUrl) {
    logger.warn('No RPC URL configured; agent running in dry mode');
    return null;
  }
  return new ethers.JsonRpcProvider(CONFIG.rpcUrl);
}

async function ensurePaymasterBalance(provider) {
  if (!provider || !CONFIG.paymasterAddress) {
    logger.debug('Skipping paymaster check (missing provider or address)');
    return;
  }
  const balance = await provider.getBalance(CONFIG.paymasterAddress);
  logger.debug({ balance: balance.toString() }, 'paymaster balance');
  if (balance >= CONFIG.paymasterMinBalance) return;

  const topUpAmount = CONFIG.paymasterTopUpTarget - balance;
  persistLog('paymaster_topup_requested', {
    currentBalance: balance.toString(),
    targetBalance: CONFIG.paymasterTopUpTarget.toString(),
    topUpRequired: topUpAmount.toString(),
  });
  if (CONFIG.dryRun) {
    logger.info('Dry run: would perform paymaster top-up swap');
    return;
  }
  // TODO: implement swap DCmon -> native and send to paymaster
}

async function harvestStakingRewards(provider) {
  if (!CONFIG.dcmonToken || !CONFIG.playerRewardPool || !CONFIG.houseTreasury) {
    logger.debug('Skipping reward harvest (missing config)');
    return;
  }
  persistLog('reward_harvest_check', {
    dcmonToken: CONFIG.dcmonToken,
    playerRewardPool: CONFIG.playerRewardPool,
    houseTreasury: CONFIG.houseTreasury,
  });
  if (CONFIG.dryRun) {
    logger.info('Dry run: would query staking rewards and call recordRewards');
    return;
  }
  // TODO: pull rewards from staking venue and call recordRewards via operator signer
}

async function sweepSwapQueue(provider) {
  persistLog('swap_queue_check', { dryRun: CONFIG.dryRun });
  if (CONFIG.dryRun) {
    logger.info('Dry run: would process queued swaps');
    return;
  }
  // TODO: load swap queue, execute trades, update logs.
}

async function main() {
  logger.info({ config: { ...CONFIG, rpcUrl: CONFIG.rpcUrl ? '[redacted]' : '' } }, 'Starting DCmon agent');
  const provider = makeProvider();

  if (!CONFIG.dryRun && !provider) {
    logger.error('No provider configured while dryRun=false; exiting');
    process.exit(1);
  }

  await ensurePaymasterBalance(provider);
  await harvestStakingRewards(provider);
  await sweepSwapQueue(provider);

  setInterval(() => ensurePaymasterBalance(provider).catch(err => logger.error({ err }, 'paymaster check failed')),
    CONFIG.paymasterCheckIntervalMs);
  setInterval(() => harvestStakingRewards(provider).catch(err => logger.error({ err }, 'reward harvest failed')),
    CONFIG.rewardHarvestIntervalMs);
  setInterval(() => sweepSwapQueue(provider).catch(err => logger.error({ err }, 'swap queue processing failed')),
    CONFIG.rewardHarvestIntervalMs);
}

if (require.main === module) {
  main().catch(err => {
    logger.error({ err }, 'DCmon agent crashed');
    process.exit(1);
  });
}

module.exports = {
  CONFIG,
  ensurePaymasterBalance,
  harvestStakingRewards,
  sweepSwapQueue,
};
