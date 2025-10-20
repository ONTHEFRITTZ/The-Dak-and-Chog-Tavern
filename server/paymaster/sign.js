const { ethers } = require('ethers');

const DEFAULT_RPC_URL = process.env.MONAD_RPC_URL
  || process.env.MONAD_RPC
  || process.env.MONAD_BUNDLER_RPC
  || 'https://testnet-rpc.monad.xyz';

const PAYMASTER_ADDRESS = (process.env.VERIFYING_PAYMASTER_ADDR
  || process.env.PAYMASTER_ADDRESS
  || process.env.DCMON_PAYMASTER_ADDR
  || '0x225526A98049aCAFb71bB9526dd431E1A114E048').toLowerCase();

const SIGNER_PK = process.env.VERIFYING_PAYMASTER_SIGNER_PK
  || process.env.PAYMASTER_SIGNER_PK
  || process.env.DCMON_PAYMASTER_SIGNER_PK
  || '';

const PAYMASTER_ABI = [
  'function getHash((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature) userOp,uint48 validUntil,uint48 validAfter) view returns (bytes32)',
];

function hexlify(value, fallback = '0x') {
  if (value == null) return fallback;
  if (typeof value === 'string' && value.startsWith('0x')) return value;
  try { return ethers.utils.hexlify(value); } catch { return fallback; }
}

function toBigNumber(value) {
  if (value == null) return ethers.BigNumber.from(0);
  if (ethers.BigNumber.isBigNumber(value)) return value;
  return ethers.BigNumber.from(value);
}

function normalizeUserOperation(op = {}) {
  return {
    sender: ethers.utils.getAddress(op.sender),
    nonce: toBigNumber(op.nonce || 0),
    initCode: hexlify(op.initCode),
    callData: hexlify(op.callData),
    callGasLimit: toBigNumber(op.callGasLimit || 0),
    verificationGasLimit: toBigNumber(op.verificationGasLimit || 0),
    preVerificationGas: toBigNumber(op.preVerificationGas || 0),
    maxFeePerGas: toBigNumber(op.maxFeePerGas || 0),
    maxPriorityFeePerGas: toBigNumber(op.maxPriorityFeePerGas || 0),
    paymasterAndData: '0x',
    signature: '0x',
  };
}

function encodeValidityWindow(validUntil, validAfter) {
  const coder = ethers.utils.defaultAbiCoder;
  return coder.encode(['uint48', 'uint48'], [validUntil, validAfter]);
}

function buildPaymasterAndData(validUntil, validAfter, signature) {
  const encoded = encodeValidityWindow(validUntil, validAfter);
  return ethers.utils.hexConcat([
    PAYMASTER_ADDRESS,
    encoded,
    signature,
  ]);
}

function createPaymasterSigner() {
  if (!SIGNER_PK) return null;
  try {
    const provider = new ethers.providers.JsonRpcProvider(DEFAULT_RPC_URL);
    const wallet = new ethers.Wallet(SIGNER_PK, provider);
    const contract = new ethers.Contract(PAYMASTER_ADDRESS, PAYMASTER_ABI, provider);

    return async function signUserOperation({ userOperation, validUntil, validAfter }) {
      if (!userOperation) throw new Error('userOperation missing');
      const userOpStruct = normalizeUserOperation(userOperation);
      const hash = await contract.getHash(userOpStruct, validUntil, validAfter);
      const signature = await wallet.signMessage(ethers.utils.arrayify(hash));
      const paymasterAndData = buildPaymasterAndData(validUntil, validAfter, signature);
      return {
        paymaster: PAYMASTER_ADDRESS,
        paymasterAndData,
        paymasterData: paymasterAndData.slice(42),
        signature,
        validUntil,
        validAfter,
      };
    };
  } catch (err) {
    console.error('[paymaster-sign] failed to initialise signer', err);
    return null;
  }
}

module.exports = {
  PAYMASTER_ADDRESS,
  SIGNER_PK,
  createPaymasterSigner,
  encodeValidityWindow,
  buildPaymasterAndData,
};
