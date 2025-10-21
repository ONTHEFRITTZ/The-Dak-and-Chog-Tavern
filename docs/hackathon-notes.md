Demo Flow
- Enable Gasless Mode in AA UI
- Open Poker Table (on-chain)
- Sit (no RPC errors). If wallet supports `wallet_sendCalls`, send is gasless; otherwise fallback to normal tx
- Toggle Agent options (Auto Ready / Auto Rebuy / Auto Clear Seat)
- See Envio activity panel (bottom-left) and user Activity score
- Note SA(7702) badge shows ready/not‑ready and brief info on future delegation

Technical Notes
- wallet_sendCalls detection: `js/bundler.js` strictly checks capability before using; fallbacks preserved
- AA fallback ladder: `js/aa/ops.js` encodes calldata, uses `aaClient.client.sendTransaction` → `window.smartAccount` → no-op if unavailable
- 7702 detector: Blob import in `js/aa/init-all.js`, emits `aa:7702` and writes `localStorage['aa.7702.ready']`
- Envio integration deprecated; activity feeds now show a static notice until a replacement telemetry pipeline is selected.

Limits Today
- MetaMask internal signer for 7702 on Monad is not reliably available yet → no live delegation via internal signer
- Detector is non-blocking and flips UI state when vendor/chain support becomes available
