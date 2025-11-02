import { defineChain, type Address } from "viem";

const DEFAULT_MONAD_RPC = process.env.NEXT_PUBLIC_MONAD_RPC ?? "https://testnet-rpc.monad.xyz";
const DEFAULT_MONAD_WS = process.env.NEXT_PUBLIC_MONAD_WS ?? "wss://testnet-rpc.monad.xyz/ws";

export const MONAD = {
  id: 10143,
  name: "Monad Testnet",
  rpcHttp: DEFAULT_MONAD_RPC,
  explorer: "https://testnet.monadexplorer.com",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
};

const MONAD_ALCHEMY_BASE = deriveAlchemyRpcBase(
  process.env.NEXT_PUBLIC_MONAD_BUNDLER_RPC ??
    process.env.NEXT_PUBLIC_ALCHEMY_BUNDLER_RPC
);

export const MONAD_CHAIN = defineChain({
  id: MONAD.id,
  name: MONAD.name,
  nativeCurrency: MONAD.nativeCurrency,
  rpcUrls: {
    default: { http: [DEFAULT_MONAD_RPC] },
    public: { http: [DEFAULT_MONAD_RPC] },
    alchemy: {
      http: MONAD_ALCHEMY_BASE
        ? [MONAD_ALCHEMY_BASE]
        : [
            process.env.NEXT_PUBLIC_ALCHEMY_BUNDLER_RPC ??
              process.env.NEXT_PUBLIC_MONAD_BUNDLER_RPC ??
              DEFAULT_MONAD_RPC,
          ],
    },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: MONAD.explorer },
  },
});

export const RPC_ENDPOINTS: Record<number, string> = {
  [MONAD.id]: DEFAULT_MONAD_WS,
};

export const EXPLORERS: Record<number, string> = {
  [MONAD.id]: MONAD.explorer,
};

export const PAYMASTER_ADDRESS: Address =
  (process.env.NEXT_PUBLIC_PAYMASTER_ADDRESS as Address) ??
  ("0x225526A98049aCAFb71bB9526dd431E1A114E048" as const);

export const MONAD_BUNDLER_RPC =
  process.env.NEXT_PUBLIC_MONAD_BUNDLER_RPC ??
  process.env.NEXT_PUBLIC_ALCHEMY_BUNDLER_RPC ??
  "";

export const ALCHEMY_PAYMASTER_RPC =
  process.env.NEXT_PUBLIC_ALCHEMY_PAYMASTER_RPC ??
  "";

export const ALCHEMY_POLICY_ID =
  process.env.NEXT_PUBLIC_ALCHEMY_POLICY_ID ?? "";

export const ALCHEMY_API_KEY =
  process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "";

export const ZERO_DEV_PROJECT_ID =
  process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? "";

export const CONTRACTS = {
  pool: "0x31574064907cbE75C61Fea28C545264817A9AA4a" as Address,
  wmon: "0x7b4E8B2a3E934701D8bF6cFB31C3f3BDaC5e30Ff" as Address,
  dcmon: "0x3AcbbD49603D8140C0acbf13E3471DBF691b2Bd7" as Address,
  hazard: "0xb0103807b4B758945331BF6783873Cd776037f89" as Address,
  shell: "0x7Ff5A1b0d71eE4C66D24121D2E68D7844704D377" as Address,
  dakchog: "0xa8F48cccE4968F5bf40f3411B2265cEBDB517ADf" as Address,
  pokerTable: "0x424F89FE230331df8f656B683812b6394c323f17" as Address,
  blackjack:
    ((process.env.NEXT_PUBLIC_BLACKJACK_ADDRESS as Address) ??
      "0xbB6f4D4902418E414Ca62F883123437fFf4C6e5E") as Address,
} as const;

export const ADDRESS_BOOK: Record<string, Partial<typeof CONTRACTS>> = {
  [String(MONAD.id)]: { ...CONTRACTS },
  default: { ...CONTRACTS },
};

export const ADMIN_ADDRESS =
  (process.env.NEXT_PUBLIC_ADMIN_ADDRESS as Address | undefined)?.toLowerCase() ?? null;

export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  5: "Goerli",
  10: "Optimism",
  56: "BSC",
  100: "Gnosis",
  137: "Polygon",
  8453: "Base",
  84532: "Base Sepolia",
  42161: "Arbitrum One",
  43114: "Avalanche",
  11155111: "Sepolia",
  [MONAD.id]: MONAD.name,
};

export function getChainName(chainId?: number | string | null) {
  if (chainId == null) return "Unknown";
  const id = Number(chainId);
  return CHAIN_NAMES[id] ?? `Chain ${id}`;
}

export function getAddress(contractKey: keyof typeof CONTRACTS, chainId?: number | string | null) {
  const key = chainId != null ? String(Number(chainId)) : "default";
  const overrides = ADDRESS_BOOK[key] ?? ADDRESS_BOOK.default;
  return overrides?.[contractKey] ?? CONTRACTS[contractKey];
}

export function explorerAddressUrl(chainId: number | string | null, address?: Address | null) {
  if (!address) return undefined;
  const base = EXPLORERS[Number(chainId)];
  return base ? `${base}/address/${address}` : undefined;
}

function deriveAlchemyRpcBase(url?: string | null) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.search = "";
    // Normalise anything past /v2 to the root /v2 path expected by the SDK schema.
    parsed.pathname = parsed.pathname.replace(/\/v2.*/i, "/v2");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
