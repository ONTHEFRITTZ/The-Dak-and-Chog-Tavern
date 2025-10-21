import { NextResponse } from "next/server";
import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  concat,
  getAddress,
  hexlify,
  isHexString,
  toBeHex,
  getBytes,
} from "ethers";

const DEFAULT_RPC_URL =
  process.env.MONAD_RPC_URL ??
  process.env.MONAD_RPC ??
  process.env.MONAD_BUNDLER_RPC ??
  "https://testnet-rpc.monad.xyz";

const PAYMASTER_ADDRESS = (process.env.VERIFYING_PAYMASTER_ADDR ??
  process.env.PAYMASTER_ADDRESS ??
  process.env.DCMON_PAYMASTER_ADDR ??
  "0x225526A98049aCAFb71bB9526dd431E1A114E048").toLowerCase();

const SIGNER_PK =
  process.env.VERIFYING_PAYMASTER_SIGNER_PK ??
  process.env.PAYMASTER_SIGNER_PK ??
  process.env.DCMON_PAYMASTER_SIGNER_PK ??
  "";

const PAYMASTER_ABI = [
  "function getHash((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature) userOp,uint48 validUntil,uint48 validAfter) view returns (bytes32)",
] as const;

type UserOperation = {
  sender: string;
  nonce?: string | number | bigint;
  initCode?: string;
  callData?: string;
  callGasLimit?: string | number | bigint;
  verificationGasLimit?: string | number | bigint;
  preVerificationGas?: string | number | bigint;
  maxFeePerGas?: string | number | bigint;
  maxPriorityFeePerGas?: string | number | bigint;
  paymasterAndData?: string;
  signature?: string;
};

const abiCoder = AbiCoder.defaultAbiCoder();

function normalizeHex(value: unknown, fallback = "0x") {
  if (typeof value === "string" && isHexString(value)) return value;
  try {
    const hex = hexlify(value as any);
    return hex ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.floor(value));
  if (typeof value === "string") {
    if (value.startsWith("0x")) return BigInt(value);
    return BigInt(value);
  }
  try {
    return BigInt(value as any);
  } catch {
    return BigInt(0);
  }
}

function normalizeUserOperation(userOp: UserOperation) {
  if (!userOp?.sender) {
    throw new Error("userOperation.sender missing");
  }
  return {
    sender: getAddress(userOp.sender),
    nonce: normalizeBigInt(userOp.nonce ?? 0),
    initCode: normalizeHex(userOp.initCode, "0x"),
    callData: normalizeHex(userOp.callData, "0x"),
    callGasLimit: normalizeBigInt(userOp.callGasLimit ?? 0),
    verificationGasLimit: normalizeBigInt(userOp.verificationGasLimit ?? 0),
    preVerificationGas: normalizeBigInt(userOp.preVerificationGas ?? 0),
    maxFeePerGas: normalizeBigInt(userOp.maxFeePerGas ?? 0),
    maxPriorityFeePerGas: normalizeBigInt(userOp.maxPriorityFeePerGas ?? 0),
    paymasterAndData: normalizeHex("0x", "0x"),
    signature: "0x",
  };
}

function encodeValidityWindow(validUntil: bigint, validAfter: bigint) {
  return abiCoder.encode(["uint48", "uint48"], [validUntil, validAfter]);
}

function buildPaymasterAndData(validUntil: bigint, validAfter: bigint, signature: string) {
  const encoded = encodeValidityWindow(validUntil, validAfter);
  return concat([PAYMASTER_ADDRESS, encoded, signature]);
}

let signerCachePromise: Promise<
  | {
      wallet: Wallet;
      contract: Contract;
    }
  | null
> | null = null;

async function ensureSigner() {
  if (!SIGNER_PK) return null;
  if (!signerCachePromise) {
    signerCachePromise = (async () => {
      try {
        const provider = new JsonRpcProvider(DEFAULT_RPC_URL);
        const wallet = new Wallet(SIGNER_PK, provider);
        const contract = new Contract(PAYMASTER_ADDRESS, PAYMASTER_ABI, provider);
        return { wallet, contract };
      } catch (err) {
        console.error("[paymaster/sign] failed to init signer", err);
        return null;
      }
    })();
  }
  return signerCachePromise;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const userOperation: UserOperation | undefined = body?.userOperation;
    if (!userOperation) {
      return NextResponse.json({ error: "userOperation required" }, { status: 400 });
    }

    const signer = await ensureSigner();
    if (!signer) {
      return NextResponse.json({ error: "Paymaster signer not configured" }, { status: 500 });
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    const validAfter = normalizeBigInt(body?.validAfter ?? 0);
    const validUntil = normalizeBigInt(body?.validUntil ?? now + BigInt(3600));

    const normalized = normalizeUserOperation(userOperation);
    const hash: string = await signer.contract.getHash(normalized, validUntil, validAfter);
    const signature = await signer.wallet.signMessage(getBytes(hash));
    const paymasterAndData = buildPaymasterAndData(validUntil, validAfter, signature);

    return NextResponse.json({
      paymaster: PAYMASTER_ADDRESS,
      paymasterAndData,
      paymasterData: paymasterAndData.slice(42),
      signature,
      validUntil: toBeHex(validUntil),
      validAfter: toBeHex(validAfter),
    });
  } catch (err) {
    console.error("[paymaster/sign] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
