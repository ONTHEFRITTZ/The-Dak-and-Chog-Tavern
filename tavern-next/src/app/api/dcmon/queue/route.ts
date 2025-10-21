import { NextResponse } from "next/server";
import { createRequire } from "module";
import fs from "fs/promises";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CONFIG } = require("../../../../../server/dcmon/config");

export async function GET() {
  try {
    const path = CONFIG.swapQueueFile as string;
    const raw = await fs.readFile(path, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    console.error("[api] dcmon queue read failed", err);
    return NextResponse.json(
      { error: "Unable to read DCMon swap queue" },
      { status: 500 }
    );
  }
}
