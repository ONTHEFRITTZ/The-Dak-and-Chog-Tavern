const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const rakeBps = Number(process.env.POKER_RAKE_BPS || 100); // 1%
  const sb = hre.ethers.utils.parseEther(process.env.POKER_SB || "0.001");
  const bb = hre.ethers.utils.parseEther(process.env.POKER_BB || "0.002");

  const PokerFactory = await hre.ethers.getContractFactory("PokerFactory");
  const factory = await PokerFactory.deploy();
  await factory.deployed();
  console.log("PokerFactory:", factory.address);

  const tx = await factory.createTable(rakeBps, sb, bb);
  const rc = await tx.wait();
  const ev = rc.events.find(e => e.event === 'TableCreated');
  const table = ev.args.table;
  console.log("PokerTable:", table);
}

main().catch((e)=>{ console.error(e); process.exit(1); });

