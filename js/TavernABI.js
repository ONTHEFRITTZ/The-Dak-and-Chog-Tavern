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
  ];
})();

