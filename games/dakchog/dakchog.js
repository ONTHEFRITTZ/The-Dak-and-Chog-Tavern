// Dak & Chog coin flip (frontend scaffolding styled like other games)
import { renderTavernBanner, detectChainId, getAddressFor } from '../../js/config.js';
import { attachProvider } from '../../js/contract-utils.js';

const RULES_VERSION = 'v2';
const statusEl = document.getElementById('dc-status');
const coinEl = document.getElementById('coin');
const betInput = document.getElementById('bet');
const flipBtn = document.getElementById('flip');
const chooseDak = document.getElementById('choose-dak');
const chooseChog = document.getElementById('choose-chog');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
const returnBtn = document.getElementById('return');

let provider, signer, wallet;
let choice = 'dak';
let rulesOK = false;

const IMG_DAK = '../../assets/images/coin-dak.png';
const IMG_CHOG = '../../assets/images/coin-chog.png';

function rulesFresh(key) { try { const t = Number(localStorage.getItem(key) || 0); return Date.now() - t < 86400000; } catch { return false; } }

function setChoice(side) {
  choice = side === 'chog' ? 'chog' : 'dak';
  try {
    chooseDak.classList.toggle('active', choice === 'dak');
    chooseChog.classList.toggle('active', choice === 'chog');
  } catch {}
}

function setCoin(side) {
  const img = side === 'chog' ? IMG_CHOG : IMG_DAK;
  coinEl.style.backgroundImage = `url(${img})`;
}

async function ensureWallet() {
  if (!window.ethereum) return;
  try {
    const ethers = window.ethers;
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    wallet = await signer.getAddress();
    try { attachProvider(provider); } catch {}
    try { const chainId = await detectChainId(provider); const addr = await getAddressFor('tavern', provider); renderTavernBanner({ contractKey: 'tavern', address: addr, chainId, wallet }); } catch {}
  } catch {}
}

flipBtn.addEventListener('click', async () => {
  if (!rulesOK) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
  // Simulated flip animation
  try { coinEl.classList.remove('flip'); void coinEl.offsetWidth; coinEl.classList.add('flip'); } catch {}
  const result = Math.random() < 0.5 ? 'dak' : 'chog';
  setTimeout(() => { setCoin(result); }, 380);
  const bet = Number(betInput.value || 0);
  const win = result === choice;
  statusEl.textContent = win ? `Landed on ${result.toUpperCase()} — you won ${bet * 2} MON (simulated).` : `Landed on ${result.toUpperCase()} — you lost.`;
});

chooseDak.addEventListener('click', () => setChoice('dak'));
chooseChog.addEventListener('click', () => setChoice('chog'));
returnBtn?.addEventListener('click', () => { window.location.href = '../../index.html'; });

window.addEventListener('DOMContentLoaded', async () => {
  setCoin('dak');
  setChoice('dak');
  try {
    rulesOK = rulesFresh(`rulesAck.dakchog.${RULES_VERSION}`);
    if (!rulesOK) rulesOverlay.style.display = 'flex';
    rulesAck?.addEventListener('click', () => { rulesOK = true; try { rulesOverlay.style.display = 'none'; } catch {}; try { localStorage.setItem(`rulesAck.dakchog.${RULES_VERSION}`, String(Date.now())); } catch {} });
    openRulesBtn?.addEventListener('click', () => { try { rulesOverlay.style.display = 'flex'; } catch {} });
  } catch {}
  await ensureWallet();
});
