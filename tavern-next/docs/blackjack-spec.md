# Blackjack Product Spec

_Last updated: {{DATE}}_

## Overview

Studio-quality single-seat Blackjack experience that mirrors the Tavern brand. The game must support wagered play in DCMon with AA-sponsored transactions (Alchemy paymaster) and share the unified bankroll UX that Poker/Hazard already use.

The initial hackathon scope targets **single-player vs. dealer** with optional future expansion to multi-seat tables. The feature ships fully inside the Next.js app – no legacy scripts or DOM overlays.

## Core Loop

1. **Betting**
   - Player selects base wager from preset chip values (`0.1`, `0.5`, `1`, `5` DCMon) or enters a custom amount.
   - UI displays current DCMon balance (from `useBankroll` store).
   - Bet validation:
     - `wager >= tableMin` (`0.1` DCMon by default).
     - `wager <= tableMax` (`10` DCMon default, configurable per table).
     - `wager <= availableBalance`.
   - Upon "Deal", the app ensures allowance + bankroll sync, then calls the Blackjack contract with AA sponsorship. Until the contract exists, provide a "Simulate locally" developer flag to unblock UI iteration.

2. **Initial Deal**
   - Dealer and player receive two cards (player second card face-up).
   - Soft/hard totals computed server-side (or in the module for simulated mode).
   - Detect immediate Blackjack (ten-value + Ace) for player or dealer.

3. **Player Actions**
   - Available actions: `Hit`, `Stand`, `Double`, `Split` (split unlocked when the first two cards match rank AND bankroll >= additional wager).
   - Action buttons surface only while the hand is active.
   - Double rules: allow only on first choice (after initial cards or first split hand). Wager doubled and exactly one card drawn.
   - Splits:
     - Maximum of 3 hands (2 splits).
     - Splitting Aces: one card each, auto-stand unless local rule config allows otherwise.
     - Each split hand displays its own wager and running total.
   - Insurance (optional toggle): If dealer shows Ace, prompt for insurance before player acts. Insurance cost = 0.5x wager; resolves immediately after dealer peek.

4. **Dealer Play**
   - Standard Vegas rules: dealer hits soft 16, stands on soft 17. Configurable in module to allow future "Hit soft 17" variant.
   - Dealer reveals hole card once player stands / busts.

5. **Resolution**
   - Compare totals, handle payouts, push, or bust logic.
   - Payout ratios:
     - Blackjack: 3:2 (configurable; fallback 1.5).
     - Insurance win: 2:1.
     - Standard win: 1:1.
     - Double wins pay 2x wager (plus original stake).
   - Update bankroll store with delta returned from contract (or simulated result in local mode).
   - Persist hand history (limited to last 10 rounds) for UX context.

6. **Hand Reset**
   - Show results, animate chips, enable "New Hand" button.
   - Automatically advance after 6 seconds unless player interacts.

## Technical Architecture

### Modules

- `src/modules/blackjack/engine.ts`
  - Pure functions for deck composition, shuffling (Fisher–Yates), hand totals, move validation, payouts.
  - Exported helpers:
    - `createDeck(seed?: string)` – deterministic for reproducible tests.
    - `dealInitialHands(deck)` → `{ deck, playerHands, dealerHand }`.
    - `applyAction(state, action)` – returns next state, errors for illegal inputs.
    - `scoreHand(hand)` – returns `{ hard, soft, bestTotal, isBlackjack, isBust }`.

- `src/modules/blackjack/state.ts`
  - `BlackjackState` interface covering:
    - `phase`: `"betting" | "dealing" | "player" | "dealer" | "payout" | "complete"`.
    - `activeHandIndex`, `hands[]`, `dealer`, `wager`, `sideBets`.
    - `message`, `history[]`, `pendingTransaction` metadata.
  - `blackjackReducer` + action creators for UI dispatch.
  - Guards to keep reducer pure (no async). Side-effects handled in hook.

- `src/modules/blackjack/useBlackjack.ts`
  - React hook orchestrating the reducer + async ops.
  - Responsibilities:
    - Bridge to `useBankroll` for balances, allowances, post-hand refresh.
    - Bridge to `useDelegationToolkitAA` for contract calls (when available).
    - Provide `playHand({ wager, simulate?: boolean })`, `hit()`, `stand()`, `double()`, `split()`, `insurance()`, `nextHand()`.
    - Accept a `mode` prop: `"onchain"` (default) or `"simulated"` for development.
  - Error surface via `state.errors` with friendly messages for the toast system.

### Contract Integration (Future-proofing)

- Add `"blackjack"` entry to `CONTRACTS` and remote config once address is deployed.
- Expected on-chain interface (`playHand(uint256 wager, uint8 action, bytes extra)` ), returning event payload with final hands + payouts.
- AA flow: `useDelegationToolkitAA().sendTransaction({ to: CONTRACTS.blackjack, data, value: 0n })`.
- Support fallback signer if paymaster disabled (same pattern as poker/hazard).

### UI Composition

- `src/app/games/blackjack/page.tsx`
  - Replace placeholder with full layout.
  - Sections:
    - Hero header w/ wallet pill, table limits, total wager summary.
    - Table canvas containing dealer area (cards + chip tray), player lanes for each active hand, chip controls.
    - Action rail (buttons) pinned bottom center; show legal actions only.
    - Sidebar: history feed, rule summary, bankroll status (tie into global widget once implemented).
  - Animations:
    - CSS transitions for card deal (translate/opacity).
    - Chip movement (CSS keyframes) triggered by reducer state.
  - Accessibility:
    - Buttons have descriptive `aria-label` (e.g., "Hit hand 2 (total 15)").
    - Use live region to announce results and busts.

### Styling

- Extend `globals.css` with `.blackjack-table`, `.hand`, `.card`, `.chip-button`, `.action-rail`, `.bet-input` classes.
- Reuse palette from poker tokens (greens/golds). Provide dark gradient background to match Tavern aesthetic.
- Responsive layout:
  - Desktop: horizontal table + right sidebar.
  - Tablet: stack sidebar below table, shrink cards to maintain aspect ratio.
  - Mobile portrait: single column, action rail sticky bottom.

### Persistence & Analytics

- Local storage keys:
  - `blackjack:lastWager`, `blackjack:lastMode`, `blackjack:history` (optional). Use `try/catch` guards.
  - Reset history older than 24 hours.
- Emit custom events (`window.dispatchEvent(new CustomEvent("blackjack:hand"))`) for optional analytics hook.

## Roadmap

1. Implement engine + reducer with Jest unit tests (deck integrity, scoring edge cases).
2. Build `useBlackjack` hook with simulated mode first (no on-chain dependency).
3. Replace page UI with full table + actions (wired to simulated mode).
4. Integrate bankroll + AA transaction submission once contract ABI available.
5. QA checklist:
   - Blackjack pay 3:2, push behaviour, split/double rules, insurance resolution.
   - Balance updates propagate to wallet pill & future HUD.
   - Responsive layout verified (desktop, tablet, mobile).
   - Error states (insufficient balance, rejected transaction) surface clearly.

## Open Questions

- Finalize contract API (wager flow, RNG oracle, payouts). Coordinate with smart contract team.
- Table limits: fixed or dynamic per lobby entry? If dynamic, expose via API and surface in header.
- Dealer shoe size: single deck (res shuffled each hand) vs multi-deck. For hackathon, single deck is acceptable; multi-deck support requires shoe state persisted on-chain or server-driven.
- Future features: side bets (Perfect Pairs, 21+3), multiplayer tables, leaderboards.

---

The spec above should unblock UI engineering immediately. Engine + hook work can proceed in parallel while contract ABI finalizes. Update this doc as decisions land to keep the implementation aligned.
