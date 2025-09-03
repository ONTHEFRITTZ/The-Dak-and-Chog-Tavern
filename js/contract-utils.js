let provider, signer;

// Shared function to fund contract
async function fundContract(amount) {
  const contractAddress = "0x405F38494B8840968fC95EB400EAce21A306F873"; // Example: shell contract
  const abi = await fetch('games/shell/ShellABI.json').then(res => res.json());
  const contract = new ethers.Contract(contractAddress, abi, signer);
  return contract.fund({ value: ethers.utils.parseEther(amount) });
}

// Utility to check wallet
function isWalletConnected() {
  return signer !== undefined && signer !== null;
}
