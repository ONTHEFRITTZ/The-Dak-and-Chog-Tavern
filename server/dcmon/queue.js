const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./config');
const { persistLog } = require('./logger');

function readQueue() {
  const raw = fs.readFileSync(CONFIG.swapQueueFile, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.swaps)) return { swaps: [] };
    return parsed;
  } catch (err) {
    persistLog('queue_parse_error', { err: err.message, raw });
    return { swaps: [] };
  }
}

function writeQueue(data) {
  fs.writeFileSync(CONFIG.swapQueueFile, JSON.stringify(data, null, 2));
}

function listSwaps() {
  return readQueue().swaps;
}

function enqueueSwap(swap) {
  const queue = readQueue();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...swap,
    status: 'pending',
  };
  queue.swaps.push(entry);
  writeQueue(queue);
  persistLog('swap_enqueued', entry);
  return entry.id;
}

function markSwap(id, status, meta = {}) {
  const queue = readQueue();
  const target = queue.swaps.find(s => s.id === id);
  if (!target) return false;
  target.status = status;
  target.updatedAt = new Date().toISOString();
  target.meta = { ...(target.meta || {}), ...meta };
  writeQueue(queue);
  persistLog('swap_updated', { id, status, meta });
  return true;
}

function takeNextPending() {
  const queue = readQueue();
  const idx = queue.swaps.findIndex(s => s.status === 'pending');
  if (idx === -1) return null;
  const swap = queue.swaps[idx];
  swap.status = 'processing';
  swap.updatedAt = new Date().toISOString();
  writeQueue(queue);
  persistLog('swap_processing', { id: swap.id });
  return swap;
}

module.exports = {
  listSwaps,
  enqueueSwap,
  markSwap,
  takeNextPending,
};
