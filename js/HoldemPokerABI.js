(function(){
  window.HoldemPokerABI = [
    { "inputs": [{"internalType":"address","name":"poolAddrIgnored","type":"address"}], "stateMutability":"nonpayable", "type":"constructor" },
    { "inputs": [], "name": "rakeBps", "outputs": [{"internalType":"uint16","name":"","type":"uint16"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "smallBlind", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "bigBlind", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"joinSeat", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"unseat", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"leaveDuringHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"dealer","type":"uint8"},{"internalType":"uint8","name":"sb","type":"uint8"},{"internalType":"uint8","name":"bb","type":"uint8"}], "name":"beginHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"contribute", "outputs": [], "stateMutability": "payable", "type": "function" },
    { "inputs": [{"internalType":"address[]","name":"winners","type":"address[]"},{"internalType":"uint256[]","name":"payouts","type":"uint256[]"}], "name":"settleHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
  ];
})();
