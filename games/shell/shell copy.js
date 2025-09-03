// shell.js
// Ensure this works with existing index.html and ShellABI.js loaded as global

const shellElements = document.querySelectorAll(".shell");
const statusEl = document.getElementById("status");
const playsEl = document.getElementById("plays");
const returnBtn = document.getElementById("return");
const betInput = document.getElementById("bet");

let provider;
let signer;
let userAddress;

// Updated contract address
const shellAddress = "0x25Bd046CA4f9779BedF4B1724A17cC951BF5FFe4";

// Connect to MetaMask on first interaction
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

      // Minimum bet 0.001 ETH
      if (isNaN(betAmount) || betAmount < 0.001) betAmount = 0.001;

      const contract = new ethers.Contract(shellAddress, window.ShellABI, signer);

      statusEl.innerText = "🎲 Playing...";

      // Send transaction with manual gas limit
      const tx = await contract.play(guess, {
        value: ethers.utils.parseEther(betAmount.toString()),
        gasLimit: 200000, // manual gas limit
      });

      await tx.wait();

      statusEl.innerText = `✅ Played shell #${guess}. Waiting for event confirmation...`;

      // Listen for Played event (one-time)
      contract.once("Played", (player, guessEvent, won, winningCup) => {
        const resultText = won
          ? `🎉 You won! Your guess: ${guessEvent}, Winning cup: ${winningCup}`
          : `😢 You lost. Your guess: ${guessEvent}, Winning cup: ${winningCup}`;

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

// Return to Tavern button
returnBtn.addEventListener("click", () => {
  window.location.href = "../../index.html";
});
