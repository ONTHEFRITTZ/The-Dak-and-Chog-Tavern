// Minimal ABI for dedicated Hazard contract (pooled payouts)
(function(){
  window.HazardABI = [
    { "inputs": [{ "internalType": "uint8", "name": "main", "type": "uint8" }], "name": "playHazard", "outputs": [], "stateMutability": "payable", "type": "function" },
    { "inputs": [], "name": "pool", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "maxBet", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "feeBps", "outputs": [{ "internalType": "uint16", "name": "", "type": "uint16" }], "stateMutability": "view", "type": "function" },
    { "anonymous": false, "inputs": [
        { "indexed": true, "internalType": "address", "name": "player", "type": "address" },
        { "indexed": false, "internalType": "uint256", "name": "wager", "type": "uint256" },
        { "indexed": false, "internalType": "bool", "name": "win", "type": "bool" },
        { "indexed": false, "internalType": "uint8", "name": "main", "type": "uint8" },
        { "indexed": false, "internalType": "uint8", "name": "finalSum", "type": "uint8" },
        { "indexed": false, "internalType": "uint8", "name": "chance", "type": "uint8" },
        { "indexed": false, "internalType": "uint16", "name": "iterations", "type": "uint16" }
      ], "name": "HazardPlayed", "type": "event" }
  ];
})();
