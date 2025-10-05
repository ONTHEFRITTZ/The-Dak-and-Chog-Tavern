const { expect } = require('chai');

describe('Faro (DCmon)', function () {
  it('plays a hand using DCmon and records fees', async function () {
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

    const depositUser = ethers.parseEther('5');
    await underlying.mint(user.address, depositUser);
    await underlying.connect(user).approve(dcmon.target, depositUser);
    await dcmon.connect(user).deposit(depositUser, user.address);

    const Faro = await ethers.getContractFactory('Faro');
    const faro = await Faro.deploy(dcmon.target, pool.target);
    await faro.waitForDeployment();
    await pool.setAuthorized(faro.target, true);

    const wager = ethers.parseEther('1');
    await dcmon.connect(user).approve(faro.target, wager);
    await expect(faro.connect(user).playFaro(7, false, wager)).to.emit(faro, 'FaroPlayed');

    const feeExpected = wager * BigInt(await faro.feeBps()) / 10000n;
    expect(await faro.feesAccrued()).to.equal(feeExpected);
    expect(await dcmon.balanceOf(pool.target)).to.be.gte(wager);
  });
});
