# Next.js Migration & Smart Account TODO

> Reference checklist for completing the Tavern rebuild on the `nextjs-migration` branch ahead of the [MetaMask Smart Accounts × Monad Dev Cook-Off](https://www.hackquest.io/hackathons/MetaMask-Smart-Accounts-x-Monad-Dev-Cook-Off).

> **Priority order (Hackathon scope)**  
> 1. Alchemy Smart Account SDK integration (paymaster + bundler)  
> 2. MetaMask Delegation Toolkit / Poker AA polish  
> 3. Game ports & bankroll HUD parity  
> 4. UI polish / navigation / responsive tweaks  
> 5. Post-hackathon items (Agent, DCMon staking, Blackjack, mobile, Phantom, Alchemy Smart Wallet extras)

## 1. Smart Account Integration (Top Priority)

- [x] **Alchemy SDK adoption**  
  - [x] Swap `/js/aaClient.js` to use the Alchemy AA SDK for user ops, paymaster quoting, and bundler submissions (drop ZeroDev/legacy helpers).  
  - [x] Ensure config flows from env (`NEXT_PUBLIC_ALCHEMY_API_KEY`, `NEXT_PUBLIC_ALCHEMY_PAYMASTER_RPC`, etc.) and matches `/api/paymaster/sign`.  
  - [x] Remove remaining `window.AA_PAYMASTER_CONTEXT` and other legacy globals.

- [x] **MetaMask Delegation Toolkit alignment**  
  - [x] Verify poker AA flows use the Alchemy-backed client while preserving toolkit session UX.  
  - [x] Confirm fallback signer paths still function when sponsorship disabled.

## 2. Game Ports

- [ ] **Poker (lobby + table)**  
  - [x] React lobby + table routes with `useRealtimePokerLobby` / `useRealtimePokerTable`, shared bankroll + Delegation Toolkit AA flow.  
  - [x] Preserve table animations, dealer admin tools, and the legacy overlay polish.

- [x] **Dak & Chog Coin Flip** – React port completed (`/games/dakchog`). *(Verify against production during QA.)*

- [x] **Shell Game** – React port completed (`/games/shell`). *(Pending bankroll hook integration – see Section 2.)*

- [x] **Hazard** – React port completed (`/games/hazard`). *(Pending bankroll hook integration – see Section 2.)*

- [ ] **Blackjack (new)**  
  - [x] Design gameplay spec (DCMon wager, bankroll integration, 4337 route).  
  - [x] Implement table UI, state machine, betting + payouts.  
  - [x] Connect to bankroll/paymaster pipelines.

- [ ] **Remove Faro**  
  - Delete legacy Faro assets/routes once Blackjack is live.  
  - Ensure no references to `/games/faro` remain in sidebar, env, or configs.

## 2. Shared Runtime & Bankroll

- [ ] **Finalise `useBankroll` hook**  
  - [x] Approvals now route through `/api/paymaster/sign` with AA fallback to the connected signer.  
  - [ ] Expose reactive state to a global bankroll widget (for wallet pill + future HUD).

- [x] **Create AA execution hook**  
  - Wrap `/js/aaClient.js` functionality in a typed hook (`useDelegationToolkitAA`) that:  
    - Ensures toolkit context, bundler client (`paymaster: true`), and session state.  
    - Provides helpers for `sendUserOperation`, `waitForUserOperationReceipt`, and fallback EOA send.  
    - Emits events mirrored from legacy (`aa:sponsored`, `aa:session`, etc.).
  - _Follow-up:_ expose emitted events + status channel from the legacy client for HUD components.

- [x] **Socket / realtime hooks**  
  - Abstract the Socket.IO lobby/table logic into `useRealtimeLobby` & `useRealtimePokerTable`.  
  - Ensure reconnection handling and typed events.

## 3. Paymaster & AA Infrastructure

- [x] **API route for Verifying Paymaster signatures** (`/api/paymaster/sign`).  
  - Confirm env keys in Vercel/Server: `VERIFYING_PAYMASTER_SIGNER_PK`, `MONAD_RPC_URL`, etc.

- [x] **Frontend adoption of new paymaster endpoint**  
  - [x] `useBankroll` and Holdem buy-in flows now request signatures from `/api/paymaster/sign`.  
  - [x] Update Dak & Chog / Shell action flows to drop legacy AA helpers and rely on the shared hook.  
  - [x] Remove remaining references to `window.AA_PAYMASTER_CONTEXT`.

- [ ] **Alchemy smart-account runtime**  
  - Replace ad-hoc client calls with `@alchemy/aa-alchemy` helpers for signing and submitting user operations.  
  - Document required env vars and test against the Monad devnet paymaster.

## 4. UI/UX & Layout

- [ ] **Global navigation**  
  - Replace legacy sidebar script with a React component that reflects the dynamic game list.  
  - Ensure wallet pill, AA status, and bankroll badges display in the Next layout.

- [ ] **Responsive polish**  
  - Audit game pages on mobile/tablet, adjust CSS to match production.  
  - Recreate modals/toasts (`showToast`, rules overlays) using React portals.

- [ ] **Blackjack assets**  
  - Produce dedicated logo/illustrations for the new game.  
  - Update hero carousel once assets exist.

## 5. Testing & QA

- [ ] **Functional parity check**  
  - Compare each React game versus the deployed legacy version (bet flow, animations, win/lose states, bankroll updates).  
  - Verify AA path succeeds (MetaMask Delegation Toolkit gasless success) and fallback path works when bundler is disabled.

- [ ] **Paymaster end-to-end**  
  - Confirm `/api/paymaster/sign` returns valid signatures and that Hazard/Shell/Poker honour them (no placeholder signatures).  
  - Ensure the signer account has sufficient MON for covering ops.

- [ ] **Security review**  
  - Audit allowance approvals (MaxUint256) and ensure they respect the paymaster + pool logic.  
  - Confirm no sensitive env variables leak to the client apart from intended `NEXT_PUBLIC_*` keys.

- [ ] **Performance & bundling**  
  - Check Next build output for large legacy bundles; tree-shake unused legacy scripts.  
  - Enable image optimisation for all hero logos/icons.

## 6. Deployment & Docs

- [x] **Update README**  
  - Document the Next.js app structure, required env vars, and hackathon-specific flows (Delegation Toolkit, paymaster API).

- [ ] **CI/CD pipeline**  
  - Add build/test steps for the Next project.  
  - Prepare deployment config (Vercel or self-hosted) with Coroutine for bundler/Socket process.

- [ ] **Launch plan**  
  - Staging URL for hackathon demo.  
  - Checklist for cut-over from legacy static site to Next app once feature-complete.
