// Runtime-loaded Pimlico paymaster credentials.
// Replace these placeholder values on the server (they are intentionally blank in source control).
// Example deployment command:
//   cat <<'EOF' > /var/www/thedakandchog.xyz/secrets/paymaster-key.js
//   (function () {
//     if (typeof window === 'undefined') return;
//     window.PIMLICO_PAYMASTER_RPC = 'https://api.pimlico.io/v2/monad-testnet/rpc';
//     window.PIMLICO_API_KEY = '<your-pimlico-api-key>';
//   })();
//   EOF
(function () {
  if (typeof window === 'undefined') return;
  const rpc = '';
  const apiKey = '';
  // Prefer Pimlico-prefixed keys, but continue to populate legacy ZeroDev names for compatibility.
  try {
    window.PIMLICO_PAYMASTER_RPC = rpc;
    window.PIMLICO_API_KEY = apiKey;
  } catch {}
  try {
    window.ZD_PAYMASTER_RPC = rpc;
    window.ZD_API_KEY = apiKey;
  } catch {}
})();
