const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

function parseEther(value, fallback) {
  try {
    if (value === undefined || value === null || value === '') return fallback;
    const { ethers } = require('ethers');
    return ethers.parseEther(String(value));
  } catch {
    return fallback;
  }
}

const CONFIG = {
  rpcUrl: process.env.DCMON_RPC_URL || process.env.MONAD_RPC || '',
  dcmonToken: process.env.DCMON_TOKEN_ADDR || '',
  houseTreasury: process.env.DCMON_HOUSE_TREASURY || '',
  playerRewardPool: process.env.DCMON_PLAYER_REWARD_POOL || '',
  operatorKey: process.env.DCMON_OPERATOR_PK || '',
  paymasterAddress: process.env.DCMON_PAYMASTER_ADDR || '',
  paymasterMinBalance: parseEther(process.env.DCMON_PAYMASTER_MIN || '0.50', 0n),
  paymasterTopUpTarget: parseEther(process.env.DCMON_PAYMASTER_TARGET || '1.00', 0n),
  rewardHarvestIntervalMs: Number(process.env.DCMON_REWARD_INTERVAL_MS || 15 * 60 * 1000),
  paymasterCheckIntervalMs: Number(process.env.DCMON_PAYMASTER_INTERVAL_MS || 5 * 60 * 1000),
  swapQueueFile: path.resolve(process.env.DCMON_SWAP_QUEUE || path.join(__dirname, '..', 'artifacts', 'dcmon-agent', 'queue.json')),
  logDir: path.resolve(process.env.DCMON_LOG_DIR || path.join(__dirname, '..', 'artifacts', 'dcmon-agent')),
  dryRun: process.env.DCMON_DRY_RUN !== 'false',
  logLevel: process.env.DCMON_LOG_LEVEL || 'info',
  encryptionKeyHex: process.env.DCMON_LOG_ENC_KEY || '',
};

function ensureArtifacts() {
  if (!fs.existsSync(CONFIG.logDir)) {
    fs.mkdirSync(CONFIG.logDir, { recursive: true });
  }
  const queueDir = path.dirname(CONFIG.swapQueueFile);
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }
  if (!fs.existsSync(CONFIG.swapQueueFile)) {
    fs.writeFileSync(CONFIG.swapQueueFile, JSON.stringify({ swaps: [] }, null, 2));
  }
}

ensureArtifacts();

module.exports = {
  CONFIG,
};
