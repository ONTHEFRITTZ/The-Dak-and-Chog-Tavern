const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const pool = process.env.POOL;
  if (!pool) throw new Error('Set POOL env to BankrollPool address');
  const Shell = await hre.ethers.getContractFactory('Shell');
  const shell = await Shell.deploy(pool);
  await shell.deployed();
  console.log("Shell deployed:", shell.address);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

