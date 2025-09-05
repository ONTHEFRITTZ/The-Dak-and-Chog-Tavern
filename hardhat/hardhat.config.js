require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const { ALCHEMY_URL, INFURA_URL, PRIVATE_KEY, ETHERSCAN_KEY } = process.env;

module.exports = {
  solidity: '0.8.20',
  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
    sepolia: {
      url: ALCHEMY_URL || INFURA_URL || '',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: { apiKey: ETHERSCAN_KEY || '' }
};

