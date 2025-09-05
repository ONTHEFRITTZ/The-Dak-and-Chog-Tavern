// Faro contract ABI (minimal)
(function(){
  window.FaroABI = [
    {
      "inputs": [
        { "internalType": "uint8", "name": "betRank", "type": "uint8" }
      ],
      "name": "playFaro",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    },
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
    // admin (optional to expose in UI)
    { "inputs": [{"internalType":"uint16","name":"_bps","type":"uint16"}], "name": "setFeeBps", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint256","name":"_max","type":"uint256"}], "name": "setMaxBet", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
  ];
})();

