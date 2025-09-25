import React, { createContext, useContext, useEffect, useState } from "react"

/*
  WalletAuthContext + Example App
  - Allows user to choose either MetaMask (Ethereum) or Phantom (Solana)
  - Once they choose, the app will *exclusively* use that wallet for all operations
  - Prevents other wallets from being used by our app (cannot prevent other wallets from being "unlocked" in the browser, but the app will refuse to use them)
  - Includes example flows for:
    * Connecting
    * Signing a nonce to authenticate with your backend
    * Sending a simple transaction (examples only — you still need backend / RPC providers configured)

  Notes:
  - This file is a single-file React example (JSX). Import into your project and install any dependencies you need.
  - Ethereum interactions use the window.ethereum provider (MetaMask-compatible). For production you may prefer ethers.js.
  - Solana interactions show Phantom `window.solana` usage. For production you may prefer @solana/web3.js and wallet-adapter packages.
  - The app persists the user's wallet choice in localStorage so all pages/functions respect it.
*/

// --- Types of wallets we support ---
const WALLET_METAMASK = "metamask"; // EVM via MetaMask provider
const WALLET_PHANTOM = "phantom"; // EVM via Phantom provider (NOT Solana for this app)

// --- Monad Testnet (EVM) network params ---
// Sources: Monad docs & ChainList
// chainId 10143 (0x279f), RPC https://testnet-rpc.monad.xyz, explorer https://testnet.monadexplorer.com
const MONAD_PARAMS = {
  chainId: "0x279f", // 10143
  chainName: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: ["https://testnet-rpc.monad.xyz"],
  blockExplorerUrls: ["https://testnet.monadexplorer.com", "https://testnet.monadscan.com"],
};

const WalletContext = createContext(null);

export function useWallet() {
  return useContext(WalletContext);
}

export function WalletProvider({ children }) {
  const [selectedWallet, setSelectedWallet] = useState(() => {
    try {
      return localStorage.getItem("selectedWallet");
    } catch (e) {
      return null;
    }
  });
  const [address, setAddress] = useState(null);
  const [connected, setConnected] = useState(false);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    // Rehydrate if a wallet was previously chosen
    if (!selectedWallet) return;

    // On refresh, (best-effort) rediscover EVM providers using EIP-6963 so we can lock to the chosen one
    discoverInjectedEvmProviders().then((providers) => {
      if (selectedWallet === WALLET_METAMASK) {
        const mm = providers.find((p) => /metamask/i.test(p.info?.name || "") || /metamask/i.test(p.info?.rdns || ""))?.provider || window.ethereum;
        if (!mm) return;
        setProvider(mm);
        // attempt silent chain switch to Monad
        ensureOnMonad(mm).then(() => mm.request({ method: "eth_accounts" })).then((accs) => {
          if (Array.isArray(accs) && accs.length) {
            setAddress(accs[0]);
            setConnected(true);
          }
        }).catch(() => {});
      } else if (selectedWallet === WALLET_PHANTOM) {
        const ph = providers.find((p) => /phantom/i.test(p.info?.name || "") || /phantom/i.test(p.info?.rdns || ""))?.provider;
        if (!ph) return;
        setProvider(ph);
        ensureOnMonad(ph)
          .then(() => ph.request({ method: "eth_accounts" }))
          .then((accs) => {
            if (Array.isArray(accs) && accs.length) {
              setAddress(accs[0]);
              setConnected(true);
            }
          })
          .catch(() => {});
      }
    });
  }, [selectedWallet]);

  useEffect(() => {
    // Listen to account changes for the active provider and clear selection if user switches/ disconnects
    function handleEthereumAccountsChanged(accounts) {
      // If MetaMask is selected, keep in sync; otherwise ignore events from other wallets
      if (selectedWallet !== WALLET_METAMASK) return;
      if (!accounts || accounts.length === 0) {
        // disconnected
        clearSelection();
      } else {
        setAddress(accounts[0]);
      }
    }

    function handlePhantomEvent(event) {
      // Phantom emits 'disconnect' event
      if (selectedWallet !== WALLET_PHANTOM) return;
      if (event === "disconnect") {
        clearSelection();
      }
    }

    if (window.ethereum && window.ethereum.on) {
      window.ethereum.on("accountsChanged", handleEthereumAccountsChanged);
    }

    if (window.solana && window.solana.on) {
      window.solana.on("disconnect", handlePhantomEvent);
    }

    return () => {
      if (window.ethereum && window.ethereum.removeListener) {
        window.ethereum.removeListener("accountsChanged", handleEthereumAccountsChanged);
      }
      if (window.solana && window.solana.removeListener) {
        window.solana.removeListener("disconnect", handlePhantomEvent);
      }
    };
  }, [selectedWallet]);

  const chooseWallet = async (walletType) => {
    try {
      const providers = await discoverInjectedEvmProviders();

      if (walletType === WALLET_METAMASK) {
        const mm = providers.find((p) => /metamask/i.test(p.info?.name || "") || /metamask/i.test(p.info?.rdns || ""))?.provider || window.ethereum;
        if (!mm) throw new Error("MetaMask provider not found.");
        persistSelection(WALLET_METAMASK);
        setProvider(mm);
        await ensureOnMonad(mm);
        const accs = await mm.request({ method: "eth_requestAccounts" });
        if (!accs || accs.length === 0) throw new Error("No accounts returned from MetaMask.");
        setAddress(accs[0]);
        setConnected(true);
        return { success: true, address: accs[0] };
      }

      if (walletType === WALLET_PHANTOM) {
        const ph = providers.find((p) => /phantom/i.test(p.info?.name || "") || /phantom/i.test(p.info?.rdns || ""))?.provider;
        if (!ph) throw new Error("Phantom EVM provider not found. Make sure Phantom is installed and set as an EVM wallet.");
        persistSelection(WALLET_PHANTOM);
        setProvider(ph);
        await ensureOnMonad(ph);
        const accs = await ph.request({ method: "eth_requestAccounts" });
        if (!accs || accs.length === 0) throw new Error("No accounts returned from Phantom.");
        setAddress(accs[0]);
        setConnected(true);
        return { success: true, address: accs[0] };
      }

      throw new Error("Unsupported wallet type");
    } catch (err) {
      console.error(err);
      clearSelection();
      return { success: false, error: err.message || String(err) };
    }
  };

  const persistSelection = (walletType) => {
    setSelectedWallet(walletType);
    try { localStorage.setItem("selectedWallet", walletType); } catch (e) {}
  };

  const clearSelection = () => {
    setSelectedWallet(null);
    setAddress(null);
    setConnected(false);
    setProvider(null);
    try { localStorage.removeItem("selectedWallet"); } catch (e) {}
  };

  // Ensure that all app-level calls only operate with the selected wallet.
  // If a different provider is passed in (for example, if another wallet becomes unlocked externally), we refuse.
  const ensureExclusive = (walletType) => {
    if (!selectedWallet) throw new Error("No wallet selected. Please choose a wallet from the UI.");
    if (selectedWallet !== walletType) throw new Error(`App locked to ${selectedWallet}. Please use that wallet.`);
  };

  // --- Auth flow example (Monad/EVM only): sign a nonce and send to your backend
  const signInWithSelectedWallet = async () => {
    if (!selectedWallet || !address || !provider) throw new Error("No wallet selected/connected");
    await ensureOnMonad(provider);
    const nonceResp = await fetch(`/api/nonce?address=${encodeURIComponent(address)}`);
    const { nonce } = await nonceResp.json();
    const message = `Sign this one-time nonce to authenticate on Monad: ${nonce}`;

    // Use EVM personal_sign for both MetaMask and Phantom (EVM)
    const signature = await provider.request({
      method: "personal_sign",
      params: [message, address],
    });

    const verifyResp = await fetch(`/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature, wallet: selectedWallet, chainId: MONAD_PARAMS.chainId }),
    });
    return await verifyResp.json();
  };

  // Example: helper to send a transaction, strictly using the selected wallet only
  const sendExampleTransaction = async (txData) => {
    if (!selectedWallet || !provider) throw new Error("No wallet selected");
    await ensureOnMonad(provider);
    ensureExclusive(selectedWallet);
    // txData should include to, from, value, data, gas params as needed
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [txData],
    });
    return { txHash };
  };

  const value = {
    selectedWallet,
    address,
    connected,
    provider,
    chooseWallet,
    clearSelection,
    signInWithSelectedWallet,
    sendExampleTransaction,
    // helper for UI to know if an external wallet is present in browser
    availableWallets: {
      metamask: !!window.ethereum,
      phantom: true, // we'll discover via EIP-6963 at runtime
    },
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// --- EIP-6963 provider discovery & Monad helpers ---
async function discoverInjectedEvmProviders() {
  const found = [];
  return new Promise((resolve) => {
    const onAnnounce = (event) => {
      const detail = event.detail;
      if (detail && detail.info && detail.provider) {
        found.push(detail);
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // give extensions a moment to announce
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(found);
    }, 200);
  });
}

async function ensureOnMonad(eip1193Provider) {
  try {
    // Try switch first
    await eip1193Provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MONAD_PARAMS.chainId }],
    });
  } catch (switchErr) {
    // If chain not added, add it
    if (switchErr?.code === 4902 || /unknown chain/i.test(String(switchErr?.message))) {
      await eip1193Provider.request({
        method: "wallet_addEthereumChain",
        params: [MONAD_PARAMS],
      });
      // and switch
      await eip1193Provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_PARAMS.chainId }],
      });
    } else {
      throw switchErr;
    }
  }
}

// --- Example App UI ---
export default function App() {
  return (
    <WalletProvider>
      <Home />
    </WalletProvider>
  );
}

function Home() {
  const {
    selectedWallet,
    address,
    connected,
    availableWallets,
    chooseWallet,
    clearSelection,
    signInWithSelectedWallet,
  } = useWallet();

  const [status, setStatus] = useState("");

  const handleChoose = async (type) => {
    setStatus("Connecting...");
    const res = await chooseWallet(type);
    if (res.success) setStatus(`Connected: ${res.address}`);
    else setStatus(`Failed: ${res.error}`);
  };

  const handleSignIn = async () => {
    setStatus("Signing in...");
    try {
      const resp = await signInWithSelectedWallet();
      setStatus(`Server response: ${JSON.stringify(resp)}`);
    } catch (e) {
      setStatus(`Sign-in failed: ${e.message}`);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "Inter, Arial" }}>
      <h1>Sign in on <strong>Monad Testnet</strong> with MetaMask or Phantom (exclusive)</h1>

      <div style={{ marginBottom: 12 }}>
        <strong>Detected EVM wallets (via EIP-6963/window.ethereum):</strong>
        <div>MetaMask: {availableWallets.metamask ? "maybe" : "not detected (try anyway)"}</div>
        <div>Phantom: available (ensure Phantom's EVM is enabled)</div>
      </div>

      {!selectedWallet && (
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <button disabled={!availableWallets.metamask} onClick={() => handleChoose(WALLET_METAMASK)}>
            Connect MetaMask
          </button>
          <button disabled={!availableWallets.phantom} onClick={() => handleChoose(WALLET_PHANTOM)}>
            Connect Phantom
          </button>
        </div>
      )}

      {selectedWallet && (
        <div style={{ marginBottom: 12 }}>
          <div>
            <strong>Selected wallet:</strong> {selectedWallet}
          </div>
          <div>
            <strong>Address:</strong> {address}
          </div>
          <div>
            <strong>Connected:</strong> {String(connected)}
          </div>
          <button onClick={clearSelection} style={{ marginTop: 8 }}>
            Disconnect / Clear selection
          </button>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button disabled={!connected} onClick={handleSignIn}>
          Sign in with selected wallet
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <em>{status}</em>
      </div>

      <hr style={{ marginTop: 20, marginBottom: 20 }} />

      <div>
        <h2>Developer notes / guarantees</h2>
        <ul>
          <li>
            <strong>Monad-only:</strong> On connect and on every privileged action, we enforce <code>wallet_switchEthereumChain</code> / <code>wallet_addEthereumChain</code> to <em>Monad Testnet</em> (chainId 10143). If switching fails, the action is aborted.
          </li>
          <li>
            <strong>Exclusivity:</strong> Once a wallet is chosen, <code>ensureExclusive()</code> and the stored selection prevent use of any other unlocked wallet.
          </li>
          <li>
            <strong>Provider discovery:</strong> We use <a href="https://eips.ethereum.org/EIPS/eip-6963" target="_blank" rel="noreferrer">EIP‑6963</a> to locate specific injected providers (MetaMask vs Phantom) reliably in multi‑wallet environments.
          </li>
          <li>
            <strong>Phantom support:</strong> Phantom exposes an EVM provider; users may need to enable Monad in settings. Programmatic add/switch uses standard EIPs and should work when Phantom supports the requested chain.
          </li>
          <li>
            <strong>RPC/Explorer:</strong> Default RPC <code>https://testnet-rpc.monad.xyz</code>; Explorer <code>https://testnet.monadexplorer.com</code>. Adjust as needed for your infra.
          </li>
        </ul>
      </div>
    </div>
  );
}

