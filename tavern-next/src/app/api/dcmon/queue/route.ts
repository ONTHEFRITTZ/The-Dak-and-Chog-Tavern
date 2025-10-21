import { NextResponse } from "next/server";
import { createRequire } from "module";
import path from "node:path";
import fs from "fs/promises";

export const runtime = "nodejs";

function loadConfig() {
  const require = createRequire(import.meta.url);
  const configPath = path.resolve(process.cwd(), "../server/dcmon/config.js");
  return require(configPath) as { CONFIG: { swapQueueFile?: string } };
}

export async function GET() {
  try {
    const { CONFIG } = loadConfig();
    const queueFile = CONFIG.swapQueueFile as string;
    const raw = await fs.readFile(queueFile, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    console.error("[api] dcmon queue read failed", err);
    return NextResponse.json(
      { error: "Unable to read DCMon swap queue" },
      { status: 500 }
    );
  }
}
