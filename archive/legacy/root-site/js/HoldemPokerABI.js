(function(){
  window.HoldemPokerABI = [
    { "inputs": [
        { "internalType": "address", "name": "dcmonAddr", "type": "address" },
        { "internalType": "address", "name": "poolAddr", "type": "address" }
      ], "stateMutability": "nonpayable", "type": "constructor" },

    // Admin
    { "inputs": [{ "internalType": "bool", "name": "p", "type": "bool" }], "name": "pause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "uint16", "name": "bps", "type": "uint16" }], "name": "setRakeBps", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "uint256", "name": "sb", "type": "uint256" }, { "internalType": "uint256", "name": "bb", "type": "uint256" }], "name": "setBlinds", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "poolAddr", "type": "address" }], "name": "setPool", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }], "name": "transferOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "withdrawFees", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "uint8", "name": "seatId", "type": "uint8" }, { "internalType": "bool", "name": "duringHand", "type": "bool" }], "name": "forceUnseat", "outputs": [], "stateMutability": "nonpayable", "type": "function" },

    // Gameplay
    { "inputs": [{ "internalType": "uint8", "name": "seatId", "type": "uint8" }], "name": "joinSeat", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "uint8", "name": "seatId", "type": "uint8" }], "name": "unseat", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "uint8", "name": "seatId", "type": "uint8" }], "name": "leaveDuringHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [
        { "internalType": "uint8", "name": "dealer", "type": "uint8" },
        { "internalType": "uint8", "name": "sb", "type": "uint8" },
        { "internalType": "uint8", "name": "bb", "type": "uint8" }
      ], "name": "beginHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [
        { "internalType": "uint8", "name": "seatId", "type": "uint8" },
        { "internalType": "uint256", "name": "amount", "type": "uint256" }
      ], "name": "contribute", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [
        { "internalType": "address[]", "name": "winners", "type": "address[]" },
        { "internalType": "uint256[]", "name": "payouts", "type": "uint256[]" }
      ], "name": "settleHand", "outputs": [], "stateMutability": "nonpayable", "type": "function" },

    // Views
    { "inputs": [], "name": "dcmonToken", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "pool", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "rakeBps", "outputs": [{ "internalType": "uint16", "name": "", "type": "uint16" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "smallBlind", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "bigBlind", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "paused", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "feesAccrued", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "handId", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "inHand", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }], "name": "seats", "outputs": [{ "internalType": "address", "name": "player", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "pot", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },

    // Events
    { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "bool", "name": "paused", "type": "bool" }], "name": "Paused", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint16", "name": "bps", "type": "uint16" }], "name": "RakeUpdated", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint256", "name": "sb", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "bb", "type": "uint256" }], "name": "BlindsUpdated", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }], "name": "OwnershipTransferred", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "pool", "type": "address" }], "name": "PoolUpdated", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": true, "internalType": "uint8", "name": "seat", "type": "uint8" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "SeatTaken", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": true, "internalType": "uint8", "name": "seat", "type": "uint8" }, { "indexed": false, "internalType": "uint256", "name": "returnedAmount", "type": "uint256" }], "name": "SeatLeft", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": true, "internalType": "uint8", "name": "seat", "type": "uint8" }], "name": "Joined", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": true, "internalType": "uint8", "name": "seat", "type": "uint8" }], "name": "LeftDuringHand", "type": "event" },
    { "anonymous": false, "inputs": [
        { "indexed": true, "internalType": "uint256", "name": "handId", "type": "uint256" },
        { "indexed": false, "internalType": "uint8", "name": "dealer", "type": "uint8" },
        { "indexed": false, "internalType": "uint8", "name": "sb", "type": "uint8" },
        { "indexed": false, "internalType": "uint8", "name": "bb", "type": "uint8" }
      ], "name": "HandStarted", "type": "event" },
    { "anonymous": false, "inputs": [
        { "indexed": true, "internalType": "uint256", "name": "handId", "type": "uint256" },
        { "indexed": true, "internalType": "uint8", "name": "seat", "type": "uint8" },
        { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
      ], "name": "Contributed", "type": "event" },
    { "anonymous": false, "inputs": [
        { "indexed": true, "internalType": "uint256", "name": "handId", "type": "uint256" },
        { "indexed": false, "internalType": "address[]", "name": "winners", "type": "address[]" },
        { "indexed": false, "internalType": "uint256[]", "name": "payouts", "type": "uint256[]" },
        { "indexed": false, "internalType": "uint256", "name": "rake", "type": "uint256" }
      ], "name": "HandSettled", "type": "event" }
  ];
})();
