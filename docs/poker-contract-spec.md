# Texas Hold'em Poker — Draft On-Chain Spec (v1.2)

Scope: table-oriented cash game with custody via a shared bankroll pool. This draft targets early planning; it favors simplicity and predictable UX, and can evolve towards stronger trust-minimization (VRF, commit–reveal) later.

Goals
- Custody: pool-based escrow for table balances (deposit/withdraw on demand).
- Rake: protocol fee skim in basis points on each pot.
- Integrity: verifiable hand boundaries and payouts; off-chain sequencing allowed initially.
- Upgradability: versioned tables managed by a factory; optional pause/owner controls.

Design Overview
- BankrollPool: holds player funds and exposes `transferFromPool(addr, to, amount)` and `creditToPool(addr, amount)` used by games. Existing `BankrollPool.sol` can be reused.
- PokerTable (per table): maintains per-player balances, blinds, rake bps, and emits events that mirror the hand lifecycle.
- PokerFactory: deploys tables with shared config + references to the pool.

Trust Model (Phase 1)
- Off-chain game engine sequences actions and computes outcomes; contract enforces settlements only when submitted by a privileged dealer role and bounded by emitted events.
- Dealer submits a compact settlement for the hand (winners + pot and rake). In future phases, randomness and hand verification can be added (commit–reveal, VRF, or zk-eval of best hand).

Key Data Structures
- Table params: `smallBlind`, `bigBlind`, `rakeBps`, `maxSeats`, `pool`.
- Player state: `balance` (in-pool allocated to table), `seated` flag.
- Session state: `handId` (monotonic), `inHand` flag.

Lifecycle
1) Seat funding
   - Player calls `seat(tableId, amount)`; contract pulls `amount` from `BankrollPool` (internal transfer) into the table ledger.
   - Emits `Seat(addr, seatId, amount)`.
2) Unseat/withdraw
   - Player calls `unseat(seatId)` or `withdraw(amount)`; contract reduces table ledger and credits back to `BankrollPool`.
3) Start hand
   - Off-chain engine declares start via `beginHand(handId, participants, dealerSeat, sbSeat, bbSeat)`; marks `inHand=true`.
   - Blinds are reserved from seat balances on-chain: `smallBlind` and `bigBlind` moved to an internal hand pot.
   - Emits `HandStarted(handId, dealerSeat, sbSeat, bbSeat)`.
4) Betting rounds
   - Phase 1: betting is tracked off-chain; no per-action on-chain calls to limit gas. The engine will ultimately submit a settlement.
   - Future option: record per-round deltas via `contribute(handId, seatId, amount)` validated against seat balances.
5) Showdown + settlement
   - Dealer calls `settleHand(handId, winners[], payouts[], rakeOverride?)`.
   - Contract validates: `inHand==true`, `handId` match, sum(payouts)+rake == pot, winners unique, balances sufficient.
   - Applies rake to pot using `rakeBps` unless an explicit `rakeOverride` is used by admin.
   - Credits payouts to each winner’s table balance.
   - Emits `HandSettled(handId, winners, payouts, rake)` and sets `inHand=false`.

Events
- `Seat(address indexed player, uint8 seatId, uint256 added)`
- `Unseat(address indexed player, uint8 seatId, uint256 returned)`
- `HandStarted(uint256 indexed handId, uint8 dealer, uint8 sb, uint8 bb)`
- `HandSettled(uint256 indexed handId, address[] winners, uint256[] payouts, uint256 rake)`
- `RakeUpdated(uint16 bps)`
- `Paused(bool)`

Errors / Guards
- Reentrancy protection on settle/seat/withdraw.
- Only dealer role (or table owner) can `beginHand/settleHand`.
- Rate-limit: `settleHand` must reference the current `handId` and `inHand`.
- Bounds: `rakeBps <= 1000` (<=10%).

API Sketch (Solidity)
```
contract PokerFactory {
  event TableCreated(address table, address pool, uint16 rakeBps, uint256 sb, uint256 bb);
  function createTable(address pool, uint16 rakeBps, uint256 sb, uint256 bb) external returns (address);
}

contract PokerTable is ReentrancyGuard, Ownable {
  struct Seat { address player; uint256 balance; }
  BankrollPool public immutable pool;
  uint8 public constant MAX_SEATS = 6;
  uint16 public rakeBps; // 1 bps = 0.01%
  uint256 public smallBlind;
  uint256 public bigBlind;
  uint256 public handId;
  bool public inHand;
  mapping(uint8 => Seat) public seats;

  function seat(uint8 seatId, uint256 amount) external nonReentrant;
  function unseat(uint8 seatId) external nonReentrant;
  function withdraw(uint8 seatId, uint256 amount) external nonReentrant;
  function beginHand(uint256 nextHandId, uint8 dealer, uint8 sb, uint8 bb) external onlyOwner;
  function settleHand(uint256 handId_, address[] calldata winners, uint256[] calldata payouts, uint256 rakeOverride) external onlyOwner nonReentrant;
  function setRake(uint16 bps) external onlyOwner;
  function pause(bool p) external onlyOwner;
}
```

Rake Handling
- Compute `rake = min(rakeCap, (pot * rakeBps) / 10000)`. Cap optional; store fees in contract or forward to a treasury.

Randomness / Fairness (Roadmap)
- Phase 2: Dealer publishes commitment to deck order `H(deckSeed)` at `beginHand`. Reveal `deckSeed` at `settleHand` and include a verifier that reconstructs deals → enforces winners.
- Alternative: Chainlink VRF used to derive deck seed per hand; still requires off-chain best-hand evaluation unless a heavy on-chain solver is used.

Gas & UX Notes
- Keep per-hand on-chain interactions bounded to `beginHand` and `settleHand` in Phase 1.
- Players deposit once and play many hands; they can withdraw between hands.

Security Considerations
- Ensure seat balances cannot go negative; reject settlement if payouts exceed available pot.
- Double-settlement guards via `handId` and `inHand` checks.
- Admin operations gated and ideally behind a multisig in production.

Interop With Existing Contracts
- Reuse `BankrollPool.sol` for custody. The table only mutates internal balances and performs credit/debit to the pool.
- Fees can be aggregated similarly to Faro.

Open Questions
- Whether to enforce per-round contributions on-chain (more gas) vs trusting dealer to settle fairly.
- Anti-collusion/AML controls (likely off-chain policy + allowlist in `Whitelist.sol`).

Testing Plan (Outline)
- Unit tests for seat/unseat/withdraw accounting.
- Hand lifecycle: `beginHand` → `settleHand` happy-path with 1 or more winners.
- Rake math incl. caps.
- Reverts for invalid/duplicate `handId`, over-payouts, and paused state.

