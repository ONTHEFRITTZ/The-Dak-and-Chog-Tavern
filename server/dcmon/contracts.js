const { ethers } = require('ethers');
const { CONFIG } = require('./config');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
];

const WMON_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function withdraw(uint256)',
];

const DCMON_ABI = [
  ...ERC20_ABI,
  'function deposit(uint256,address) returns (uint256)',
  'function redeem(uint256,address) returns (uint256)',
  'function recordRewards(uint256)',
];

const POOL_ABI = [
  'function depositUnderlying(uint256)',
  'function redeemDcmon(uint256)',
  'function withdrawUnderlying(address,uint256)',
  'function poolUnderlyingBalance() view returns (uint256)',
  'function poolDcmonBalance() view returns (uint256)',
  'function owner() view returns (address)',
];

function connectContract(address, abi, provider, signer) {
  if (!address) return null;
  if (!provider && !signer) return null;
  const base = new ethers.Contract(address, abi, signer || provider);
  return signer ? base.connect(signer) : base;
}

function buildContracts(provider, signer) {
  const wmon = connectContract(CONFIG.wmonAddress, WMON_ABI, provider, signer);
  const dcmon = connectContract(CONFIG.dcmonToken, DCMON_ABI, provider, signer);
  const pool = connectContract(CONFIG.poolAddress, POOL_ABI, provider, signer);
  return { wmon, dcmon, pool };
}

module.exports = {
  buildContracts,
  ABIS: {
    ERC20_ABI,
    WMON_ABI,
    DCMON_ABI,
    POOL_ABI,
  },
};
