import { detectChainId, getAddressFor, renderTavernBanner } from '../../js/config.js';
import { signer as exportedSigner, provider as exportedProvider } from '../../js/tavern.js';

const statusEl = document.getElementById('faro-status');
const returnBtn = document.getElementById('return');
const playBtn = document.getElementById('play');
const betInput = document.getElementById('bet');
const rankGrid = document.getElementById('rank-grid');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesOpen = document.getElementById('open-rules');
const rulesAck = document.getElementById('rules-ack');

let provider = exportedProvider;
let signer = exportedSigner;
let wallet;
let faro;
let chosenRank = 1;

function buildRanks() {
  for (let r = 1; r <= 13; r++) {
    const b = document.createElement('button');
    b.textContent = String(r);
    b.setAttribute('aria-label', 'Rank ' + r);
    b.onclick = () => { chosenRank = r; highlight(); };
    rankGrid.appendChild(b);
  }
  highlight();
}

function highlight() {
  const btns = Array.from(rankGrid.querySelectorAll('button'));
  btns.forEach((b, i) => b.style.boxShadow = (i+1) === chosenRank ? '0 0 0 2px #7800cd' : 'none');
}

async function initContract() {
  try {
    const ethers = window.ethers;
    // Re-resolve in case wallet just connected
    provider = exportedProvider || provider;
    signer = exportedSigner || signer;
    if (!provider && window.ethereum) {
      provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      signer = provider.getSigner();
    }
    if (signer) { wallet = await signer.getAddress().catch(()=>null); }
    const chainId = await detectChainId(provider);
    const faroAddr = await getAddressFor('faro', provider);
    renderTavernBanner({ contractKey: 'faro', address: faroAddr, chainId, wallet });
    if (faroAddr && window.FaroABI && signer) {
      faro = new ethers.Contract(faroAddr, window.FaroABI, signer);
    }
  } catch {}
}

playBtn.addEventListener('click', async () => {
  const ethers = window.ethers;
  const bet = Number(betInput.value || 0);
  if (!faro) { statusEl.textContent = 'Faro contract not configured or wallet not connected.'; return; }
  if (!(bet > 0)) { statusEl.textContent = 'Enter a valid bet.'; return; }
  try {
    statusEl.textContent = 'Submitting transaction…';
    const tx = await faro.playFaro(chosenRank, { value: ethers.utils.parseEther(String(bet)) });
    statusEl.textContent = `Tx sent: ${tx.hash.slice(0,10)}… waiting confirmation…`;
    const rc = await tx.wait();
    let ev = rc.events?.find(e => e.event === 'FaroPlayed');
    if (ev && ev.args) {
      const win = !!ev.args.win;
      const push = !!ev.args.push;
      const bank = Number(ev.args.bankRank);
      const player = Number(ev.args.playerRank);
      const fee = ev.args.fee;
      const feeEth = Number(ethers.utils.formatEther(fee));
      if (push) statusEl.textContent = `Push (doublet). Bank=${bank}, Player=${player}. Rake taken: ${feeEth} ETH.`;
      else if (win) statusEl.textContent = `You won! Bank=${bank}, Player=${player}. Rake: ${feeEth} ETH.`;
      else statusEl.textContent = `You lost. Bank=${bank}, Player=${player}. Rake: ${feeEth} ETH.`;
    } else {
      statusEl.textContent = 'Confirmed. Check explorer for details.';
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = e?.data?.message || e?.message || 'Transaction failed.';
  }
});

returnBtn?.addEventListener('click', () => { window.location.href = '../../index.html'; });

// Rules overlay (reference only)
rulesOpen?.addEventListener('click', () => { try { rulesOverlay.style.display = 'flex'; } catch {} });
rulesAck?.addEventListener('click', () => { try { rulesOverlay.style.display = 'none'; } catch {} });

window.addEventListener('DOMContentLoaded', async () => {
  buildRanks();
  await initContract();
});

