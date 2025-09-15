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
    // Targeted repair: replace a literal "\\n" token that may appear between
    // getTable(tableId); and try { ... } after misguided sed edits
    out = out.replace(/getTable\(\s*tableId\s*\);\\n\s*try/g, 'getTable(tableId);\n      try');
    // As a safety net, if an unintentional literal "\\n" slipped elsewhere in
    // this file (not inside strings), a global replace is acceptable here since
    // this runtime file does not rely on string-embedded newlines.
    out = out.replace(/;\\n\s*try/g, ';\n      try');
    return out;
  } catch (e) {
    return code;
  }
}

function main() {
  const src = fs.readFileSync(SRC, 'utf8');
  const fixed = fixSource(src);
  ensureDir(OUT_DIR);
  fs.writeFileSync(OUT, fixed, 'utf8');
  // Execute the fixed file
  require(OUT);
}

main();

