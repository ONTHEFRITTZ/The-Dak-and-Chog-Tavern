export const PoolABI = [
  "function owner() view returns (address)",
  "function depositUnderlying(uint256 amount)",
  "function redeemDcmon(uint256 amount)",
  "function withdrawUnderlying(address recipient, uint256 amount)",
  "function poolUnderlyingBalance() view returns (uint256)",
  "function poolDcmonBalance() view returns (uint256)",
  "function setAuthorized(address game, bool allowed)",
  "function authorizedGames(address game) view returns (bool)",
] as const;

export type PoolAbi = typeof PoolABI;
