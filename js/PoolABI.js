// BankrollPool ABI (unified liquidity pool)
(function(){
  window.PoolABI = [
    { "inputs": [], "stateMutability": "nonpayable", "type": "constructor" },
    { "inputs": [], "name": "owner", "outputs": [{"internalType":"address","name":"","type":"address"}], "stateMutability":"view", "type":"function" },
    { "inputs": [], "name": "paused", "outputs": [{"internalType":"bool","name":"","type":"bool"}], "stateMutability":"view", "type":"function" },
    { "inputs": [{"internalType":"address","name":"game","type":"address"},{"internalType":"bool","name":"allowed","type":"bool"}], "name":"setAuthorized", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"bool","name":"p","type":"bool"}], "name":"pause", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address","name":"newOwner","type":"address"}], "name":"transferOwnership", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}], "name":"withdraw", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"}], "name":"withdrawAll", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}], "name":"pay", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [], "name": "balance", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view", "type":"function" }
  ];
})();

