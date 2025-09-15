const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const pool = process.env.POOL_ADDR;
  if (!pool) { throw new Error('Set POOL_ADDR to your BankrollPool address'); }

  const rakeBps = Number(process.env.POKER_RAKE_BPS || 100); // 1%
  const sb = hre.ethers.utils.parseEther(process.env.POKER_SB || "0.001");
  const bb = hre.ethers.utils.parseEther(process.env.POKER_BB || "0.002");

  const Factory = await hre.ethers.getContractFactory("PokerPooledFactory");
  const factory = await Factory.deploy(pool);
  await factory.deployed();
  console.log("PokerPooledFactory:", factory.address);

  const tx = await factory.createTable(rakeBps, sb, bb);
  const rc = await tx.wait();
  const ev = rc.events.find(e => e.event === 'TableCreated');
  const table = ev.args.table;
  console.log("PokerTablePool:", table);
}

main().catch((e)=>{ console.error(e); process.exit(1); });

