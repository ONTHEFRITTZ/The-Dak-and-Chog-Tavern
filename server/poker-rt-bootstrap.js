// Bootstrap loader for Poker RT that repairs accidental literal "\\n" tokens
// introduced by manual edits on some servers. This ensures Node can parse the
// realtime file by writing a fixed copy to a temp location and executing it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, 'poker-rt.js');
const OUT_DIR = path.join(os.tmpdir(), 'dakchog-poker');
const OUT = path.join(OUT_DIR, 'poker-rt.fixed.js');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function fixSource(code) {
  try {
    let out = code;
    // Normalize CRLF to LF to prevent weird diffs across platforms
    out = out.replace(/\r\n/g, '\n');
    // Strong repair: convert ALL literal "\\n" sequences to real newlines.
    // poker-rt.js does not rely on string-embedded "\\n" values, so this is safe.
    out = out.replace(/\\n/g, '\n');
    // Also fix common join_table specific artifact if spacing differs
    out = out.replace(/getTable\(\s*tableId\s*\);\s*\n\s*try/g, 'getTable(tableId);\n      try');
    return out;
  } catch (e) {
    return code;
  }
}

function main() {
  const src = fs.readFileSync(SRC, 'utf8');
  const fixed = fixSource(src);
  // Validate parse before executing
  try { new Function(fixed); } catch (e) { console.error('Poker RT bootstrap parse check failed:', e && e.message); }
  ensureDir(OUT_DIR);
  fs.writeFileSync(OUT, fixed, 'utf8');
  // Execute the fixed file
  require(OUT);
}

main();
