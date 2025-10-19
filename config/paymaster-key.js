// Runtime-loaded ZeroDev paymaster credentials.
// Replace these placeholder values on the server (they are intentionally blank in source control).
// Example deployment command:
//   cat <<'EOF' > /var/www/thedakandchog.xyz/secrets/paymaster-key.js
//   (function () {
//     if (typeof window === 'undefined') return;
//     window.ZD_PAYMASTER_RPC = 'https://rpc.zerodev.app/api/v3/<project>/paymaster/<policy>/rpc?selfFunded=true';
//     window.ZD_API_KEY = '<your-zero-dev-api-key>';
//   })();
//   EOF
(function () {
  if (typeof window === 'undefined') return;
  window.ZD_PAYMASTER_RPC = '';
  window.ZD_API_KEY = '';
})();
