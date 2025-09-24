const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const pool = process.env.POOL;
  if (!pool) throw new Error('Set POOL env to BankrollPool address');
  const DakChog = await hre.ethers.getContractFactory('DakChog');
  const dak = await DakChog.deploy(pool);
  await dak.deployed();
  console.log("DakChog deployed:", dak.address);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

