const hre = require("hardhat");

function env(name, fallback) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env ${name}`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const chainId = await deployer.getChainId();
  console.log("ChainId:", chainId);

  const poolAddr = env('POOL');
  console.log("Using BankrollPool:", poolAddr);

  const Faro = await hre.ethers.getContractFactory('Faro');
  const Shell = await hre.ethers.getContractFactory('Shell');
  const DakChog = await hre.ethers.getContractFactory('DakChog');

  const faro = await Faro.deploy(poolAddr);
  await faro.deployed();
  console.log("Faro deployed:", faro.address);

  const shell = await Shell.deploy(poolAddr);
  await shell.deployed();
  console.log("Shell deployed:", shell.address);

  const dakchog = await DakChog.deploy(poolAddr);
  await dakchog.deployed();
  console.log("DakChog deployed:", dakchog.address);

  console.log("DONE", { chainId, pool: poolAddr, faro: faro.address, shell: shell.address, dakchog: dakchog.address });
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

