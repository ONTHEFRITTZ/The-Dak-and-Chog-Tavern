// /js/agent-ops.js
// Smart Account table actions for HoldemPoker on Monad testnet
// - Uses ZeroDev AA client (aaClient.js)
// - Pulls pokerTable address from config.js
// - Encodes calls with HoldemPokerABI (already loaded via <script> in table.html)

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import { initSmartAccount, getSmartAccount } from "./aaClient.js";
import { getAddressFor, detectChainId, showToast } from "./config.js";

// ---- Internal state ---------------------------------------------------------
let _ethProvider;        // EIP-1193 injected provider (MetaMask)
let _ethersProvider;     // ethers Web3Provider
let _chainId;            // number (10143 on Monad testnet)
let _pokerAddr;          // address of HoldemPoker table
let _iface;              // ethers Interface for HoldemPoker
let _ready = false;

// Gentle guards
function req(v, msg) { if (!v) throw new Error(msg); return v; }
function toHex(v) { return ethers.BigNumber.from(v).toHexString(); }

// Fire-and-forget UI events (optional listeners: budget panel, sponsor badge)
function emit(name, detail) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
}

// ---- Bootstrap / discovery ---------------------------------------------------
async function ensureInit() {
  if (_ready) return true;

  // 1) Injected provider (MetaMask); tavern.js seeds window.__walletProvider
  _ethProvider = (window && (window.__walletProvider || window.ethereum)) || null;
  req(_ethProvider && typeof _ethProvider.request === "function", "Wallet provider not found");

  // 2) ethers provider (for chain id detection & address book)
  _ethersProvider = new ethers.providers.Web3Provider(_ethProvider, "any");

  // 3) chain id + poker table address
  _chainId = await detectChainId(_ethersProvider);
  req(_chainId, "Unable to detect chain id");

  _pokerAddr = await getAddressFor("pokerTable", _ethersProvider);
  req(_pokerAddr, "Poker table address not configured for this network");

  // 4) ABI interface (loaded by table.html: ../../js/HoldemPokerABI.js)
  const abi = req(
    (window && (window.HoldemPokerABI || window.HoldempokerABI)) || null,
    "HoldemPokerABI not found on window"
  );
  _iface = new ethers.utils.Interface(abi);

  // 5) ZeroDev Smart Account
  await initSmartAccount(_ethProvider);
  req(getSmartAccount(), "Smart account client not initialized");

  _ready = true;
  return true;
}

// ---- Core executor -----------------------------------------------------------
async function sendUserOp({ target, data, value = "0x0", label = "Action" }) {
  await ensureInit();
  const client = getSmartAccount();

  // Optional: notify a “pending budget” line item (we’ll overwrite after confirmation)
  emit("aa:budget:pending", { label });

  // (Optional) Best-effort gas estimation for budget UI
  try {
    // Not all bundlers expose estimateUserOperationGas in the SDK client;
    // if available, use it — otherwise skip.
    if (typeof client.estimateUserOperationGas === "function") {
      const est = await client.estimateUserOperationGas({
        target,
        data,
        value,
      });
      // est can include callGasLimit/preVerificationGas/verificationGasLimit
      emit("aa:budget:estimate", { label, estimate: est });
    }
  } catch {
    // non-fatal
  }

  // Actually send the user operation
  const op = await client.sendUserOperation({ target, data, value });

  // For UI: mark as sponsored + update budget on confirmed
  emit("aa:sponsored", { label, opHash: op.hash });
  showToast("Move sent — sponsored by The Dak & Chog Tavern", "success", 2000);

  // Wait for inclusion (optional: you can remove this if you prefer socket-driven confirms)
  try {
    const receipt = await op.wait();
    emit("aa:budget:finalize", { label, receipt });
    return receipt;
  } catch (err) {
    emit("aa:budget:finalize", { label, error: String(err && err.message || err) });
    throw err;
  }
}

// ---- Helpers -----------------------------------------------------------------
function toWei(amountEth) {
  return ethers.utils.parseEther(String(amountEth)).toString();
}
function asHexWei(v) {
  return toHex(ethers.BigNumber.from(String(v || 0)));
}

// ---- Contract call wrappers (HoldemPoker.sol) --------------------------------
// Note: All functions encode calldata for your deployed table, then send via AA.
// These include every action you may need; call from table.js as window.AgentOps.X

async function joinSeat(seatId) {
  const data = _iface.encodeFunctionData("joinSeat", [Number(seatId)]);
  return sendUserOp({ target: _pokerAddr, data, value: "0x0", label: `Join seat #${seatId}` });
}

async function leaveSeat(seatId) {
  const data = _iface.encodeFunctionData("unseat", [Number(seatId)]);
  return sendUserOp({ target: _pokerAddr, data, value: "0x0", label: `Leave seat #${seatId}` });
}

async function leaveDuringHand(seatId) {
  const data = _iface.encodeFunctionData("leaveDuringHand", [Number(seatId)]);
  return sendUserOp({ target: _pokerAddr, data, value: "0x0", label: `Leave during hand (seat #${seatId})` });
}

// Orchestrator flow (permissionless in your contract). If your server drives this,
// you can keep these for admin/local tables or solo dev tables.
async function beginHand(dealerSeat, sbSeat, bbSeat) {
  const data = _iface.encodeFunctionData("beginHand", [
    Number(dealerSeat), Number(sbSeat), Number(bbSeat)
  ]);
  return sendUserOp({ target: _pokerAddr, data, value: "0x0", label: "Begin hand" });
}

async function contribute(seatId, amountWei) {
  // Payable: value carries the contribution into the pot
  const data = _iface.encodeFunctionData("contribute", [Number(seatId)]);
  const value = asHexWei(amountWei);
  return sendUserOp({ target: _pokerAddr, data, value, label: `Contribute (seat #${seatId})` });
}

async function postBlind(seatId, kind /* 'sb' | 'bb' */, amountWei) {
  const label = kind === "bb" ? "Post big blind" : "Post small blind";
  const data = _iface.encodeFunctionData("contribute", [Number(seatId)]);
  const value = asHexWei(amountWei);
  return sendUserOp({ target: _pokerAddr, data, value, label: `${label} (seat #${seatId})` });
}

async function settleHand(winners, payoutWeiArray) {
  // winners: array of addresses
  // payoutWeiArray: array of string/BN wei amounts (must sum <= pot minus rake)
  const data = _iface.encodeFunctionData("settleHand", [winners, payoutWeiArray.map(w => ethers.BigNumber.from(String(w)).toString())]);
  return sendUserOp({ target: _pokerAddr, data, value: "0x0", label: "Settle hand" });
}

// ---- Public API ---------------------------------------------------------------
async function init() {
  await ensureInit();
  return true;
}

export const AgentOps = {
  // lifecycle
  init,

  // table actions
  joinSeat,
  leaveSeat,
  leaveDuringHand,
  beginHand,
  contribute,
  postBlind,
  settleHand,

  // utils
  toWei,
};

// Expose globally for table.js (non-module consumers)
try { window.AgentOps = AgentOps; } catch {}
export default AgentOps;
