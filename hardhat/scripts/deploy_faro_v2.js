const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const Faro = await hre.ethers.getContractFactory("FaroV2");
  const faro = await Faro.deploy();
  await faro.deployed();
  console.log("FaroV2 deployed at:", faro.address);
}

main().catch((e)=>{ console.error(e); process.exitCode = 1; });

