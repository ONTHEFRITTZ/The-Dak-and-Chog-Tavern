// Faro contract ABI (minimal)
(function(){
  window.FaroABI = [
    // Note: V2 uses playFaro(uint8); V3 uses playFaro(uint8,bool).
    // Admin page does not call playFaro; it interacts with owner/admin funcs.
    {
      "anonymous": false,
      "inputs": [
        { "indexed": true,  "internalType":"address","name":"player","type":"address" },
        { "indexed": false, "internalType":"uint256","name":"wager","type":"uint256" },
        { "indexed": false, "internalType":"uint256","name":"fee","type":"uint256" },
        { "indexed": false, "internalType":"bool","name":"win","type":"bool" },
        { "indexed": false, "internalType":"bool","name":"push","type":"bool" },
        { "indexed": false, "internalType":"uint8","name":"bankRank","type":"uint8" },
        { "indexed": false, "internalType":"uint8","name":"playerRank","type":"uint8" },
        { "indexed": false, "internalType":"uint8","name":"betRank","type":"uint8" }
      ],
      "name": "FaroPlayed",
      "type": "event"
    },
    // Admin/read functions used by admin page (present on V3)
    { "inputs": [], "name": "owner", "outputs": [{"internalType":"address","name":"","type":"address"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "maxBet", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "feeBps", "outputs": [{"internalType":"uint16","name":"","type":"uint16"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "feesAccrued", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
    { "inputs": [{"internalType":"uint16","name":"_bps","type":"uint16"}], "name": "setFeeBps", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint256","name":"_max","type":"uint256"}], "name": "setMaxBet", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}], "name": "withdrawFees", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"address payable","name":"to","type":"address"}], "name": "emergencyWithdrawAll", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
  ];
})();

