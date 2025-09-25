(function(){
  window.HoldemPokerABI = [
    { "inputs": [{"internalType":"address","name":"poolAddrIgnored","type":"address"}], "stateMutability":"nonpayable", "type":"constructor" },
    { "inputs": [], "name": "owner", "outputs": [{"internalType":"address","name":"","type":"address"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "rakeBps", "outputs": [{"internalType":"uint16","name":"","type":"uint16"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "smallBlind", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "bigBlind", "outputs": [{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
    { "inputs": [{"internalType":"uint16","name":"_bps","type":"uint16"}], "name":"setRake", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint256","name":"_sb","type":"uint256"},{"internalType":"uint256","name":"_bb","type":"uint256"}], "name":"setBlinds", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"bool","name":"p","type":"bool"}], "name":"pause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"joinSeat", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"unseat", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"leaveDuringHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint256","name":"nextHandId","type":"uint256"},{"internalType":"uint8","name":"dealer","type":"uint8"},{"internalType":"uint8","name":"sb","type":"uint8"},{"internalType":"uint8","name":"bb","type":"uint8"}], "name":"beginHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{"internalType":"uint8","name":"seatId","type":"uint8"}], "name":"contribute", "outputs": [], "stateMutability": "payable", "type": "function" },
    { "inputs": [{"internalType":"address[]","name":"winners","type":"address[]"},{"internalType":"uint256[]","name":"payouts","type":"uint256[]"},{"internalType":"uint256","name":"rakeOverride","type":"uint256"}], "name":"settleHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
  ];
})();
