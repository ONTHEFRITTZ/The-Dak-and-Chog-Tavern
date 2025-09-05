const fs = require('fs');
const path = require('path');

async function main() {
  const hre = require('hardhat');
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying with:', deployer.address);
  console.log('Network:', await deployer.getChainId());

  const Tavern = await hre.ethers.getContractFactory('Tavern');
  const tavern = await Tavern.deploy();
  await tavern.deployed();
  console.log('Tavern deployed to:', tavern.address);

  // Write address snapshot for frontend consumption
  const out = {
    chainId: await deployer.getChainId(),
    tavern: tavern.address,
    updatedAt: new Date().toISOString()
  };
  const outDir = path.join(__dirname, '..', '..');
  const jsDir = path.join(outDir, 'js');
  if (!fs.existsSync(jsDir)) fs.mkdirSync(jsDir, { recursive: true });
  fs.writeFileSync(path.join(jsDir, 'addresses.local.json'), JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

