import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';

let provider;
let signer;
let userAddress;

// DOM Elements
const connectButton = document.getElementById("connect-wallet");
const fundButton = document.getElementById("fund-contract");
const statusEl = document.getElementById("status");

// New MonGame contract address
const shellAddress = "0x0055522ef5BB9922E916739456F6FA73a8f20dFc";

// Connect Wallet
export async function connectWallet() {
  if (!window.ethereum) return alert("MetaMask not detected.");

  try {
    await ethereum.request({ method: "eth_requestAccounts" });
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    connectButton.innerText = "Wallet Connected";
    statusEl.innerText = `✅ Wallet connected: ${userAddress}`;
    enableFundButton();
    sessionStorage.setItem("walletConnected", "true");
  } catch (err) {
    statusEl.innerText = "❌ Connection failed: " + err.message;
  }
}

// Enable fund button and handle funding
function enableFundButton() {
  fundButton.style.display = "inline-block";
  fundButton.addEventListener("click", async () => {
    const amount = prompt("Enter amount to fund (ETH):");
    if (!amount) return;

    try {
      // Use the same ABI as ShellABI.js loaded globally
      const contract = new ethers.Contract(shellAddress, window.ShellABI, signer);

      statusEl.innerText = "💰 Funding contract...";

      const tx = await contract.fund({ value: ethers.utils.parseEther(amount) });
      await tx.wait();

      statusEl.innerText = `✅ Funded with ${amount} ETH!`;
    } catch (err) {
      console.error(err);
      statusEl.innerText = `❌ Error: ${err.message}`;
    }
  });
}

// Auto-connect if previously connected
window.addEventListener("load", async () => {
  if (sessionStorage.getItem("walletConnected") === "true") {
    await connectWallet();
  }
});

connectButton.addEventListener("click", connectWallet);

// Export signer and provider for games
export { signer, provider, userAddress };
