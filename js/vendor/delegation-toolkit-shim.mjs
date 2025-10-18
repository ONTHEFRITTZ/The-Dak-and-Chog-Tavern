// Shim module that re-exports the pieces of the MetaMask Delegation Toolkit
// we rely on, using fully-qualified CDN URLs so the browser can import them
// without Node-style module resolution.

import {
  Implementation,
  createExecution,
  encodeCallsForCaller,
  encodeExecutionCalldata,
  encodeExecutionCalldatas,
  getCounterfactualAccountData,
  getDeleGatorEnvironment,
  toMetaMaskSmartAccount
} from 'https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.13.0/dist/index.mjs';

import {
  SIGNABLE_USER_OP_TYPED_DATA,
  signUserOperation
} from 'https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.13.0/dist/chunk-IVSH2AQS.mjs';

const shim = {
  Implementation,
  createExecution,
  encodeCallsForCaller,
  encodeExecutionCalldata,
  encodeExecutionCalldatas,
  getCounterfactualAccountData,
  getDeleGatorEnvironment,
  SIGNABLE_USER_OP_TYPED_DATA,
  signUserOperation,
  toMetaMaskSmartAccount
};

export {
  Implementation,
  createExecution,
  encodeCallsForCaller,
  encodeExecutionCalldata,
  encodeExecutionCalldatas,
  getCounterfactualAccountData,
  getDeleGatorEnvironment,
  SIGNABLE_USER_OP_TYPED_DATA,
  signUserOperation,
  toMetaMaskSmartAccount
};

export default shim;
