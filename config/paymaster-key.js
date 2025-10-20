// Runtime-loaded paymaster credentials.
// Replace these placeholder values on the server (they are intentionally blank in source control).
// Example deployment snippet:
//   cat <<'EOF' > /var/www/thedakandchog.xyz/secrets/paymaster-key.js
//   (function () {
//     if (typeof window === 'undefined') return;
//     window.ALCHEMY_BUNDLER_RPC = 'https://account-abstraction.alchemy.com/bundler/YOUR_CHAIN/YOUR_KEY';
//     window.ALCHEMY_PAYMASTER_RPC = 'https://account-abstraction.alchemy.com/paymaster/YOUR_CHAIN/YOUR_KEY';
//     window.ALCHEMY_API_KEY = 'YOUR_ALCHEMY_AA_KEY';
//     window.ALCHEMY_POLICY_ID = 'optional-policy-id';
//   })();
//   EOF
(function () {
  if (typeof window === 'undefined') return;
  const bundlerRpc = '';
  const paymasterRpc = '';
  const apiKey = '';
  const policyId = '';
  try {
    if (bundlerRpc) window.ALCHEMY_BUNDLER_RPC = bundlerRpc;
    if (paymasterRpc) window.ALCHEMY_PAYMASTER_RPC = paymasterRpc;
    window.ALCHEMY_API_KEY = apiKey;
    window.ALCHEMY_POLICY_ID = policyId;
  } catch {}
  try {
    delete window.MONAD_BUNDLER_RPC;
    delete window.MONAD_PAYMASTER_RPC;
    delete window.MONAD_PAYMASTER_API_KEY;
    delete window.PIMLICO_PAYMASTER_RPC;
    delete window.PIMLICO_BUNDLER_RPC;
    delete window.PIMLICO_API_KEY;
    delete window.PIMLICO_POLICY_ID;
  } catch {}
})();
