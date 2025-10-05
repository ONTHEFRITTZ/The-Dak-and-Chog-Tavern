const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('DCMon', function () {
  let deployer, alice, house, playerPool;
  let underlying, dcmon;

  beforeEach(async function () {
    [deployer, alice, house, playerPool] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    underlying = await MockERC20.deploy('Mock MON', 'MON');
    await underlying.waitForDeployment();

    const DCMon = await ethers.getContractFactory('DCMon');
    dcmon = await DCMon.deploy(underlying.target, deployer.address, house.address, playerPool.address);
    await dcmon.waitForDeployment();

    const initial = ethers.parseEther('100');
    await underlying.mint(alice.address, initial);
    await underlying.mint(deployer.address, initial);
  });

  it('mints DCmon on deposit and burns on redeem', async function () {
    const depositAmount = ethers.parseEther('25');
    await underlying.connect(alice).approve(dcmon.target, depositAmount);
    await expect(dcmon.connect(alice).deposit(depositAmount, alice.address))
      .to.emit(dcmon, 'Deposited');

    expect(await dcmon.balanceOf(alice.address)).to.equal(depositAmount);
    expect(await underlying.balanceOf(dcmon.target)).to.equal(depositAmount);

    await expect(dcmon.connect(alice).redeem(depositAmount, alice.address))
      .to.emit(dcmon, 'Withdrawn');

    expect(await dcmon.balanceOf(alice.address)).to.equal(0);
    expect(await underlying.balanceOf(dcmon.target)).to.equal(0);
  });

  it('splits recorded rewards 70/30 between house and player pool', async function () {
    const reward = ethers.parseEther('30');
    await underlying.approve(dcmon.target, reward);
    await expect(dcmon.recordRewards(reward))
      .to.emit(dcmon, 'RewardsRecorded');

    const houseShare = (reward * 70n) / 100n;
    const playerShare = reward - houseShare;
    expect(await underlying.balanceOf(house.address)).to.equal(houseShare);
    expect(await underlying.balanceOf(playerPool.address)).to.equal(playerShare);
  });
});
