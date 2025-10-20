(function(){
  const abi = [
    'function deposit() payable',
    'function withdraw(uint256 wad)',
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)'
  ];
  window.WMONABI = abi;
  window.WMON_ABI = abi;
})();
