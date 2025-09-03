// games/hazard/hazard.js
// Full replacement — UI follows contract rules, listens for HazardPlayed event.
// Uses window.HazardABI and ethers UMD (window.ethers).

const hazardAddress = "0x9cedd769cd1CD5cC52D8b3c46ec31c61b7c5dE10"; // set to correct Hazard contract address
const diceFacesUnicode = ["⚀","⚁","⚂","⚃","⚄","⚅"];
const diceImages = [
  '../../assets/images/dice1.png',
  '../../assets/images/dice2.png',
  '../../assets/images/dice3.png',
  '../../assets/images/dice4.png',
  '../../assets/images/dice5.png',
  '../../assets/images/dice6.png'
];

let provider, signer, contract;
let selectedMain = 7;

// DOM
const statusEl = document.getElementById("status");
const rollBtn = document.getElementById("roll-dice");
const dice1El = document.getElementById("dice1");
const dice2El = document.getElementById("dice2");
const betInput = document.getElementById("bet");
const returnBtn = document.getElementById("return");
const rollsList = document.getElementById("rolls");
const mainButtons = document.querySelectorAll(".main-select button");

// Utility: split finalSum into a valid dice pair (1..6, sum = finalSum)
// returns [d1,d2] choosing a random valid pair if multiple exist.
function splitSumToDice(sum) {
  const pairs = [];
  for (let d1 = 1; d1 <= 6; d1++) {
    const d2 = sum - d1;
    if (d2 >= 1 && d2 <= 6) pairs.push([d1, d2]);
  }
  if (pairs.length === 0) return [1,1];
  return pairs[Math.floor(Math.random()*pairs.length)];
}

// Display dice (use images if present, otherwise unicode)
function displayDice(d1, d2) {
  const imgPathsExist = !!diceImages[0]; // we assume they exist in assets; if not, unicode shows
  if (dice1El) {
    if (imgPathsExist) {
      dice1El.style.backgroundImage = `url(${diceImages[d1-1]})`;
      dice1El.style.backgroundSize = 'contain';
      dice1El.textContent = '';
    } else {
      dice1El.style.backgroundImage = '';
      dice1El.textContent = diceFacesUnicode[d1-1];
    }
  }
  if (dice2El) {
    if (imgPathsExist) {
      dice2El.style.backgroundImage = `url(${diceImages[d2-1]})`;
      dice2El.style.backgroundSize = 'contain';
      dice2El.textContent = '';
    } else {
      dice2El.style.backgroundImage = '';
      dice2El.textContent = diceFacesUnicode[d2-1];
    }
  }
}

// Animate dice visually for ~1 second
function animateDice() {
  const el1 = dice1El, el2 = dice2El;
  el1.classList.add('shake');
  el2.classList.add('shake');
  let frames = 10;
  const iv = setInterval(() => {
    const r1 = Math.floor(Math.random()*6)+1;
    const r2 = Math.floor(Math.random()*6)+1;
    displayDice(r1,r2);
    frames--;
    if (frames <= 0) {
      clearInterval(iv);
      el1.classList.remove('shake');
      el2.classList.remove('shake');
    }
  }, 100);
}

// Explain outcome according to contract rules (human readable)
function explainOutcome(main, finalSum, chance, win) {
  main = Number(main);
  finalSum = Number(finalSum);
  chance = Number(chance);

  if (chance === 0) {
    if (finalSum === main) return `Immediate win — rolled your main (${main}).`;
    if (finalSum === 2 || finalSum === 3) return `Immediate loss — rolled ${finalSum}.`;
    if (finalSum === 11 || finalSum === 12) {
      if (main === 7) return `Immediate loss — rolled ${finalSum} and main was 7.`;
      if (main === 5 || main === 9) return `Immediate win — rolled ${finalSum} (special for main ${main}).`;
      return `Immediate loss — rolled ${finalSum}.`;
    }
    return `Point established at ${finalSum}. Game continued until point or main resolved.`;
  } else {
    if (finalSum === chance) return `Won by hitting the chance/point (${chance}).`;
    if (finalSum === main) return `Lost — rolled your main (${main}) before hitting the point (${chance}).`;
    return `Resolved with roll ${finalSum}.`;
  }
}

// Hook main selection buttons
mainButtons.forEach(btn => {
  const m = Number(btn.dataset.main);
  if (m === selectedMain) btn.classList.add('active');
  btn.addEventListener('click', () => {
    mainButtons.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selectedMain = m;
  });
});

// Initialize provider/signers and attach handlers
window.addEventListener('DOMContentLoaded', async () => {
  // Only allow play if Tavern connected — check sessionStorage flag if you use it
  const walletFlag = sessionStorage.getItem("walletConnected");
  if (!window.ethereum || walletFlag !== "true") {
    statusEl.innerText = "Connect wallet on Tavern first!";
    rollBtn.disabled = true;
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    signer = provider.getSigner();
    contract = new ethers.Contract(hazardAddress, window.HazardABI, signer);
  } catch (err) {
    console.error("Init error:", err);
    statusEl.innerText = "Error initializing contract: " + err.message;
    rollBtn.disabled = true;
    return;
  }

  // Event listener (HazardPlayed)
  contract.on("HazardPlayed", async (player, wager, win, main, finalSum, chance, iterations) => {
    try {
      const user = (await signer.getAddress()).toLowerCase();
      if (player.toLowerCase() !== user) return; // only show result for this user

      // compute dice faces from finalSum (choose a valid pair)
      const [d1,d2] = splitSumToDice(Number(finalSum));
      displayDice(d1,d2);

      const payout = win ? ethers.utils.formatEther(wager.mul(2)) : "0";
      const explanation = explainOutcome(Number(main), Number(finalSum), Number(chance), win);

      statusEl.innerText = win ? `🎉 You won ${payout} MON! ${explanation}` : `😢 You lost. ${explanation}`;

      const li = document.createElement('li');
      li.innerText = `${new Date().toLocaleTimeString()} - Bet: ${ethers.utils.formatEther(wager)} MON - ${win ? "Won" : "Lost"} (Main:${main}, FinalSum:${finalSum}, Iter:${iterations})`;
      rollsList.prepend(li);

      rollBtn.disabled = false;
    } catch (err) {
      console.error("Event handler error:", err);
    }
  });

  // Roll button handler
  rollBtn.addEventListener('click', async () => {
    if (!signer || !contract) {
      alert("Connect wallet on Tavern first!");
      return;
    }

    const bet = document.getElementById('bet').value;
    if (!bet || Number(bet) <= 0) {
      statusEl.innerText = "Enter a valid bet amount.";
      return;
    }
    if (!Number.isInteger(selectedMain) || selectedMain < 5 || selectedMain > 9) {
      statusEl.innerText = "Choose a main between 5 and 9.";
      return;
    }

    statusEl.innerText = "🎲 Rolling dice — sending transaction...";
    rollBtn.disabled = true;

    // animate locally while tx mines
    animateDice();

    try {
      const tx = await contract.play(selectedMain, { value: ethers.utils.parseEther(bet) });
      await tx.wait(); // wait for mining — final result will be emitted in HazardPlayed event
      // message will be updated by the event handler
    } catch (err) {
      console.error("Play error:", err);
      // display useful messages if present
      const pretty = err?.data?.message || err?.message || String(err);
      statusEl.innerText = "❌ Error: " + pretty;
      rollBtn.disabled = false;
    }
  });

  // Return button
  returnBtn.addEventListener('click', () => {
    window.location.href = "../../index.html";
  });

}); // DOMContentLoaded end
