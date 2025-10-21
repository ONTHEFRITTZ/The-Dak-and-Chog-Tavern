// Lightweight bridge to the official MetaMask Delegation Toolkit build.
// Keeps a stable local path while delegating to the CDN module so we avoid MIME issues.
export * from 'https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.13.0/dist/index.mjs';
export { default } from 'https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.13.0/dist/index.mjs';

