// Unified Tavern contract ABI (placeholder; align with your deployed contract)
// Exposes per-game entrypoints and emits game-specific events
(function(){
  window.TavernABI = [
    // Shell
    {
      "inputs": [ {"internalType":"uint8","name":"guess","type":"uint8"} ],
      "name": "playShell",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "anonymous": false,
      "inputs": [
        {"indexed": true,  "internalType":"address","name":"player","type":"address"},
        {"indexed": false, "internalType":"uint256","name":"wager","type":"uint256"},
        {"indexed": false, "internalType":"bool","name":"won","type":"bool"},
        {"indexed": false, "internalType":"uint8","name":"winningCup","type":"uint8"},
        {"indexed": false, "internalType":"uint8","name":"guess","type":"uint8"}
      ],
      "name": "ShellPlayed",
      "type": "event"
    },

    // Hazard
    {
      "inputs": [ {"internalType":"uint8","name":"main","type":"uint8"} ],
      "name": "playHazard",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "anonymous": false,
      "inputs": [
        {"indexed": true,  "internalType":"address","name":"player","type":"address"},
        {"indexed": false, "internalType":"uint256","name":"wager","type":"uint256"},
        {"indexed": false, "internalType":"bool","name":"win","type":"bool"},
        {"indexed": false, "internalType":"uint8","name":"main","type":"uint8"},
        {"indexed": false, "internalType":"uint8","name":"finalSum","type":"uint8"},
        {"indexed": false, "internalType":"uint8","name":"chance","type":"uint8"},
        {"indexed": false, "internalType":"uint8","name":"iterations","type":"uint8"}
      ],
      "name": "HazardPlayed",
      "type": "event"
    },

    // Coin flip (Dak & Chog)
    {
      "inputs": [ {"internalType":"bool","name":"chooseChog","type":"bool"} ],
      "name": "playCoin",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "anonymous": false,
      "inputs": [
        {"indexed": true,  "internalType":"address","name":"player","type":"address"},
        {"indexed": false, "internalType":"uint256","name":"wager","type":"uint256"},
        {"indexed": false, "internalType":"bool","name":"won","type":"bool"},
        {"indexed": false, "internalType":"bool","name":"resultChog","type":"bool"}
      ],
      "name": "CoinPlayed",
      "type": "event"
    }
    ,
    // Admin/read functions used by admin page
    { "inputs": [], "name": "owner", "outputs": [{"internalType":"address","name":"","type":"address"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "maxBet", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
    { "inputs": [{"internalType":"uint256","name":"_max","type":"uint256"}], "name": "setMaxBet", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"}], "name": "emergencyWithdrawAll", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"bool","name":"p","type":"bool"}], "name": "pause", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
  ];
})();

