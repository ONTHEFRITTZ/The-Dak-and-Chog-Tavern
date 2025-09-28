// server/dealerOnchain.js
const { ethers } = require("ethers");
const { initSmartAccount } = require("../public/js/aaClient.js"); // adjust path if needed

// Minimal ABI for HoldemPoker
const HoldemPokerABI = [
  "function beginHand(uint8 dealer, uint8 sb, uint8 bb) external",
  "function settleHand(address[] winners, uint256[] payouts) external",
];

const POKER_ADDR = "0x3352060b4fBcAC18499390643703957E28e128fd"; // your deployed HoldemPoker

async function onBeginHand(provider, tableId, dealer, sb, bb) {
  try {
    const sa = await initSmartAccount(provider);
    const contract = new ethers.Contract(POKER_ADDR, HoldemPokerABI, sa);
    const tx = await contract.beginHand(dealer, sb, bb);
    console.log(`[ONCHAIN][${tableId}] beginHand → ${tx.hash}`);
  } catch (err) {
    console.error("onBeginHand failed", err);
  }
}

async function onSettleHand(provider, tableId, winners, payouts) {
  try {
    const sa = await initSmartAccount(provider);
    const contract = new ethers.Contract(POKER_ADDR, HoldemPokerABI, sa);
    const tx = await contract.settleHand(winners, payouts);
    console.log(`[ONCHAIN][${tableId}] settleHand → ${tx.hash}`);
  } catch (err) {
    console.error("onSettleHand failed", err);
  }
}

module.exports = { onBeginHand, onSettleHand };
