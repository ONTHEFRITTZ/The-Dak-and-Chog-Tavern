// Minimal ABI for Shell pooled contract
window.ShellABI = [
  { "inputs": [ {"internalType":"uint8","name":"guess","type":"uint8"} ], "name":"playShell", "outputs": [], "stateMutability":"payable", "type":"function" },
  { "anonymous": false, "inputs": [
      {"indexed":true,  "internalType":"address","name":"player","type":"address"},
      {"indexed":false, "internalType":"uint256","name":"wager","type":"uint256"},
      {"indexed":false, "internalType":"uint256","name":"fee","type":"uint256"},
      {"indexed":false, "internalType":"bool","name":"won","type":"bool"},
      {"indexed":false, "internalType":"uint8","name":"winningCup","type":"uint8"},
      {"indexed":false, "internalType":"uint8","name":"guess","type":"uint8"}
    ], "name":"ShellPlayed", "type":"event" }
];

