const fs = require('fs/promises');
const path = require('path');

async function removeDir(target) {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function copySolidity(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copySolidity(from, to);
    } else if (entry.isFile() && entry.name.endsWith('.sol')) {
      await fs.copyFile(from, to);
    }
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const sourceDir = path.resolve(root, '..', 'Contracts');
  const destDir = path.resolve(root, 'contracts');
  await removeDir(destDir);
  await copySolidity(sourceDir, destDir);
  console.log(`[sync-contracts] copied Solidity sources from ${sourceDir} to ${destDir}`);
}

main().catch((err) => {
  console.error('[sync-contracts] failed:', err);
  process.exit(1);
});
