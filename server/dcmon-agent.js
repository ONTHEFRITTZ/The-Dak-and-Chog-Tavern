/**
 * DCmon agent: handles paymaster top-ups, reward split accounting,
 * and buy-in swap queue processing.
 *
 * Currently operates in dry-run mode (no real swaps) but logs all intent
 * and keeps an auditable queue.
 */

const { ethers } = require('ethers');
const { CONFIG } = require('./dcmon/config');
const { logger, persistLog } = require('./dcmon/logger');
const { listSwaps, enqueueSwap, takeNextPending, markSwap } = require('./dcmon/queue');

function getProvider() {
  if (!CONFIG.rpcUrl) {
    logger.warn('No RPC URL configured (DCMON_RPC_URL)');
    return null;
  }
  return new ethers.JsonRpcProvider(CONFIG.rpcUrl);
}

async function ensurePaymasterBalance(provider) {
  if (!provider || !CONFIG.paymasterAddress) {
    logger.debug('Skipping paymaster check (missing provider or paymaster address)');
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
    dryRun: CONFIG.dryRun,
  });

  if (CONFIG.dryRun) {
    logger.info('Dry run: would perform paymaster top-up swap');
    return;
  }
  // TODO: perform swap and send funds to paymaster
}

async function harvestStakingRewards(provider) {
  persistLog('reward_harvest_check', {
    dcmonToken: CONFIG.dcmonToken,
    playerRewardPool: CONFIG.playerRewardPool,
    houseTreasury: CONFIG.houseTreasury,
    dryRun: CONFIG.dryRun,
  });
  if (CONFIG.dryRun) {
    logger.info('Dry run: would query staking venue and call recordRewards');
    return;
  }
  // TODO: harvest rewards and call DCMon.recordRewards via operator
}

async function processSwapQueue(provider) {
  const pendingSwaps = listSwaps().filter(s => s.status === 'pending');
  if (!pendingSwaps.length) {
    logger.debug('Swap queue empty');
    return;
  }
  let swap = null;
  while ((swap = takeNextPending())) {
    persistLog('swap_attempt', swap);
    if (CONFIG.dryRun) {
      logger.info({ swap }, 'Dry run: would execute swap');
      markSwap(swap.id, 'completed', { dryRun: true });
      continue;
    }
    try {
      // TODO: interact with DEX / aggregator and perform swap
      markSwap(swap.id, 'completed', { txHash: '0xTODO' });
    } catch (err) {
      logger.error({ err, swap }, 'Swap failed');
      markSwap(swap.id, 'failed', { message: err.message });
    }
  }
}

async function main() {
  logger.info({ config: { ...CONFIG, rpcUrl: CONFIG.rpcUrl ? '[redacted]' : '' } }, 'Starting DCmon agent');
  const provider = getProvider();

  if (!CONFIG.dryRun && !provider) {
    logger.error('Non-dry run requires RPC URL; exiting');
    process.exit(1);
  }

  await ensurePaymasterBalance(provider);
  await harvestStakingRewards(provider);
  await processSwapQueue(provider);

  setInterval(() => ensurePaymasterBalance(provider).catch(err => logger.error({ err }, 'Paymaster check failed')),
    CONFIG.paymasterCheckIntervalMs);
  setInterval(() => harvestStakingRewards(provider).catch(err => logger.error({ err }, 'Reward harvest failed')),
    CONFIG.rewardHarvestIntervalMs);
  setInterval(() => processSwapQueue(provider).catch(err => logger.error({ err }, 'Swap queue failed')),
    CONFIG.rewardHarvestIntervalMs);
}

if (require.main === module) {
  main().catch(err => {
    logger.error({ err }, 'DCmon agent crashed');
    process.exit(1);
  });
}

module.exports = {
  enqueueSwap,
  ensurePaymasterBalance,
  harvestStakingRewards,
  processSwapQueue,
};
