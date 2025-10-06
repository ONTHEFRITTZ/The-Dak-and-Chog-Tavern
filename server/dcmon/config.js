const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

function parseEther(value, fallback = 0n) {
  try {
    if (value === undefined || value === null || value === '') return fallback;
    return ethers.parseEther(String(value));
  } catch {
    return fallback;
  }
}

function parseBigInt(value, fallback = 0n) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return BigInt(value);
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
  poolAddress: process.env.DCMON_POOL_ADDR || '',
  wmonAddress: process.env.DCMON_WMON_ADDR || '',
  paymasterAddress: process.env.DCMON_PAYMASTER_ADDR || '',
  paymasterMinBalance: parseEther(process.env.DCMON_PAYMASTER_MIN || '5.00', 0n),
  paymasterTopUpTarget: parseEther(process.env.DCMON_PAYMASTER_TARGET || '10.00', 0n),
  paymasterTopUpChunk: parseEther(process.env.DCMON_PAYMASTER_CHUNK || '1'),
  rewardHarvestIntervalMs: Number(process.env.DCMON_REWARD_INTERVAL_MS || 15 * 60 * 1000),
  paymasterCheckIntervalMs: Number(process.env.DCMON_PAYMASTER_INTERVAL_MS || 5 * 60 * 1000),
  poolCheckIntervalMs: Number(process.env.DCMON_POOL_INTERVAL_MS || 10 * 60 * 1000),
  swapIntervalMs: Number(process.env.DCMON_SWAP_INTERVAL_MS || 60 * 1000),
  poolDcmonMin: parseEther(process.env.DCMON_POOL_MIN_DCMON || '5'),
  poolDcmonTarget: parseEther(process.env.DCMON_POOL_TARGET_DCMON || '10'),
  poolUnderlyingMin: parseEther(process.env.DCMON_POOL_MIN_UNDERLYING || '5'),
  poolUnderlyingTarget: parseEther(process.env.DCMON_POOL_TARGET_UNDERLYING || '10'),
  wrapMaxChunk: parseEther(process.env.DCMON_WRAP_MAX_CHUNK || '1'),
  operatorNativeReserve: parseEther(process.env.DCMON_OPERATOR_KEEP_NATIVE || '5'),
  rewardMinPayout: parseEther(process.env.DCMON_REWARD_MIN || '0'),
  rewardPayoutTarget: parseEther(process.env.DCMON_REWARD_TARGET || '0'),
  rewardKeepReserve: parseEther(process.env.DCMON_REWARD_KEEP_WMON || '0'),
  nativeTxGasLimit: parseBigInt(process.env.DCMON_NATIVE_GAS_LIMIT, 0n),
  approvalMaxAll: process.env.DCMON_APPROVE_MAX === 'false' ? false : true,
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
