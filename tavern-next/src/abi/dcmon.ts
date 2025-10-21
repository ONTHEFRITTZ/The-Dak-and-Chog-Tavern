export const DCMonABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit(uint256 amount, address receiver) returns (uint256)",
  "function redeem(uint256 amount, address receiver) returns (uint256)",
  "function recordRewards(uint256 amount)",
  "function exchangeRate() view returns (uint256 numerator, uint256 denominator)",
  "function totalUnderlying() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function houseTreasury() view returns (address)",
  "function playerRewardPool() view returns (address)",
] as const;

export type DCMonAbi = typeof DCMonABI;
