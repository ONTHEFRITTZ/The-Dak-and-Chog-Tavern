const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const Tavern = await hre.ethers.getContractFactory("TavernV2");
  const tavern = await Tavern.deploy();
  await tavern.deployed();
  console.log("TavernV2 deployed at:", tavern.address);
}

main().catch((e)=>{ console.error(e); process.exitCode = 1; });

