# Next.js Migration & Smart Account TODO

> Reference checklist for completing the Tavern rebuild on the `nextjs-migration` branch ahead of the [MetaMask Smart Accounts × Monad Dev Cook-Off](https://www.hackquest.io/hackathons/MetaMask-Smart-Accounts-x-Monad-Dev-Cook-Off).

## 1. Game Ports

- [ ] **Poker (lobby + table)**  
  - Rebuild `poker/index.html` & `table.html` flows as React routes (`/games/poker`, `/games/poker/table/[id]`).  
  - Replace direct DOM mutations with stateful components; reuse socket clients via a dedicated hook (`useRealtimePoker`).  
  - Wire bankroll + AA helpers for buy-in / cash-out and table rake (4337 send first, fallback to signer).  
  - Preserve table animations, card overlays, and admin controls.

- [x] **Dak & Chog Coin Flip** – React port completed (`/games/dakchog`). *(Verify against production during QA.)*

- [x] **Shell Game** – React port completed (`/games/shell`). *(Pending bankroll hook integration – see Section 2.)*

- [x] **Hazard** – React port completed (`/games/hazard`). *(Pending bankroll hook integration – see Section 2.)*

- [ ] **Blackjack (new)**  
  - Design gameplay spec (DCMon wager, bankroll integration, 4337 route).  
  - Implement table UI, state machine, betting + payouts.  
  - Connect to bankroll/paymaster pipelines.

- [ ] **Remove Faro**  
  - Delete legacy Faro assets/routes once Blackjack is live.  
  - Ensure no references to `/games/faro` remain in sidebar, env, or configs.

## 2. Shared Runtime & Bankroll

- [ ] **Finalise `useBankroll` hook**  
  - Replace Dak & Chog / Shell direct DCMon calls with hook methods (ensuring allowance, refresh, formatting).  
  - Expose reactive state to a global bankroll widget (for wallet pill + future HUD).

- [ ] **Create AA execution hook**  
  - Wrap `/js/aaClient.js` functionality in a typed hook (`useDelegationToolkitAA`) that:  
    - Ensures toolkit context, bundler client (`paymaster: true`), and session state.  
    - Provides helpers for `sendUserOperation`, `waitForUserOperationReceipt`, and fallback EOA send.  
    - Emits events mirrored from legacy (`aa:sponsored`, `aa:session`, etc.).

- [ ] **Socket / realtime hooks**  
  - Abstract the Socket.IO lobby/table logic into `useRealtimeLobby` & `useRealtimePokerTable`.  
  - Ensure reconnection handling and typed events.

## 3. Paymaster & AA Infrastructure

- [x] **API route for Verifying Paymaster signatures** (`/api/paymaster/sign`).  
  - Confirm env keys in Vercel/Server: `VERIFYING_PAYMASTER_SIGNER_PK`, `MONAD_RPC_URL`, etc.

- [ ] **Frontend adoption of new paymaster endpoint**  
  - Update `useBankroll`, poker buy-in/cash-out flows, and game AA sends to request signatures from `/api/paymaster/sign`.  
  - Remove dummy `window.AA_PAYMASTER_CONTEXT`.

- [ ] **MetaMask Delegation Toolkit integration**  
  - Ensure every user operation is executed via `createBundlerClient({ paymaster: true })`.  
  - Add test coverage (manual or automated) showing receipt awaited via `waitForUserOperationReceipt`.

- [ ] **Alchemy Smart Wallet readiness**  
  - Confirm helper in `lib/alchemyClient.ts` works once Monad is supported or we deploy custom factory.  
  - Document env vars: `NEXT_PUBLIC_ALCHEMY_API_KEY`, `NEXT_PUBLIC_ALCHEMY_PAYMASTER_RPC`, etc.

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

- [ ] **Update README**  
  - Document the Next.js app structure, required env vars, and hackathon-specific flows (Delegation Toolkit, paymaster API).

- [ ] **CI/CD pipeline**  
  - Add build/test steps for the Next project.  
  - Prepare deployment config (Vercel or self-hosted) with Coroutine for bundler/Socket process.

- [ ] **Launch plan**  
  - Staging URL for hackathon demo.  
  - Checklist for cut-over from legacy static site to Next app once feature-complete.
