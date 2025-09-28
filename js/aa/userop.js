import { AA_FEATURES } from './config.js';
import { loadDelegation, isDelegationActive } from './delegation.js';

// Stubs for now; in Phase 3 we’ll integrate a bundler + paymaster.
export async function canSponsor() {
  return !!AA_FEATURES.enableSponsorship && isDelegationActive();
}

export async function sendDelegatedCall({ to, data, value='0x0' }) {
  // Phase 3: build a UserOperation with paymaster sponsorship.
  // For now, just return a mock object so UI can react.
  return { userOpHash: '0x' + Math.random().toString(16).slice(2).padEnd(64, '0'), to, data, value };
}
