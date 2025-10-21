declare module "https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.13.0/dist/index.mjs" {
  export const Implementation: {
    MultiSig?: unknown;
    Stateless7702?: unknown;
    Hybrid?: unknown;
  };
  export function toMetaMaskSmartAccount(config: Record<string, unknown>): Promise<unknown>;
}
