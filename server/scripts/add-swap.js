#!/usr/bin/env node

const readline = require('readline');
const { enqueueSwap } = require('../dcmon-agent');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

(async () => {
  try {
    const type = (await prompt('Swap type (buyin/cashout/paymaster): ')).trim() || 'buyin';
    const user = (await prompt('User address (optional): ')).trim();
    const amount = (await prompt('Amount in wei (string): ')).trim();
    const note = (await prompt('Note (optional): ')).trim();

    const id = enqueueSwap({ type, user, amount, note });
    console.log(`Swap queued with id ${id}`);
  } catch (err) {
    console.error('Failed to enqueue swap', err);
    process.exit(1);
  }
})();
