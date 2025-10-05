const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('DakChog (DCmon)', function () {
  it('forwards wagers to the pool, accrues fees, and withdraws rake in DCmon', async function () {
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

    const stakeAmount = ethers.parseEther('100');
    await underlying.mint(deployer.address, stakeAmount);
    await underlying.approve(pool.target, stakeAmount);
    await pool.depositUnderlying(stakeAmount);

    const userAmount = ethers.parseEther('5');
    await underlying.mint(user.address, userAmount);
    await underlying.connect(user).approve(dcmon.target, userAmount);
    await dcmon.connect(user).deposit(userAmount, user.address);

    const DakChog = await ethers.getContractFactory('DakChog');
    const dakchog = await DakChog.deploy(dcmon.target, pool.target);
    await dakchog.waitForDeployment();
    await pool.setAuthorized(dakchog.target, true);

    const wager = ethers.parseEther('1');
    await dcmon.connect(user).approve(dakchog.target, wager);

    const feeBps = await dakchog.feeBps();
    const fee = wager * BigInt(feeBps) / 10_000n;
    const stake = wager - fee;

    const poolBalanceBefore = await dcmon.balanceOf(pool.target);
    const userBalanceBefore = await dcmon.balanceOf(user.address);

    const tx = await dakchog.connect(user).playCoin(true, wager);
    const receipt = await tx.wait();

    const parsed = receipt.logs
      .map((log) => {
        try { return dakchog.interface.parseLog(log); } catch (err) { return null; }
      })
      .filter(Boolean)
      .find((log) => log.name === 'CoinPlayed');

    expect(parsed).to.not.be.undefined;
    const won = parsed.args.won;

    expect(await dakchog.feesAccrued()).to.equal(fee);

    const poolBalanceAfter = await dcmon.balanceOf(pool.target);
    const expectedPoolBalance = won
      ? poolBalanceBefore + wager - (stake * 2n)
      : poolBalanceBefore + wager;
    expect(poolBalanceAfter).to.equal(expectedPoolBalance);

    const userBalanceAfter = await dcmon.balanceOf(user.address);
    const expectedUserBalance = won
      ? userBalanceBefore - wager + (stake * 2n)
      : userBalanceBefore - wager;
    expect(userBalanceAfter).to.equal(expectedUserBalance);

    const ownerBalanceBefore = await dcmon.balanceOf(deployer.address);
    await dakchog.withdrawFees(deployer.address, fee);
    expect(await dakchog.feesAccrued()).to.equal(0n);
    expect(await dcmon.balanceOf(deployer.address)).to.equal(ownerBalanceBefore + fee);
  });
});
