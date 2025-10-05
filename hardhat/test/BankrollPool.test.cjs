const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('BankrollPool with DCmon', function () {
  let deployer, game, user, house, rewardPool;
  let underlying, dcmon, bankroll;

  beforeEach(async function () {
    [deployer, game, user, house, rewardPool] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    underlying = await MockERC20.deploy('Mock MON', 'MON');
    await underlying.waitForDeployment();

    const DCMon = await ethers.getContractFactory('DCMon');
    dcmon = await DCMon.deploy(underlying.target, deployer.address, house.address, rewardPool.address);
    await dcmon.waitForDeployment();

    const BankrollPool = await ethers.getContractFactory('BankrollPool');
    bankroll = await BankrollPool.deploy(underlying.target, dcmon.target);
    await bankroll.waitForDeployment();

    // Seed underlying balance for owner
    const initial = ethers.parseEther('100');
    await underlying.mint(deployer.address, initial);
  });

  it('stakes underlying into DCmon and pays players in DCmon', async function () {
    const stakeAmount = ethers.parseEther('50');
    await underlying.approve(bankroll.target, stakeAmount);
    await expect(bankroll.depositUnderlying(stakeAmount)).to.emit(bankroll, 'Deposited');

    await bankroll.setAuthorized(game.address, true);

    const payAmount = ethers.parseEther('10');
    await expect(bankroll.connect(game).payDcmon(user.address, payAmount))
      .to.emit(bankroll, 'Paid').withArgs(user.address, payAmount, game.address, true);

    expect(await dcmon.balanceOf(user.address)).to.equal(payAmount);
  });

  it('allows native payouts for legacy games', async function () {
    await bankroll.setAuthorized(game.address, true);
    const fundAmount = ethers.parseEther('1');
    await deployer.sendTransaction({ to: bankroll.target, value: fundAmount });

    const payAmount = ethers.parseEther('0.2');
    await expect(bankroll.connect(game).payNative(user.address, payAmount))
      .to.emit(bankroll, 'Paid').withArgs(user.address, payAmount, game.address, false);
  });
});
