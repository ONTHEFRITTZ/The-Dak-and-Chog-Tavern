const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const pool = process.env.POOL_ADDR;
  if (!pool) throw new Error('Set POOL_ADDR to your BankrollPool address');

  const rakeBps = Number(process.env.POKER_RAKE_BPS || 100);
  const sb = hre.ethers.utils.parseEther(process.env.POKER_SB || "0.001");
  const bb = hre.ethers.utils.parseEther(process.env.POKER_BB || "0.002");

  const Table = await hre.ethers.getContractFactory("PokerTablePool");
  const table = await Table.deploy(pool, rakeBps, sb, bb);
  await table.deployed();
  console.log("PokerTablePool:", table.address);
}

main().catch((e)=>{ console.error(e); process.exit(1); });

