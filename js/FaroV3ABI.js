// FaroV3 ABI with copper support
(function(){
  window.FaroV3ABI = [
    { "inputs": [ {"internalType":"uint8","name":"betRank","type":"uint8"}, {"internalType":"bool","name":"copper","type":"bool"} ], "name":"playFaro", "outputs": [], "stateMutability":"payable", "type":"function" },
    { "anonymous": false, "inputs": [
      {"indexed": true, "internalType":"address","name":"player","type":"address"},
      {"indexed": false, "internalType":"uint256","name":"wager","type":"uint256"},
      {"indexed": false, "internalType":"uint256","name":"fee","type":"uint256"},
      {"indexed": false, "internalType":"bool","name":"win","type":"bool"},
      {"indexed": false, "internalType":"bool","name":"push","type":"bool"},
      {"indexed": false, "internalType":"bool","name":"copper","type":"bool"},
      {"indexed": false, "internalType":"uint8","name":"bankRank","type":"uint8"},
      {"indexed": false, "internalType":"uint8","name":"playerRank","type":"uint8"},
      {"indexed": false, "internalType":"uint8","name":"betRank","type":"uint8"}
    ], "name":"FaroPlayed", "type":"event" }
  ];
})();

