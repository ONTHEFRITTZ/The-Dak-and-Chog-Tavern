// /js/agent-ops.js
// Sponsored on-chain ops for HoldemPoker (Monad testnet).
// F2P tables ignore this; onchain tables go via ZeroDev Smart Account.

import { initSmartAccount } from './aaClient.js';
import { getAddressFor, detectChainId, showToast } from './config.js';

function lc(x){ try { return String(x||'').toLowerCase(); } catch { return ''; } }
function mode(){
  const htmlMode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  const qpMode = (new URL(location.href)).searchParams.get('mode');
  return (qpMode ? String(qpMode).toLowerCase() : htmlMode) === 'onchain' ? 'onchain' : 'f2p';
}
function needEthers(){ if (!window.ethers) throw new Error('ethers missing'); return window.ethers; }
function iface(){
  if (!window.HoldemPokerABI) throw new Error('HoldemPokerABI missing (did you load HoldemPokerABI.js?)');
  const { ethers } = needEthers();
  return new ethers.utils.Interface(window.HoldemPokerABI);
}
async function addr(){ return getAddressFor('pokerTable', window.provider); }
async function aa(){ return initSmartAccount(window.provider); }

async function sendCall({ target, data, value = 0n, label='' }){
  await detectChainId(window.provider); // soft check
  const client = await aa();
  const res = await client.sendUserOperation({ target, data, value });
  try { showToast?.(label || 'Sent (sponsored)', 'success'); } catch {}
  return res;
}

/* ------------------------- Seat / Action ops ------------------------- */

async function joinSeat(seatId){
  if (mode()!=='onchain') return;
  const target = await addr();
  const data = iface().encodeFunctionData('joinSeat',[ seatId ]);
  return sendCall({ target, data, label:`Sit ${seatId} (sponsored)` });
}

async function leaveSeat(seatId){
  if (mode()!=='onchain') return;
  const target = await addr();
  const i = iface();
  try {
    const data = i.encodeFunctionData('unseat',[ seatId ]);
    return await sendCall({ target, data, label:`Leave seat ${seatId} (sponsored)` });
  } catch {
    const data = i.encodeFunctionData('leaveDuringHand',[ seatId ]);
    return sendCall({ target, data, label:`Leave during hand (sponsored)` });
  }
}

async function contribute(seatId, wei){
  if (mode()!=='onchain') return;
  const target = await addr();
  const data = iface().encodeFunctionData('contribute',[ seatId ]);
  return sendCall({ target, data, value:BigInt(wei), label:`Contribute ${wei} wei (sponsored)` });
}

async function beginHand(dealer, sb, bb){
  if (mode()!=='onchain') return;
  const target = await addr();
  const data = iface().encodeFunctionData('beginHand',[ dealer, sb, bb ]);
  return sendCall({ target, data, label:`Begin hand (sponsored)` });
}

async function settleHand(winners, payouts){
  if (mode()!=='onchain') return;
  const target = await addr();
  const data = iface().encodeFunctionData('settleHand',[ winners, payouts ]);
  return sendCall({ target, data, label:`Settle hand (sponsored)` });
}

/* ------------------------- Expose globally ------------------------- */

try {
  window.AgentOps = window.AgentOps || {};
  window.AgentOps.joinSeat = joinSeat;
  window.AgentOps.sitSeat = joinSeat;      // alias
  window.AgentOps.leaveSeat = leaveSeat;
  window.AgentOps.unseatSeat = leaveSeat;  // alias
  window.AgentOps.contribute = contribute;
  window.AgentOps.beginHand = beginHand;
  window.AgentOps.settleHand = settleHand;
} catch {}
