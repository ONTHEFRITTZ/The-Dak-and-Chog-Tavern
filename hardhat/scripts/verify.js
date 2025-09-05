const hre = require('hardhat');

async function main() {
  const addr = process.env.CONTRACT_ADDRESS;
  if (!addr) throw new Error('Set CONTRACT_ADDRESS in env');
  await hre.run('verify:verify', {
    address: addr,
    constructorArguments: []
  });
}

main().catch((e) => { console.error(e); process.exit(1); });

