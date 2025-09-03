// games/hazard/HazardABI.js
// Expose ABI as a global to avoid module/assert/CSP issues

window.HazardABI = [
  {
    "inputs": [],
    "name": "fund",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs":[{"internalType":"uint8","name":"main","type":"uint8"}],
    "name":"play",
    "outputs": [],
    "stateMutability":"payable",
    "type":"function"
  },
  {
    "inputs": [{"internalType":"uint256","name":"amount","type":"uint256"}],
    "name":"withdraw",
    "outputs": [],
    "stateMutability":"nonpayable",
    "type":"function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{"internalType":"address","name":"","type":"address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs":[
      {"indexed":true,"internalType":"address","name":"player","type":"address"},
      {"indexed":false,"internalType":"uint256","name":"wager","type":"uint256"},
      {"indexed":false,"internalType":"bool","name":"win","type":"bool"},
      {"indexed":false,"internalType":"uint8","name":"main","type":"uint8"},
      {"indexed":false,"internalType":"uint8","name":"finalSum","type":"uint8"},
      {"indexed":false,"internalType":"uint8","name":"chance","type":"uint8"},
      {"indexed":false,"internalType":"uint256","name":"iterations","type":"uint256"}
    ],
    "name":"HazardPlayed",
    "type":"event"
  }
];
