(function(){
  window.WhitelistABI = [
    { "inputs": [], "stateMutability": "nonpayable", "type": "constructor" },
    { "inputs": [], "name": "owner", "outputs": [{"internalType":"address","name":"","type":"address"}], "stateMutability":"view", "type":"function" },
    { "inputs": [{"internalType":"address","name":"account","type":"address"}], "name": "isAllowed", "outputs": [{"internalType":"bool","name":"","type":"bool"}], "stateMutability":"view", "type":"function" },
    { "inputs": [{"internalType":"address","name":"newOwner","type":"address"}], "name":"transferOwnership", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address","name":"account","type":"address"},{"internalType":"bool","name":"isAllowed_","type":"bool"}], "name":"set", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address","name":"account","type":"address"}], "name":"add", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address","name":"account","type":"address"}], "name":"remove", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address[]","name":"accounts","type":"address[]"},{"internalType":"bool","name":"isAllowed_","type":"bool"}], "name":"setMany", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address[]","name":"accounts","type":"address[]"}], "name":"addMany", "outputs": [], "stateMutability":"nonpayable", "type":"function" },
    { "inputs": [{"internalType":"address[]","name":"accounts","type":"address[]"}], "name":"removeMany", "outputs": [], "stateMutability":"nonpayable", "type":"function" }
  ];
})();

