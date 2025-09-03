// shell.js
// Works with existing index.html and ShellABI.js loaded globally

const shellElements = document.querySelectorAll(".shell");
const statusEl = document.getElementById("status");
const playsEl = document.getElementById("plays");
const returnBtn = document.getElementById("return");
const betInput = document.getElementById("bet");

let provider;
let signer;
let userAddress;

const shellAddress = "0x0055522ef5BB9922E916739456F6FA73a8f20dFc";

async function init() {
  if (!window.ethereum) {
    alert("MetaMask not detected.");
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  signer = provider.getSigner();
  userAddress = await signer.getAddress();
}

shellElements.forEach((shell) => {
  shell.addEventListener("click", async () => {
    try {
      await init();

      const guess = parseInt(shell.dataset.guess);
      let betAmount = parseFloat(betInput.value);
      if (isNaN(betAmount) || betAmount < 0.001) betAmount = 0.001;

      const contract = new ethers.Contract(shellAddress, window.ShellABI, signer);

      statusEl.innerText = "🎲 Playing...";

      const tx = await contract.play(guess, {
        value: ethers.utils.parseEther(betAmount.toString()),
        gasLimit: 200000, // manual gas limit
      });

      const receipt = await tx.wait();

      // Parse the Played event from the receipt
      const iface = new ethers.utils.Interface(window.ShellABI);
      let playedEvent;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed.name === "Played") {
            playedEvent = parsed.args;
            break;
          }
        } catch (e) {
          // Ignore logs that don't match
        }
      }

      if (!playedEvent) {
        statusEl.innerText = "⚠️ Transaction mined but Played event not found.";
        return;
      }

      const { player, guess: guessEvent, won, winningCup } = playedEvent;

      const resultText = won
        ? `🎉 You won! Your guess: ${guessEvent}, Winning cup: ${winningCup}`
        : `😢 You lost. Your guess: ${guessEvent}, Winning cup: ${winningCup}`;

      statusEl.innerText = resultText;

      const li = document.createElement("li");
      li.innerText = resultText;
      playsEl.prepend(li);

    } catch (err) {
      console.error(err);
      statusEl.innerText = `❌ Error: ${err.message}`;
    }
  });
});

returnBtn.addEventListener("click", () => {
  window.location.href = "../../index.html";
});
