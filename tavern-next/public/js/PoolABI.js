// BankrollPool ABI (DCmon-enabled unified liquidity pool)
(function(){
  window.PoolABI = [
    { "inputs": [
        { "internalType": "address","name": "_underlying","type": "address" },
        { "internalType": "address","name": "_dcmon","type": "address" }
      ], "stateMutability": "nonpayable", "type": "constructor" },
    { "inputs": [], "name": "owner", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "paused", "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ], "stateMutability": "view", "type": "function" },
    { "inputs": [ { "internalType": "address", "name": "game", "type": "address" } ], "name": "authorizedGames", "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ], "stateMutability": "view", "type": "function" },
    { "inputs": [ { "internalType": "address", "name": "game", "type": "address" }, { "internalType": "bool", "name": "allowed", "type": "bool" } ], "name": "setAuthorized", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [ { "internalType": "bool", "name": "p", "type": "bool" } ], "name": "pause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [ { "internalType": "address", "name": "newOwner", "type": "address" } ], "name": "transferOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [ { "internalType": "uint256", "name": "amount", "type": "uint256" } ], "name": "depositUnderlying", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [ { "internalType": "uint256", "name": "amount", "type": "uint256" } ], "name": "redeemDcmon", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [ { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" } ], "name": "withdrawUnderlying", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [ { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" } ], "name": "withdrawNative", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "poolUnderlyingBalance", "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "poolDcmonBalance", "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ], "stateMutability": "view", "type": "function" },
    { "inputs": [ { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" } ], "name": "payDcmon", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [ { "internalType": "address payable", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" } ], "name": "payNative", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
  ];
})();
