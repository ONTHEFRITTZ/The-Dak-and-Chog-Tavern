// shell.js
// Works with MonGame contract and existing index.html + ShellABI.js

const shellElements = document.querySelectorAll(".shell");
const statusEl = document.getElementById("status");
const playsEl = document.getElementById("plays");
const returnBtn = document.getElementById("return");
const betInput = document.getElementById("bet");

let provider;
let signer;
let userAddress;

// Your deployed MonGame contract address
const shellAddress = "0x0055522ef5BB9922E916739456F6FA73a8f20dFc";

// Initialize MetaMask connection
async function init() {
  if (!window.ethereum) {
    alert("MetaMask not detected.");
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  signer = provider.getSigner();
  userAddress = await signer.getAddress();
}

// Handle shell click
shellElements.forEach((shell) => {
  shell.addEventListener("click", async () => {
    try {
      await init();

      const guess = parseInt(shell.dataset.guess);
      let betAmount = parseFloat(betInput.value);

      if (isNaN(betAmount) || betAmount <= 0) betAmount = 0.001; // minimum 0.001 ETH

      const contract = new ethers.Contract(shellAddress, window.ShellABI, signer);

      statusEl.innerText = "🎲 Playing...";

      // Call play() with value, no manual balance checks
      const tx = await contract.play(guess, {
        value: ethers.utils.parseEther(betAmount.toString()),
      });

      await tx.wait();

      // Listen for the Played event (one-time)
      contract.once("Played", (player, amount, win, guessEvent, correct) => {
        const resultText = win
          ? `🎉 You won! Your guess: ${guessEvent}, Correct: ${correct}, Bet: ${ethers.utils.formatEther(amount)} ETH`
          : `😢 You lost. Your guess: ${guessEvent}, Correct: ${correct}, Bet: ${ethers.utils.formatEther(amount)} ETH`;

        statusEl.innerText = resultText;

        const li = document.createElement("li");
        li.innerText = resultText;
        playsEl.prepend(li);
      });
    } catch (err) {
      console.error(err);
      statusEl.innerText = `❌ Error: ${err.message}`;
    }
  });
});

// Return button
returnBtn.addEventListener("click", () => {
  window.location.href = "../../index.html";
});
