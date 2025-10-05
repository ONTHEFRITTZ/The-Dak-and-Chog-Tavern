const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const hre = require('hardhat');
  const address = process.env.DCMON_TOKEN_ADDR;
  const underlying = process.env.DCMON_UNDERLYING_ADDR;
  const admin = process.env.DCMON_ADMIN_ADDR;
  const house = process.env.DCMON_HOUSE_TREASURY;
  const playerPool = process.env.DCMON_PLAYER_REWARD_POOL;

  if (!address) throw new Error('Set DCMON_TOKEN_ADDR to verify');
  if (!underlying || !house || !playerPool) {
    throw new Error('Missing env vars for constructor args');
  }

  await hre.run('verify:verify', {
    address,
    constructorArguments: [underlying, admin || house, house, playerPool],
    contract: 'contracts/DCMon.sol:DCMon',
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
