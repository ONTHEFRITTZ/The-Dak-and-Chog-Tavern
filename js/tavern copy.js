import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';

let provider;
let signer;
let userAddress;

// DOM Elements
const connectButton = document.getElementById("connect-wallet");
const fundButton = document.getElementById("fund-contract");
const statusEl = document.getElementById("status");

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

// Fund Contract Button
function enableFundButton() {
  fundButton.style.display = "inline-block";
  fundButton.addEventListener("click", async () => {
    const amount = prompt("Enter MON amount to fund:");
    if (!amount) return;
    try {
      const shellAddress = "0x8BA35Eca0fe68787b275C6ed065675829843Adf5";
      const abiResponse = await fetch("games/shell/ShellABI.js");
      const abi = ShellABI;
      const contract = new ethers.Contract(shellAddress, abi, signer);
      const tx = await contract.fund({ value: ethers.utils.parseEther(amount) });
      statusEl.innerText = "💰 Funding contract...";
      await tx.wait();
      statusEl.innerText = `✅ Funded with ${amount} MON!`;
    } catch (err) {
      statusEl.innerText = "❌ Error: " + err.message;
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

// Export signer for games
export { signer, provider, userAddress };
