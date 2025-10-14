const path = require('path');
require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const {
  ALCHEMY_URL,
  INFURA_URL,
  PRIVATE_KEY,
  ETHERSCAN_KEY,
  MONAD_RPC_URL,
  MONAD_PRIVATE_KEY
} = process.env;

module.exports = {
  paths: {
    sources: path.join(__dirname, 'contracts'),
    tests: path.join(__dirname, 'test'),
    cache: path.join(__dirname, 'cache'),
    artifacts: path.join(__dirname, 'artifacts'),
  },
  solidity: '0.8.20',
  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
    sepolia: {
      url: ALCHEMY_URL || INFURA_URL || '',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    monad: {
      url: MONAD_RPC_URL || 'https://monad-testnet.drpc.org',
      accounts: MONAD_PRIVATE_KEY ? [MONAD_PRIVATE_KEY] : (PRIVATE_KEY ? [PRIVATE_KEY] : []),
    },
  },
  etherscan: { apiKey: ETHERSCAN_KEY || '' },
};
