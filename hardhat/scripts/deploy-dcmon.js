const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const hre = require('hardhat');
  const { ethers } = hre;

  const underlying = process.env.DCMON_UNDERLYING_ADDR;
  const admin = process.env.DCMON_ADMIN_ADDR;
  const house = process.env.DCMON_HOUSE_TREASURY;
  const playerPool = process.env.DCMON_PLAYER_REWARD_POOL;

  if (!underlying || !house || !playerPool) {
    throw new Error('Missing env vars: DCMON_UNDERLYING_ADDR, DCMON_HOUSE_TREASURY, DCMON_PLAYER_REWARD_POOL');
  }

  const [deployer] = await ethers.getSigners();
  const adminAddr = admin || deployer.address;

  console.log('Deploying DCMon with params:', {
    underlying,
    admin: adminAddr,
    house,
    playerPool,
    deployer: deployer.address,
  });

  const factory = await ethers.getContractFactory('DCMon');
  const dcmon = await factory.deploy(underlying, adminAddr, house, playerPool);
  await dcmon.waitForDeployment();

  const address = dcmon.target;
  console.log(`DCMon deployed at ${address}`);

  const outDir = path.resolve(__dirname, '..', 'deployments');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `dcmon-${hre.network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ address, network: hre.network.name, timestamp: new Date().toISOString() }, null, 2));
  console.log(`Saved deployment info to ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
