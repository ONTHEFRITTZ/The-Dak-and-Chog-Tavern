(function(){
  window.DCMonABI = [
    'function deposit(uint256 amount, address receiver) returns (uint256)',
    'function redeem(uint256 amount, address receiver) returns (uint256)',
    'function exchangeRate() view returns (uint256 numerator, uint256 denominator)',
    'function previewDeposit(uint256 amountUnderlying) view returns (uint256 mintedShares)',
    'function previewRedeem(uint256 shares) view returns (uint256 amountUnderlying)',
    'function recordRewards(uint256 amount)',
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function houseTreasury() view returns (address)',
    'function playerRewardPool() view returns (address)'
  ];
})();
