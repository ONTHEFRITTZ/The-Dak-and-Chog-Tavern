// Minimal ABI for dedicated DakChog coin flip contract
(function(){
  window.DakChogABI = [
    // Core gameplay
    { "inputs": [{ "internalType": "bool", "name": "chooseChog", "type": "bool" }], "name": "playCoin", "outputs": [], "stateMutability": "payable", "type": "function" },

    // Views
    { "inputs": [], "name": "pool",   "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "owner",  "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "maxBet", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "feeBps", "outputs": [{ "internalType": "uint16", "name": "", "type": "uint16" }], "stateMutability": "view", "type": "function" },

    // Admin (owner only)
    { "inputs": [{ "internalType": "address", "name": "poolAddr", "type": "address" }], "name": "setPool", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "anonymous": false, "inputs": [
        { "indexed": true, "internalType": "address", "name": "player", "type": "address" },
        { "indexed": false, "internalType": "uint256", "name": "wager", "type": "uint256" },
        { "indexed": false, "internalType": "uint256", "name": "fee", "type": "uint256" },
        { "indexed": false, "internalType": "bool", "name": "won", "type": "bool" },
        { "indexed": false, "internalType": "bool", "name": "resultChog", "type": "bool" },
        { "indexed": false, "internalType": "bool", "name": "chooseChog", "type": "bool" }
      ], "name": "CoinPlayed", "type": "event" }
  ];
})();
