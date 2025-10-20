export const DCMonABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function exchangeRate() view returns (uint256 numerator, uint256 denominator)",
] as const;

export type DCMonAbi = typeof DCMonABI;
