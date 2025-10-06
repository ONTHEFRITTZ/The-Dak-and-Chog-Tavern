// server/dealeronchain.js
// Lightweight on-chain hooks for poker hands. Uses an EOA signer if one is
// configured; otherwise it will no-op while still logging intent so gameplay
// continues off-chain.

let ethers = null;
try {
  ({ ethers } = require('ethers'));
} catch (err) {
  console.warn('[dealeronchain] ethers package not installed; on-chain hooks disabled');
}

const RPC_URL = process.env.MONAD_BUNDLER_RPC || process.env.MONAD_RPC ||
  'https://rpc.zerodev.app/api/v3/9b503699-15b1-48c4-a4e7-35d41afd0ee3/chain/10143?selfFunded=true';
const HOLDEN_POKER_ADDR = process.env.HOLDEM_POKER_ADDR ||
  '0x3352060b4fBcAC18499390643703957E28e128fd';
const DEALER_PK = process.env.POKER_DEALER_PK || process.env.DEALER_PRIVATE_KEY || null;

const provider = ethers ? new ethers.JsonRpcProvider(RPC_URL) : null;
let signer = null;

const HoldemPokerABI = [
  'function beginHand(uint8 dealer, uint8 sb, uint8 bb) external',
  'function settleHand(address[] winners, uint256[] payouts) external',
];

async function getSigner() {
  if (signer) return signer;
  if (!ethers || !provider) {
    return null;
  }
  if (!DEALER_PK) {
    console.warn('[dealeronchain] Missing POKER_DEALER_PK - on-chain hooks will be skipped.');
    return null;
  }
  try {
    const key = DEALER_PK.startsWith('0x') ? DEALER_PK : `0x${DEALER_PK}`;
    signer = new ethers.Wallet(key, provider);
    return signer;
  } catch (err) {
    console.error('[dealeronchain] Failed to initialise signer', err);
    signer = null;
    return null;
  }
}

function seatIdSafe(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function onBeginHand(tableId, tableState) {
  try {
    const s = await getSigner();
    if (!s) return;
    const poker = tableState?.poker;
    if (!poker) return;

    const dealerSeat = seatIdSafe(poker.dealerSeatId);
    const sbSeat = seatIdSafe(poker.actors?.[poker.sbIndex]?.seatId, (dealerSeat + 1) % 8);
    const bbSeat = seatIdSafe(poker.actors?.[poker.bbIndex]?.seatId, (dealerSeat + 2) % 8);

    if (!ethers) return;
    const contract = new ethers.Contract(HOLDEN_POKER_ADDR, HoldemPokerABI, s);
    const tx = await contract.beginHand(dealerSeat, sbSeat, bbSeat);
    console.log(`[ONCHAIN][${tableId}] beginHand → ${tx.hash}`);
  } catch (err) {
    console.error('[dealeronchain] onBeginHand failed', err);
  }
}

async function onSettleHand(tableId, tableState, winners, board) {
  try {
    const s = await getSigner();
    if (!s) return;
    if (!Array.isArray(winners) || winners.length === 0) return;

    if (!ethers) return;
    const contract = new ethers.Contract(HOLDEN_POKER_ADDR, HoldemPokerABI, s);
    const addrs = winners.map(w => w && w.addr ? w.addr : (ethers?.constants?.AddressZero || '0x0000000000000000000000000000000000000000'));
    const payouts = winners.map(w => ethers.BigNumber.from(String(w?.amount || 0)));
    const tx = await contract.settleHand(addrs, payouts);
    console.log(`[ONCHAIN][${tableId}] settleHand → ${tx.hash} | board=${Array.isArray(board)?board.join(','):''}`);
  } catch (err) {
    console.error('[dealeronchain] onSettleHand failed', err);
  }
}

function dealerSignerConfigured() {
  return !!DEALER_PK;
}

module.exports = { onBeginHand, onSettleHand, dealerSignerConfigured };
