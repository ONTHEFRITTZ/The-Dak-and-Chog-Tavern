const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const pool = process.env.POOL;
  if (!pool) throw new Error('Set POOL env to BankrollPool address');
  const Faro = await hre.ethers.getContractFactory('Faro');
  const faro = await Faro.deploy(pool);
  await faro.deployed();
  console.log("Faro deployed:", faro.address);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

