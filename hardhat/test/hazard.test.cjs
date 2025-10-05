const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Hazard (DCmon)', function () {
  it('charges fee and forwards wager to pool', async function () {
    const [deployer, user, house, rewardPool] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const underlying = await MockERC20.deploy('Mock MON', 'MON');
    await underlying.waitForDeployment();

    const DCMon = await ethers.getContractFactory('DCMon');
    const dcmon = await DCMon.deploy(underlying.target, deployer.address, house.address, rewardPool.address);
    await dcmon.waitForDeployment();

    const BankrollPool = await ethers.getContractFactory('BankrollPool');
    const pool = await BankrollPool.deploy(underlying.target, dcmon.target);
    await pool.waitForDeployment();

    const stakeAmount = ethers.parseEther('50');
    await underlying.mint(deployer.address, stakeAmount);
    await underlying.approve(pool.target, stakeAmount);
    await pool.depositUnderlying(stakeAmount);

    const userAmount = ethers.parseEther('5');
    await underlying.mint(user.address, userAmount);
    await underlying.connect(user).approve(dcmon.target, userAmount);
    await dcmon.connect(user).deposit(userAmount, user.address);

    const Hazard = await ethers.getContractFactory('Hazard');
    const hazard = await Hazard.deploy(dcmon.target, pool.target);
    await hazard.waitForDeployment();
    await pool.setAuthorized(hazard.target, true);

    const wager = ethers.parseEther('1');
    await dcmon.connect(user).approve(hazard.target, wager);
    const feeBps = await hazard.feeBps();
    await expect(hazard.connect(user).playHazard(7, wager)).to.emit(hazard, 'HazardPlayed');

    const expectedFee = wager * BigInt(feeBps) / 10000n;
    expect(await hazard.feesAccrued()).to.equal(expectedFee);
    expect(await dcmon.balanceOf(hazard.target)).to.equal(0n);
  });
});
