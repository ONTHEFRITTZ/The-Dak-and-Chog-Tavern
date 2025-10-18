// shell.js
// DCMon-enabled Shell game frontend
import { getAddressFor, detectChainId, renderTavernBanner, showToast, CONTRACTS, MONAD } from '../../js/config.js';
import '../../js/DCMonABI.js';
import { attachProvider } from '../../js/contract-utils.js';

async function ensureAAOps() {
  try {
    const tag = encodeURIComponent(window.__BUILD_TAG || Date.now());
    const mod = await import(/* @vite-ignore */ `../../js/aa/ops.js?v=${tag}`);
    return mod;
  } catch (e) {
    return null;
  }
}

const MIN_BET = 0.001; // DCMon units

const formatDcmon = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.000';
  const fixed = num.toFixed(3);
  return fixed === '-0.000' ? '0.000' : fixed;
};

const clampBet = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_BET) return MIN_BET;
  return Math.floor(parsed * 1000 + 1e-9) / 1000;
};

const shellElements = document.querySelectorAll('.shell');
const statusEl = document.getElementById('shell-result') || document.getElementById('status');
const playsEl = document.getElementById('plays');
const returnBtn = document.getElementById('return');
const betInput = document.getElementById('bet');
if (betInput) betInput.value = formatDcmon(clampBet(betInput.value || MIN_BET));
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
let shellAck = true; // rules gate removed

let injectedProvider = null;

function getStoredProviderKey() {
  try { return sessionStorage.getItem('walletProvider') || window.__walletProviderKey || ''; } catch (err) { return ''; }
}

function resolveInjectedProvider() {
  try {
    if (typeof window.__getSelectedProvider === 'function') {
      const resolved = window.__getSelectedProvider();
      if (resolved && typeof resolved.request === 'function') return resolved;
    }
  } catch (err) {}
  try { if (window.__walletProvider && typeof window.__walletProvider.request === 'function') return window.__walletProvider; } catch (err) {}
  try { if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum; } catch (err) {}
  try { if (window.phantom && window.phantom.ethereum && typeof window.phantom.ethereum.request === 'function') return window.phantom.ethereum; } catch (err) {}
  return null;
}

function setShellInteractivity(enabled) {
  try {
    betInput.disabled = !enabled;
  } catch {}
}

let provider;
let signer;
let userAddress;
let tavernAddress;
let activeShellAbi = null;
let dcmonAddress = null;
let dcmonRead = null;
let dcmonToken = null;

async function init() {
  injectedProvider = resolveInjectedProvider();
  if (!injectedProvider) {
    alert('Wallet provider not detected. Connect on the Tavern first.');
    return false;
  }
  try {
    if (typeof window.__setSelectedProvider === 'function') {
      window.__setSelectedProvider(injectedProvider, getStoredProviderKey());
    }
  } catch (err) {}

  provider = new ethers.providers.Web3Provider(injectedProvider, 'any');
  signer = provider.getSigner();
  try { attachProvider(provider); } catch {}
  userAddress = await signer.getAddress();

  // Resolve deployed shell address (preferring overrides if authorized)
  let shellAddr = await getAddressFor('shell', provider);
  try {
    const candidate = (localStorage.getItem('contract.shell')||'').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(candidate)) {
      let poolAddr = await getAddressFor('pool', provider).catch(()=>null);
      if (!poolAddr) {
        try {
          const abi = window.ShellABI || window.TavernABI;
          const tmp = new ethers.Contract(candidate, abi, provider);
          poolAddr = await tmp.pool();
        } catch {}
      }
      let ok = true;
      try {
        if (poolAddr && poolAddr !== ethers.constants.AddressZero && window.PoolABI) {
          const pool = new ethers.Contract(poolAddr, window.PoolABI, provider);
          ok = await pool.authorizedGames(candidate);
        }
      } catch {}
      if (ok) shellAddr = candidate;
    }
  } catch {}

  const tavernFallback = await getAddressFor('tavern', provider);
  tavernAddress = shellAddr || tavernFallback;
  activeShellAbi = (shellAddr && window.ShellABI) ? window.ShellABI : window.TavernABI;

  try {
    const chainId = await detectChainId(provider);
    const bannerKey = shellAddr ? 'shell' : 'tavern';
    renderTavernBanner({ contractKey: bannerKey, address: tavernAddress, chainId, wallet: userAddress });
  } catch {}

  let viewContract = null;
  try {
    const abi = activeShellAbi || window.ShellABI || window.TavernABI;
    viewContract = new ethers.Contract(tavernAddress, abi, provider);
  } catch {}

  // Ensure pool authorization + paused state
  if (viewContract) {
    try {
      let currentPool = ethers.constants.AddressZero;
      try { currentPool = await viewContract.pool(); } catch {}
      if (currentPool && currentPool !== ethers.constants.AddressZero && window.PoolABI) {
        const pool = new ethers.Contract(currentPool, window.PoolABI, provider);
        try {
          const authorized = await pool.authorizedGames(tavernAddress);
          if (!authorized) {
            statusEl.innerText = 'Shell not authorized in Pool. Contact admin.';
            return false;
          }
        } catch {}
        try {
          const paused = await pool.paused();
          if (paused) { statusEl.innerText = 'Pool is paused. Try again later.'; return false; }
        } catch {}
      }
    } catch {}
  }

  // Resolve DCMon token (from contract or config)
  dcmonAddress = null;
  dcmonRead = null;
  dcmonToken = null;
  try {
    let tokenAddr = null;
    if (viewContract && viewContract.dcmonToken) {
      tokenAddr = await viewContract.dcmonToken().catch(() => null);
    }
    if (!tokenAddr || tokenAddr === ethers.constants.AddressZero) {
      tokenAddr = await getAddressFor('dcmon', provider).catch(() => null);
    }
    if (!tokenAddr || tokenAddr === ethers.constants.AddressZero) {
      tokenAddr = CONTRACTS?.dcmon || window?.DCMON_ADDRESS || null;
    }
    if (tokenAddr && /^0x[0-9a-fA-F]{40}$/.test(tokenAddr) && window.DCMonABI) {
      dcmonAddress = tokenAddr;
      dcmonRead = new ethers.Contract(dcmonAddress, window.DCMonABI, provider);
      dcmonToken = new ethers.Contract(dcmonAddress, window.DCMonABI, signer);
    }
  } catch {}

  if (!dcmonAddress || !dcmonToken) {
    statusEl.innerText = 'DCMon token not configured. Contact admin.';
    return false;
  }

  return true;
}

shellElements.forEach((shell) => {
  shell.addEventListener('click', async () => {
    try {
      const ok = await init();
      if (ok === false) return;

      const guessDisplay = parseInt(shell.dataset.guess, 10);
      const guess = Math.max(0, (guessDisplay|0) - 1);
      let betAmount = clampBet(betInput.value);
      betInput.value = formatDcmon(betAmount);

      const abi = activeShellAbi || window.ShellABI || window.TavernABI;
      const contract = new ethers.Contract(tavernAddress, abi, signer);

      if (!dcmonRead || !dcmonToken) {
        statusEl.innerText = 'DCMon token unavailable. Contact admin.';
        return;
      }

      statusEl.innerText = 'Preparing DCMon wager...';
      try { showToast('Preparing DCMon wager...', 'info'); } catch {}

      const betWei = ethers.utils.parseEther(formatDcmon(betAmount));

      // Ensure player balance + allowance
      try {
        const balance = await dcmonRead.balanceOf(userAddress);
        if (balance.lt(betWei)) {
          statusEl.innerText = 'Insufficient DCMon balance for this bet.';
          return;
        }
      } catch {}

      try {
        const allowance = await dcmonRead.allowance(userAddress, tavernAddress).catch(() => ethers.constants.Zero);
        if (allowance.lt(betWei)) {
          statusEl.innerText = 'Approving DCMon...';
          try { showToast('Approving DCMon...', 'info'); } catch {}
          // Try AA path first (gasless)
          let approvedViaAA = false;
          try {
            const ops = await ensureAAOps();
            if (ops && typeof ops.encodeFromSignature === 'function' && typeof ops.sendTxViaAA === 'function') {
              const data = ops.encodeFromSignature('approve(address,uint256)', [tavernAddress, ethers.constants.MaxUint256]);
              const txHash = await ops.sendTxViaAA({ to: dcmonAddress, data });
              if (txHash) {
                try { const rpc=new ethers.providers.JsonRpcProvider(MONAD.rpcHttp); await rpc.waitForTransaction(txHash); } catch {}
                approvedViaAA = true;
              }
            }
          } catch {}
          if (!approvedViaAA) {
            const approval = await dcmonToken.approve(tavernAddress, ethers.constants.MaxUint256);
            await approval.wait();
          }
        }
      } catch (approveErr) {
        const msg = approveErr?.error?.message || approveErr?.data?.message || approveErr?.reason || approveErr?.message || 'Approval failed';
        statusEl.innerText = msg;
        return;
      }

      // Verify pool coverage
      try {
        let okCover = false;
        let coverageVerified = false;
        let poolAddr;
        try { poolAddr = await contract.pool(); } catch {}
        if (!poolAddr || poolAddr === ethers.constants.AddressZero) {
          poolAddr = await getAddressFor('pool', provider).catch(() => null);
        }
        if (poolAddr && poolAddr !== ethers.constants.AddressZero && window.PoolABI) {
          const pool = new ethers.Contract(poolAddr, window.PoolABI, provider);
          try {
            const dcBal = await pool.poolDcmonBalance();
            coverageVerified = true;
            if (dcBal.gte(betWei.mul(2))) okCover = true;
          } catch {}
          if (!okCover) {
            try {
              const underlying = await pool.poolUnderlyingBalance();
              coverageVerified = true;
              if (underlying.gte(betWei.mul(2))) okCover = true;
            } catch {}
          }
        }
        if (!coverageVerified) {
          try {
            const contractBal = await dcmonRead.balanceOf(tavernAddress);
            coverageVerified = true;
            if (contractBal.gte(betWei.mul(2))) okCover = true;
          } catch {}
        }
        if (coverageVerified && !okCover) {
          statusEl.innerText = 'Bankroll too low for this DCMon bet (needs 2x cover). Try a smaller amount.';
          return;
        }
      } catch {}

      // Preflight revert reasons
      try {
        await contract.callStatic.playShell(guess, betWei);
      } catch (pre) {
        const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
        statusEl.innerText = 'Rejected: ' + msg;
        return;
      }

      statusEl.innerText = 'Submitting DCMon wager...';
      try { showToast('Submitting wager...', 'info'); } catch {}

      // Try AA path first (gasless)
      let receipt = null;
      let sentViaAA = false;
      try {
        const ops = await ensureAAOps();
        if (ops && typeof ops.encodeFromSignature === 'function' && typeof ops.sendTxViaAA === 'function') {
          const data = ops.encodeFromSignature('playShell(uint8,uint256)', [guess, betWei]);
          const txHash = await ops.sendTxViaAA({ to: tavernAddress, data });
          if (txHash) {
            sentViaAA = true;
            try { const rpc=new ethers.providers.JsonRpcProvider(MONAD.rpcHttp); receipt = await rpc.waitForTransaction(txHash); } catch {}
          }
        }
      } catch {}
      if (!sentViaAA) { if (window.FORCE_GASLESS) { statusEl.innerText = 'Gasless send unavailable. Try again.'; return; } const tx = await contract.playShell(guess, betWei, { gasLimit: 200000 }); receipt = await tx.wait(); }const iface = new ethers.utils.Interface(activeShellAbi || window.ShellABI || window.TavernABI);
      let playedEvent;
      // Primary: parse logs from receipt (direct sends)
      try {
        if (receipt && Array.isArray(receipt.logs)) {
          for (const log of receipt.logs) {
            try { const parsed = iface.parseLog(log); if (parsed.name === 'ShellPlayed') { playedEvent = parsed.args; break; } } catch {}
          }
        }
      } catch {}
      // Fallback: AA paths sometimes return minimal logs; scan nearby blocks for our event from this contract and player
      if (!playedEvent) {
        try {
          const player = (userAddress || '').toLowerCase();
          const topic0 = iface.getEventTopic('ShellPlayed');
          const fromBlock = Math.max(0, (receipt?.blockNumber || (await provider.getBlockNumber())) - 2);
          const toBlock = receipt?.blockNumber || fromBlock + 2;
          const logs = await provider.getLogs({ address: tavernAddress, fromBlock, toBlock, topics: [topic0] }).catch(()=>[]);
          for (const lg of logs) {
            try {
              const parsed = iface.parseLog(lg);
              const pAddr = (parsed?.args?.player || '').toString().toLowerCase();
              if (parsed.name === 'ShellPlayed' && (!player || pAddr === player)) { playedEvent = parsed.args; break; }
            } catch {}
          }
        } catch {}
      }

      if (!playedEvent) {
        statusEl.innerText = 'Transaction mined but ShellPlayed event not found.';
        try { showToast('Played event not found', 'error'); } catch {}
        return;
      }

      const { guess: guessEvent, won, winningCup } = playedEvent;
      const displayGuess = Number(guessEvent) + 1;
      const displayWin = Number(winningCup) + 1;
      const resultText = won
        ? `You won! Your guess: ${displayGuess}, Winning cup: ${displayWin}`
        : `You lost. Your guess: ${displayGuess}, Winning cup: ${displayWin}`;
      try { showToast(won ? 'You won!' : 'You lost', won ? 'success' : 'info'); } catch {}

      try {
        statusEl.classList.remove('win','lose');
        statusEl.classList.add(won ? 'win' : 'lose');
      } catch {}
      statusEl.innerText = resultText;

      const li = document.createElement('li');
      li.innerText = resultText;
      try { li.style.fontWeight = won ? '700' : '600'; li.style.color = won ? '#9ef89e' : '#f4e6d3'; } catch {}
      playsEl.prepend(li);
    } catch (err) {
      console.error(err);
      const msg = err?.error?.message || err?.data?.message || err?.reason || err?.message || 'Transaction failed.';
      statusEl.innerText = msg;
      try { showToast(msg, 'error'); } catch {}
    }
  });
});

returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });

const onReady = (fn) => { if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', fn, { once: true }); } else { fn(); } };
onReady(async () => {
  try { if (rulesOverlay) rulesOverlay.style.display = 'none'; } catch {}
  try { if (openRulesBtn) openRulesBtn.style.display = 'none'; } catch {}
  await init();
});





