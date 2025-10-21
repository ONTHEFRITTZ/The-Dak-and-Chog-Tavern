const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const bal = await deployer.getBalance();
  console.log("Deployer balance:", hre.ethers.utils.formatEther(bal));

  const Faro = await hre.ethers.getContractFactory("Faro");
  const faro = await Faro.deploy();
  await faro.deployed();
  console.log("Faro deployed at:", faro.address);

  // Optional: set initial rake to 1% and fund a small bankroll if desired
  // const tx1 = await faro.setFeeBps(100); await tx1.wait();
  // const tx2 = await deployer.sendTransaction({ to: faro.address, value: hre.ethers.utils.parseEther('1') }); await tx2.wait();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

