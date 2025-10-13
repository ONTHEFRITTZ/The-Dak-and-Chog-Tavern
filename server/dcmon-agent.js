/**
 * DCmon automation agent
 * - Keeps the BankrollPool funded with DCMon / WMON liquidity
 * - Wraps native MON and manages approvals on demand
 * - Tops up the account abstraction paymaster when balances fall below thresholds
 * - Records staking rewards and processes queued swap/cash-out jobs
 */

const { ethers } = require('ethers');
const { CONFIG } = require('./dcmon/config');
const { logger, persistLog } = require('./dcmon/logger');
const { listSwaps, enqueueSwap, takeNextPending, markSwap } = require('./dcmon/queue');
const { buildContracts, connectPokerTable } = require('./dcmon/contracts');

const formatEther = (value) => {
  try {
    return ethers.formatEther(value);
  } catch {
    return value?.toString?.() || String(value);
  }
};

const MAX_UINT = ethers.MaxUint256;

let cachedProvider = null;
let cachedSigner = null;
let cachedOperatorAddress = null;
let cachedContracts = null;
let cachedContractsKey = null;

function getProvider() {
  if (cachedProvider) return cachedProvider;
  if (!CONFIG.rpcUrl) {
    logger.warn('No RPC URL configured (DCMON_RPC_URL)');
    return null;
  }
  cachedProvider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  return cachedProvider;
}

async function getSigner(provider) {
  if (CONFIG.dryRun) return null;
  if (!CONFIG.operatorKey) {
    throw new Error('DCMON_OPERATOR_PK must be configured when not running in dry-run mode');
  }
  if (!provider) {
    throw new Error('JSON-RPC provider required to initialise signer');
  }
  if (!cachedSigner) {
    cachedSigner = new ethers.Wallet(CONFIG.operatorKey, provider);
    cachedOperatorAddress = await cachedSigner.getAddress();
  }
  return cachedSigner;
}

async function getContext(provider) {
  provider = provider || getProvider();

  let signer = null;
  try {
    signer = await getSigner(provider);
  } catch (err) {
    if (!CONFIG.dryRun) {
      throw err;
    }
    // Dry-run with no signer is allowed; continue with null signer
    if (!cachedOperatorAddress && CONFIG.operatorKey) {
      try {
        const tmpWallet = new ethers.Wallet(CONFIG.operatorKey);
        cachedOperatorAddress = await tmpWallet.getAddress();
      } catch {
        /* ignore */
      }
    }
  }

  if (signer && !cachedOperatorAddress) {
    cachedOperatorAddress = await signer.getAddress();
  }

  let contracts = { wmon: null, dcmon: null, pool: null, pokerTables: {} };
  const contractsKey = provider || signer || null;
  if (contractsKey) {
    if (!cachedContracts || cachedContractsKey !== contractsKey) {
      cachedContracts = buildContracts(provider, signer);
      cachedContractsKey = contractsKey;
    }
    contracts = cachedContracts;
  }

  return {
    provider,
    signer,
    operatorAddress: cachedOperatorAddress,
    wmon: contracts?.wmon || null,
    dcmon: contracts?.dcmon || null,
    pool: contracts?.pool || null,
    pokerTables: contracts?.pokerTables || {},
  };
}

function ensureConfigAddress(value, label) {
  if (!value) {
    logger.debug({ label }, 'Skipping action - configuration value missing');
    return false;
  }
  return true;
}

async function executeTx(label, txFn, meta = {}) {
  if (CONFIG.dryRun) {
    persistLog(`${label}_dry_run`, { ...meta, dryRun: true });
    logger.info({ label, meta }, 'Dry run: skipping transaction');
    return null;
  }
  const tx = await txFn();
  persistLog('tx_submitted', { label, hash: tx.hash, ...stringifyBigInts(meta) });
  logger.info({ label, hash: tx.hash }, 'Transaction submitted');
  const receipt = await tx.wait();
  persistLog('tx_confirmed', { label, hash: tx.hash, blockNumber: receipt.blockNumber, ...stringifyBigInts(meta) });
  logger.info({ label, hash: tx.hash, blockNumber: receipt.blockNumber }, 'Transaction confirmed');
  return receipt;
}

function stringifyBigInts(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    out[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return out;
}

function clampBigInt(value, minimum = 0n) {
  return value > minimum ? value : 0n;
}

async function wrapNative(amount, ctx, extraMeta = {}) {
  if (amount <= 0n) return 0n;
  const { provider, signer, operatorAddress, wmon } = ctx;
  if (!wmon || !signer) {
    logger.warn('Cannot wrap native MON - signer or WMON contract missing');
    return 0n;
  }
  if (!provider) {
    logger.warn('Cannot wrap native MON without provider access');
    return 0n;
  }
  const nativeBalance = await provider.getBalance(operatorAddress);
  const reserve = CONFIG.operatorNativeReserve;
  const available = nativeBalance > reserve ? nativeBalance - reserve : 0n;
  if (available <= 0n) {
    logger.warn({ balance: formatEther(nativeBalance), reserve: formatEther(reserve) }, 'No native balance available for wrapping');
    return 0n;
  }
  let wrapAmount = amount;
  if (wrapAmount > available) wrapAmount = available;
  if (CONFIG.wrapMaxChunk > 0n && wrapAmount > CONFIG.wrapMaxChunk) wrapAmount = CONFIG.wrapMaxChunk;
  if (wrapAmount <= 0n) return 0n;

  persistLog('wrap_native_request', {
    amountRequested: amount.toString(),
    wrapAmount: wrapAmount.toString(),
    available: available.toString(),
    reserve: reserve.toString(),
    ...stringifyBigInts(extraMeta),
  });

  await executeTx('wrap_native', () => wmon.deposit({ value: wrapAmount }), {
    amount: wrapAmount,
    ...extraMeta,
  });

  logger.info({ amount: formatEther(wrapAmount) }, 'Wrapped native MON into WMON');
  return wrapAmount;
}

async function ensureAllowance(token, owner, spender, required, label) {
  if (!token || !owner || !spender || required <= 0n) return;
  const current = await token.allowance(owner, spender);
  if (current >= required) return;
  const approveValue = CONFIG.approvalMaxAll ? MAX_UINT : required;
  persistLog('approval_request', {
    owner,
    spender,
    required: required.toString(),
    approveValue: approveValue.toString(),
    label,
  });
  await executeTx(label || 'token_approve', () => token.approve(spender, approveValue), {
    owner,
    spender,
    approveValue,
  });
  logger.info({ spender, approveValue: approveValue === MAX_UINT ? 'MAX' : formatEther(approveValue) }, 'Token approval updated');
}

async function redeemFromPool(amount, ctx) {
  if (amount <= 0n) return;
  const { pool } = ctx;
  if (!pool) throw new Error('Pool contract unavailable for redeem');
  persistLog('pool_redeem_request', { amount: amount.toString() });
  await executeTx('pool_redeem', () => pool.redeemDcmon(amount), { amount });
  logger.info({ amount: formatEther(amount) }, 'Redeemed DCmon for underlying WMON in pool');
}

async function withdrawUnderlyingToOperator(amount, ctx) {
  if (amount <= 0n) return;
  const { pool, operatorAddress } = ctx;
  if (!pool || !operatorAddress) throw new Error('Cannot withdraw underlying: missing pool or operator');
  persistLog('pool_withdraw_underlying_request', { amount: amount.toString(), to: operatorAddress });
  await executeTx('pool_withdraw_underlying', () => pool.withdrawUnderlying(operatorAddress, amount), {
    amount,
    to: operatorAddress,
  });
  logger.info({ amount: formatEther(amount) }, 'Withdrew WMON from pool to operator wallet');
}

async function ensureUnderlyingAvailable(amount, ctx) {
  if (amount <= 0n) return;
  const { pool, provider } = ctx;
  if (!pool) throw new Error('Bankroll pool contract not configured');
  if (!provider && !CONFIG.dryRun) throw new Error('Provider required for pool checks');

  let underlyingBalance = 0n;
  if (provider) {
    underlyingBalance = await pool.poolUnderlyingBalance();
  }
  if (underlyingBalance >= amount) {
    await withdrawUnderlyingToOperator(amount, ctx);
    return;
  }

  const deficit = amount - underlyingBalance;
  const dcBalance = provider ? await pool.poolDcmonBalance() : 0n;
  if (dcBalance <= 0n) {
    throw new Error('Pool has no DCmon to redeem for underlying');
  }

  let redeemAmount = deficit;
  if (CONFIG.poolDcmonMin > 0n && dcBalance > CONFIG.poolDcmonMin) {
    const maxRedeem = dcBalance - CONFIG.poolDcmonMin;
    if (redeemAmount > maxRedeem) redeemAmount = maxRedeem;
  }
  if (redeemAmount <= 0n) {
    logger.warn('Redeem amount reduced to zero to respect pool minimums');
  } else {
    await redeemFromPool(redeemAmount, ctx);
  }
  await withdrawUnderlyingToOperator(amount, ctx);
}

async function prepareWmonBalance(required, ctx, reason) {
  if (required <= 0n) return 0n;
  const { wmon, provider, operatorAddress } = ctx;
  if (!wmon) throw new Error('WMON contract not configured');
  let balance = provider ? await wmon.balanceOf(operatorAddress) : (CONFIG.dryRun ? required : 0n);
  if (balance >= required) return required;
  const deficit = required - balance;
  const wrapped = await wrapNative(deficit, ctx, { reason });
  balance += wrapped;
  if (balance >= required) return required;
  // Unable to wrap enough native; limit to available balance
  logger.warn({ requested: formatEther(required), available: formatEther(balance) }, 'Insufficient WMON balance; using available amount');
  return balance;
}

async function ensurePoolLiquidity(provider) {
  if (!ensureConfigAddress(CONFIG.poolAddress, 'DCMON_POOL_ADDR')) return;
  if (!ensureConfigAddress(CONFIG.dcmonToken, 'DCMON_TOKEN_ADDR')) return;

  const ctx = await getContext(provider);
  const { pool, wmon, operatorAddress } = ctx;
  if (!pool || !wmon) {
    logger.warn('Pool or WMON contract unavailable; skipping liquidity check');
    return;
  }
  if (!operatorAddress) {
    if (!CONFIG.dryRun) {
      throw new Error('Operator address unavailable - cannot manage pool liquidity');
    }
    logger.warn('Operator address unknown; skipping pool liquidity automation');
    return;
  }
  if (!ctx.provider && !CONFIG.dryRun) {
    throw new Error('Provider required for pool liquidity automation');
  }

  let dcBalance = ctx.provider ? await pool.poolDcmonBalance() : 0n;
  if (CONFIG.poolDcmonTarget > 0n && dcBalance < CONFIG.poolDcmonTarget) {
    const deficit = CONFIG.poolDcmonTarget - dcBalance;
    const depositAmount = await prepareWmonBalance(deficit, ctx, 'pool_liquidity');
    if (depositAmount > 0n) {
      await ensureAllowance(wmon, operatorAddress, CONFIG.poolAddress, depositAmount, 'pool_deposit_allowance');
      await executeTx('pool_deposit', () => pool.depositUnderlying(depositAmount), { amount: depositAmount });
      persistLog('pool_deposit_complete', { amount: depositAmount.toString() });
      logger.info({ amount: formatEther(depositAmount) }, 'Deposited underlying into BankrollPool');
      if (ctx.provider) {
        dcBalance = await pool.poolDcmonBalance();
      }
    } else {
      logger.warn('Unable to acquire WMON for pool top-up');
    }
  }

  if (ctx.provider && CONFIG.poolUnderlyingMin > 0n) {
    const underlyingBalance = await pool.poolUnderlyingBalance();
    if (underlyingBalance < CONFIG.poolUnderlyingMin) {
      const target = CONFIG.poolUnderlyingTarget > 0n ? CONFIG.poolUnderlyingTarget : CONFIG.poolUnderlyingMin;
      const needed = target > underlyingBalance ? target - underlyingBalance : 0n;
      if (needed > 0n) {
        await redeemFromPool(needed, ctx);
      }
    }
  }
}

async function ensurePaymasterBalance(provider, overrideAmount = 0n) {
  if (!ensureConfigAddress(CONFIG.paymasterAddress, 'DCMON_PAYMASTER_ADDR')) return;
  const ctx = await getContext(provider);
  const { provider: rpc, wmon, signer, operatorAddress } = ctx;
  if (!rpc && !CONFIG.dryRun) {
    throw new Error('Provider required for paymaster checks');
  }
  if (!wmon || !operatorAddress) {
    logger.warn('WMON contract or operator address missing; skipping paymaster check');
    return;
  }

  let currentBalance = 0n;
  if (rpc) {
    currentBalance = await rpc.getBalance(CONFIG.paymasterAddress);
  }

  let requiredTopUp = 0n;
  if (overrideAmount > 0n) {
    requiredTopUp = overrideAmount;
  } else if (CONFIG.paymasterTopUpTarget > 0n && currentBalance < CONFIG.paymasterMinBalance) {
    requiredTopUp = CONFIG.paymasterTopUpTarget - currentBalance;
    if (CONFIG.paymasterTopUpChunk > 0n && requiredTopUp > CONFIG.paymasterTopUpChunk) {
      requiredTopUp = CONFIG.paymasterTopUpChunk;
    }
  }

  if (requiredTopUp <= 0n) {
    logger.debug('Paymaster balance within thresholds; no action needed');
    return;
  }

  persistLog('paymaster_topup_request', {
    currentBalance: currentBalance.toString(),
    requiredTopUp: requiredTopUp.toString(),
    override: overrideAmount.toString(),
  });

  let wmonBalance = rpc ? await wmon.balanceOf(operatorAddress) : requiredTopUp;
  if (wmonBalance < requiredTopUp && ctx.pool) {
    const deficit = requiredTopUp - wmonBalance;
    await ensureUnderlyingAvailable(deficit, ctx);
    wmonBalance = rpc ? await wmon.balanceOf(operatorAddress) : requiredTopUp;
  }
  if (wmonBalance < requiredTopUp) {
    await wrapNative(requiredTopUp - wmonBalance, ctx, { reason: 'paymaster_topup' });
    wmonBalance = rpc ? await wmon.balanceOf(operatorAddress) : requiredTopUp;
  }
  if (wmonBalance < requiredTopUp) {
    logger.warn({ required: formatEther(requiredTopUp), available: formatEther(wmonBalance) }, 'Unable to source sufficient WMON for paymaster top-up');
    return;
  }

  await executeTx('paymaster_unwrap', () => wmon.withdraw(requiredTopUp), { amount: requiredTopUp });
  logger.info({ amount: formatEther(requiredTopUp) }, 'Unwrapped WMON for paymaster funding');

  await executeTx('paymaster_send', () => signer.sendTransaction({
    to: CONFIG.paymasterAddress,
    value: requiredTopUp,
    gasLimit: CONFIG.nativeTxGasLimit > 0n ? CONFIG.nativeTxGasLimit : undefined,
  }), {
    amount: requiredTopUp,
    to: CONFIG.paymasterAddress,
  });
  persistLog('paymaster_topup_complete', { amount: requiredTopUp.toString() });
  logger.info({ amount: formatEther(requiredTopUp) }, 'Paymaster funded');
}

async function harvestStakingRewards(provider) {
  if (CONFIG.rewardMinPayout <= 0n) {
    logger.debug('Reward payout threshold disabled; skipping harvest');
    return;
  }
  const ctx = await getContext(provider);
  const { wmon, dcmon, provider: rpc, operatorAddress } = ctx;
  if (!wmon || !dcmon || !operatorAddress) {
    logger.warn('Cannot harvest rewards - missing contracts or operator address');
    return;
  }
  if (!rpc && !CONFIG.dryRun) {
    throw new Error('Provider required for reward harvesting');
  }

  const currentBalance = rpc ? await wmon.balanceOf(operatorAddress) : CONFIG.rewardPayoutTarget || CONFIG.rewardMinPayout;
  const reserve = CONFIG.rewardKeepReserve;
  const available = currentBalance > reserve ? currentBalance - reserve : 0n;
  if (available < CONFIG.rewardMinPayout) {
    logger.debug({ available: formatEther(available), threshold: formatEther(CONFIG.rewardMinPayout) }, 'Reward balance below threshold');
    return;
  }
  let payout = available;
  if (CONFIG.rewardPayoutTarget > 0n && payout > CONFIG.rewardPayoutTarget) {
    payout = CONFIG.rewardPayoutTarget;
  }

  await ensureAllowance(wmon, operatorAddress, CONFIG.dcmonToken, payout, 'reward_record_allowance');
  persistLog('reward_record_request', { amount: payout.toString() });
  await executeTx('record_rewards', () => dcmon.recordRewards(payout), { amount: payout });
  persistLog('reward_record_complete', { amount: payout.toString() });
  logger.info({ amount: formatEther(payout) }, 'Recorded staking rewards');
}

function parseQueueAmount(value) {
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value === 'bigint') return value;
  const str = String(value).trim();
  if (!str) return 0n;
  try {
    if (str.startsWith('0x')) return BigInt(str);
    if (/^\d+$/.test(str)) return BigInt(str);
    return ethers.parseEther(str);
  } catch {
    logger.warn({ value }, 'Unable to parse swap queue amount');
    return 0n;
  }
}

function normalizeAddress(address, fallback) {
  if (!address) return fallback;
  try {
    return ethers.getAddress(address);
  } catch {
    logger.warn({ address }, 'Invalid address provided; using fallback');
    return fallback;
  }
}

async function fulfillBuyin(amount, user, ctx) {
  if (amount <= 0n) throw new Error('Buy-in amount must be greater than zero');
  const { dcmon, wmon, operatorAddress } = ctx;
  if (!dcmon || !wmon) throw new Error('DCMon or WMON contract unavailable');
  const receiver = normalizeAddress(user, operatorAddress);
  const depositAmount = await prepareWmonBalance(amount, ctx, 'buyin');
  if (depositAmount <= 0n) throw new Error('Unable to source WMON for buy-in');
  await ensureAllowance(wmon, operatorAddress, CONFIG.dcmonToken, depositAmount, 'buyin_allowance');
  persistLog('buyin_request', { amount: depositAmount.toString(), receiver });
  await executeTx('buyin_deposit', () => dcmon.deposit(depositAmount, receiver), { amount: depositAmount, receiver });
  persistLog('buyin_complete', { amount: depositAmount.toString(), receiver });
  logger.info({ amount: formatEther(depositAmount), receiver }, 'Minted DCmon for buy-in');
}

async function fulfillCashout(amount, user, ctx) {
  if (amount <= 0n) throw new Error('Cashout amount must be greater than zero');
  const { signer } = ctx;
  if (!signer && !CONFIG.dryRun) throw new Error('Signer required for cashout');
  const recipient = normalizeAddress(user, null);
  if (!recipient) throw new Error('Cashout requires a valid recipient address');
  await ensureUnderlyingAvailable(amount, ctx);
  await executeTx('cashout_unwrap', () => ctx.wmon.withdraw(amount), { amount });
  await executeTx('cashout_send', () => ctx.signer.sendTransaction({
    to: recipient,
    value: amount,
    gasLimit: CONFIG.nativeTxGasLimit > 0n ? CONFIG.nativeTxGasLimit : undefined,
  }), { amount, to: recipient });
  persistLog('cashout_complete', { amount: amount.toString(), to: recipient });
  logger.info({ amount: formatEther(amount), to: recipient }, 'Cashout completed');
}

async function fulfillPoolDeposit(amount, ctx) {
  if (amount <= 0n) return;
  const { wmon, pool, operatorAddress } = ctx;
  if (!pool || !wmon) throw new Error('Pool or WMON contract unavailable');
  const depositAmount = await prepareWmonBalance(amount, ctx, 'pool_manual_deposit');
  if (depositAmount <= 0n) throw new Error('Unable to source WMON for pool deposit');
  await ensureAllowance(wmon, operatorAddress, CONFIG.poolAddress, depositAmount, 'pool_manual_allowance');
  await executeTx('pool_manual_deposit', () => pool.depositUnderlying(depositAmount), { amount: depositAmount });
  persistLog('pool_manual_deposit_complete', { amount: depositAmount.toString() });
}

async function fulfillPoolRedeem(amount, ctx) {
  if (amount <= 0n) return;
  await redeemFromPool(amount, ctx);
}

async function fulfillSeatTask(task, ctx) {
  const { provider, signer } = ctx;
  if (!provider) throw new Error('Provider required for poker seat task');
  if (!signer && !CONFIG.dryRun) throw new Error('Signer required for poker seat task');

  let tableAddress = normalizeAddress(task.table || task.address || task.tableAddress, null);
  if (!tableAddress && CONFIG.pokerTableAddress) {
    tableAddress = normalizeAddress(CONFIG.pokerTableAddress, null);
  }
  if (!tableAddress) throw new Error('Seat task requires a valid table address');

  const seatRaw = task.seat ?? task.seatId ?? task.index;
  const seatIndex = Number(seatRaw);
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 255) {
    throw new Error('Seat task requires a seat index between 0 and 255');
  }

  ctx.pokerTables = ctx.pokerTables || {};
  let poker = ctx.pokerTables[tableAddress];
  if (!poker) {
    poker = connectPokerTable(tableAddress, provider, signer);
    if (poker) ctx.pokerTables[tableAddress] = poker;
  }
  if (!poker) throw new Error('Poker table contract unavailable');

  const type = (task.type || '').toLowerCase();
  const actionField = (task.action || '').toLowerCase();
  const forceLeave = type === 'table_force_leave'
    || actionField === 'leave'
    || actionField === 'leave_during_hand'
    || actionField === 'leaveduringhand'
    || actionField === 'force'
    || task.force === 'hand'
    || task.inHand === true;

  const method = forceLeave ? 'leaveDuringHand' : 'unseat';
  const label = method === 'leaveDuringHand' ? 'poker_leave_during_hand' : 'poker_unseat';
  const overrides = {};
  if (CONFIG.pokerGasLimit > 0n) overrides.gasLimit = CONFIG.pokerGasLimit;

  await executeTx(label, () => {
    if (method === 'leaveDuringHand') return poker.leaveDuringHand(seatIndex, overrides);
    return poker.unseat(seatIndex, overrides);
  }, { table: tableAddress, seat: seatIndex, method });

  persistLog('poker_seat_task_complete', {
    table: tableAddress,
    seat: seatIndex,
    method,
    dryRun: CONFIG.dryRun,
  });
  logger.info({ table: tableAddress, seat: seatIndex, method }, 'Poker seat task executed');
}

async function processSwapQueue(provider) {
  const pending = listSwaps().filter(s => s.status === 'pending').length;
  if (!pending) return;
  const ctx = await getContext(provider);

  let swap;
  while ((swap = takeNextPending())) {
    const amount = parseQueueAmount(swap.amount);
    try {
      switch ((swap.type || '').toLowerCase()) {
        case 'paymaster':
          await ensurePaymasterBalance(provider, amount);
          break;
        case 'buyin':
          await fulfillBuyin(amount, swap.user, ctx);
          break;
        case 'cashout':
          await fulfillCashout(amount, swap.user, ctx);
          break;
        case 'pool_deposit':
          await fulfillPoolDeposit(amount, ctx);
          break;
        case 'pool_redeem':
          await fulfillPoolRedeem(amount, ctx);
          break;
        case 'table_unseat':
          await fulfillSeatTask({ ...swap, action: 'unseat' }, ctx);
          break;
        case 'table_force_leave':
          await fulfillSeatTask({ ...swap, action: 'leaveDuringHand' }, ctx);
          break;
        default:
          logger.warn({ swap }, 'Unknown swap type; marking as failed');
          throw new Error(`Unsupported swap type: ${swap.type}`);
      }
      markSwap(swap.id, 'completed', { dryRun: CONFIG.dryRun });
      persistLog('swap_completed', { id: swap.id, type: swap.type, amount: amount.toString() });
    } catch (err) {
      logger.error({ err, swap }, 'Swap processing failed');
      markSwap(swap.id, 'failed', { message: err.message });
      persistLog('swap_failed', { id: swap.id, type: swap.type, error: err.message });
    }
  }
}

async function main() {
  logger.info({ dryRun: CONFIG.dryRun, rpcUrl: CONFIG.rpcUrl ? '[redacted]' : '' }, 'Starting DCmon agent');
  const provider = getProvider();
  if (!provider && !CONFIG.dryRun) {
    logger.error('Non-dry run requires a configured RPC endpoint');
    process.exit(1);
  }

  await ensurePoolLiquidity(provider).catch(err => logger.error({ err }, 'Initial pool liquidity check failed'));
  await ensurePaymasterBalance(provider).catch(err => logger.error({ err }, 'Initial paymaster check failed'));
  await harvestStakingRewards(provider).catch(err => logger.error({ err }, 'Initial reward harvest failed'));
  await processSwapQueue(provider).catch(err => logger.error({ err }, 'Initial swap queue processing failed'));

  if (CONFIG.paymasterCheckIntervalMs > 0) {
    setInterval(() => ensurePaymasterBalance(provider).catch(err => logger.error({ err }, 'Paymaster check failed')),
      CONFIG.paymasterCheckIntervalMs);
  }
  if (CONFIG.poolCheckIntervalMs > 0) {
    setInterval(() => ensurePoolLiquidity(provider).catch(err => logger.error({ err }, 'Pool liquidity check failed')),
      CONFIG.poolCheckIntervalMs);
  }
  if (CONFIG.rewardHarvestIntervalMs > 0) {
    setInterval(() => harvestStakingRewards(provider).catch(err => logger.error({ err }, 'Reward harvest failed')),
      CONFIG.rewardHarvestIntervalMs);
  }
  if (CONFIG.swapIntervalMs > 0) {
    setInterval(() => processSwapQueue(provider).catch(err => logger.error({ err }, 'Swap queue processing failed')),
      CONFIG.swapIntervalMs);
  }
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
  ensurePoolLiquidity,
  harvestStakingRewards,
  processSwapQueue,
};



