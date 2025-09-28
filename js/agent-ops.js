// /js/agentOps.js
// Minimal on-chain actions for on-chain poker tables using ZeroDev Smart Accounts

import { ethers } from './tavern.js';
import { initSmartAccount } from './aaClient.js';
import { getAddressFor, showToast } from './config.js';

// HoldemPoker ABI must be on window (from HoldemPokerABI.js)
function getPokerAbi() {
  const abi = (window && window.HoldemPokerABI);
  if (!abi) throw new Error('HoldemPokerABI not found on window');
  return abi;
}

// Resolve HoldemPoker address from config per chain
async function getPokerAddress(provider) {
  const addr = await getAddressFor('pokerTable', provider);
  if (!addr) throw new Error('No pokerTable address for this chain');
  return addr;
}

// Low-level helper to send a contract call via ZeroDev SA
async function sendUserOpCall({ provider, to, data, value = 0 }) {
  const sa = await initSmartAccount(provider);
  const tx = {
    to,
    data,
    value: ethers.BigNumber.from(value || 0).toHexString(),
  };
  const hash = await sa.sendTransaction(tx);
  // Wait for inclusion (optional but nice for UX)
  const rcpt = await sa.waitForUserOperationTransaction(hash);
  return rcpt;
}

// Public API we’ll attach to window for table.js to use
const AgentOps = {
  /**
   * Sit in a seat (on-chain) — maps to HoldemPoker.joinSeat(uint8)
   * Only used on on-chain tables. Off-chain tables skip this and just socket.emit seat.
   */
  async sitSeat(seatIndex) {
    try {
      const provider = (window && window.ethers && window.provider) || null;
      if (!provider) throw new Error('Provider not ready');
      const pokerAddress = await getPokerAddress(provider);
      const iface = new ethers.utils.Interface(getPokerAbi());
      const data = iface.encodeFunctionData('joinSeat', [Number(seatIndex) | 0]);

      showToast('Requesting on-chain seat…', 'info');
      await sendUserOpCall({ provider, to: pokerAddress, data });
      showToast('Seated on-chain ✓', 'success');
    } catch (e) {
      console.warn('[AgentOps.sitSeat] failed', e);
      showToast('On-chain seat failed', 'error');
      throw e;
    }
  },

  /**
   * Leave a seat out of hand (on-chain) — maps to HoldemPoker.unseat(uint8)
   * If a hand is active and user wants to force-leave, you could call leaveDuringHand(uint8).
   */
  async leaveSeat(seatIndex, opts = { force: false }) {
    try {
      const provider = (window && window.ethers && window.provider) || null;
      if (!provider) throw new Error('Provider not ready');
      const pokerAddress = await getPokerAddress(provider);
      const iface = new ethers.utils.Interface(getPokerAbi());

      const fn = opts?.force ? 'leaveDuringHand' : 'unseat';
      const data = iface.encodeFunctionData(fn, [Number(seatIndex) | 0]);

      showToast('Leaving seat on-chain…', 'info');
      await sendUserOpCall({ provider, to: pokerAddress, data });
      showToast('Left seat on-chain ✓', 'success');
    } catch (e) {
      console.warn('[AgentOps.leaveSeat] failed', e);
      showToast('On-chain leave failed', 'error');
      throw e;
    }
  },

  /**
   * Post contribution (blind/call/etc.) — HoldemPoker.contribute(uint8) payable.
   * For demo we use value in wei. In your current server flow, betting is off-chain,
   * so you can use this only for on-chain demo tables (optional button).
   */
  async contribute(seatIndex, valueWei) {
    try {
      const provider = (window && window.ethers && window.provider) || null;
      if (!provider) throw new Error('Provider not ready');
      const pokerAddress = await getPokerAddress(provider);
      const iface = new ethers.utils.Interface(getPokerAbi());
      const data = iface.encodeFunctionData('contribute', [Number(seatIndex) | 0]);

      showToast('Posting contribution…', 'info');
      await sendUserOpCall({ provider, to: pokerAddress, data, value: valueWei });
      showToast('Contribution sent ✓', 'success');
    } catch (e) {
      console.warn('[AgentOps.contribute] failed', e);
      showToast('Contribution failed', 'error');
      throw e;
    }
  },
};

// Expose globally so table.js can use it without import hassles
try { window.AgentOps = AgentOps; } catch {}

export default AgentOps;
