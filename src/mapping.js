// Basic event handlers for HyperIndex
// Each handler produces a simple Activity row for the dashboard

function makeId(log) {
  return `${log.transactionHash}-${log.logIndex}`;
}

export function handleSeatTaken(event, ctx) {
  const { player, seat, amount } = event.params;
  const id = makeId(event);
  ctx.Activity.set(id, {
    id,
    event: 'SeatTaken',
    player: String(player),
    seat: Number(seat),
    amount: String(amount),
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    blockTimestamp: Number(event.blockTimestamp || 0)
  });
}

export function handleSeatLeft(event, ctx) {
  const { player, seat, returnedAmount } = event.params;
  const id = makeId(event);
  ctx.Activity.set(id, {
    id,
    event: 'SeatLeft',
    player: String(player),
    seat: Number(seat),
    amount: String(returnedAmount),
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    blockTimestamp: Number(event.blockTimestamp || 0)
  });
}

export function handleJoined(event, ctx) {
  const { player, seat } = event.params;
  const id = makeId(event);
  ctx.Activity.set(id, {
    id,
    event: 'Joined',
    player: String(player),
    seat: Number(seat),
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    blockTimestamp: Number(event.blockTimestamp || 0)
  });
}

export function handleLeftDuringHand(event, ctx) {
  const { player, seat } = event.params;
  const id = makeId(event);
  ctx.Activity.set(id, {
    id,
    event: 'LeftDuringHand',
    player: String(player),
    seat: Number(seat),
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    blockTimestamp: Number(event.blockTimestamp || 0)
  });
}

export function handleHandStarted(event, ctx) {
  const { handId, dealer, sb, bb } = event.params;
  const id = makeId(event);
  ctx.Activity.set(id, {
    id,
    event: 'HandStarted',
    handId: String(handId),
    amount: JSON.stringify({ dealer: Number(dealer), sb: Number(sb), bb: Number(bb) }),
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    blockTimestamp: Number(event.blockTimestamp || 0)
  });
}

export function handleContributed(event, ctx) {
  const { handId, seat, amount } = event.params;
  const id = makeId(event);
  ctx.Activity.set(id, {
    id,
    event: 'Contributed',
    handId: String(handId),
    seat: Number(seat),
    amount: String(amount),
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    blockTimestamp: Number(event.blockTimestamp || 0)
  });
}

export function handleHandSettled(event, ctx) {
  const { handId, winners, payouts, rake } = event.params;
  const id = makeId(event);
  ctx.Activity.set(id, {
    id,
    event: 'HandSettled',
    handId: String(handId),
    winners: (winners || []).map(String),
    payouts: (payouts || []).map(String),
    rake: String(rake),
    txHash: event.transactionHash,
    blockNumber: Number(event.blockNumber),
    blockTimestamp: Number(event.blockTimestamp || 0)
  });
}

