#!/usr/bin/env node

const readline = require('readline');
const { ethers } = require('ethers');
const { enqueueSwap } = require('../dcmon-agent');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function parseAmount(input) {
  if (!input) return '0';
  const trimmed = input.trim();
  if (!trimmed) return '0';
  try {
    if (trimmed.startsWith('0x')) return BigInt(trimmed).toString();
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed).toString();
    return ethers.parseEther(trimmed).toString();
  } catch (err) {
    console.error(`Unable to parse amount "${input}": ${err.message}`);
    return '0';
  }
}

(async () => {
  try {
    const type = (await prompt('Swap type (paymaster/buyin/cashout/pool_deposit/pool_redeem): ')).trim() || 'buyin';
    const user = (await prompt('User address (optional): ')).trim();
    const amountInput = (await prompt('Amount (wei or decimal MON): ')).trim();
    const note = (await prompt('Note (optional): ')).trim();

    const amount = parseAmount(amountInput);
    const id = enqueueSwap({ type, user, amount, note });
    console.log(`Swap queued with id ${id}`);
  } catch (err) {
    console.error('Failed to enqueue swap', err);
    process.exit(1);
  }
})();
