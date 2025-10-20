// Minimal ABI for PokerTablePool used by the on-chain panel
window.PokerTablePoolABI = [
  { "inputs": [ {"internalType":"address","name":"poolAddr","type":"address"}, {"internalType":"uint16","name":"_rakeBps","type":"uint16"}, {"internalType":"uint256","name":"_sb","type":"uint256"}, {"internalType":"uint256","name":"_bb","type":"uint256"} ], "stateMutability":"nonpayable", "type":"constructor" },
  { "inputs": [], "name": "MAX_SEATS", "outputs": [ {"internalType":"uint8","name":"","type":"uint8"} ], "stateMutability":"view", "type":"function" },
  { "inputs": [ {"internalType":"uint8","name":"seatId","type":"uint8"} ], "name":"seat", "outputs": [], "stateMutability":"payable", "type":"function" },
  { "inputs": [ {"internalType":"uint8","name":"seatId","type":"uint8"} ], "name":"deposit", "outputs": [], "stateMutability":"payable", "type":"function" },
  { "inputs": [ {"internalType":"uint8","name":"seatId","type":"uint8"}, {"internalType":"uint256","name":"amount","type":"uint256"} ], "name":"withdraw", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
  { "inputs": [ {"internalType":"uint8","name":"seatId","type":"uint8"} ], "name":"unseat", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
  { "inputs": [ {"internalType":"uint8","name":"","type":"uint8"} ], "name":"seats", "outputs": [ {"internalType":"address","name":"player","type":"address"}, {"internalType":"uint256","name":"balance","type":"uint256"} ], "stateMutability":"view", "type":"function" },
  { "inputs": [], "name":"inHand", "outputs": [ {"internalType":"bool","name":"","type":"bool"} ], "stateMutability":"view", "type":"function" },
  { "inputs": [], "name":"handId", "outputs": [ {"internalType":"uint256","name":"","type":"uint256"} ], "stateMutability":"view", "type":"function" },
  { "inputs": [], "name":"smallBlind", "outputs": [ {"internalType":"uint256","name":"","type":"uint256"} ], "stateMutability":"view", "type":"function" },
  { "inputs": [], "name":"bigBlind", "outputs": [ {"internalType":"uint256","name":"","type":"uint256"} ], "stateMutability":"view", "type":"function" }
];

