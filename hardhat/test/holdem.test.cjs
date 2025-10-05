const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('HoldemPoker (DCmon)', function () {
  it('tracks DCmon contributions, settles hands, and withdraws rake', async function () {
    const [deployer, player1, player2, house, rewardPool] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const underlying = await MockERC20.deploy('Mock MON', 'MON');
    await underlying.waitForDeployment();

    const DCMon = await ethers.getContractFactory('DCMon');
    const dcmon = await DCMon.deploy(underlying.target, deployer.address, house.address, rewardPool.address);
    await dcmon.waitForDeployment();

    const BankrollPool = await ethers.getContractFactory('BankrollPool');
    const pool = await BankrollPool.deploy(underlying.target, dcmon.target);
    await pool.waitForDeployment();

    const stakeAmount = ethers.parseEther('200');
    await underlying.mint(deployer.address, stakeAmount);
    await underlying.approve(pool.target, stakeAmount);
    await pool.depositUnderlying(stakeAmount);

    const playerBudget = ethers.parseEther('10');
    for (const player of [player1, player2]) {
      await underlying.mint(player.address, playerBudget);
      await underlying.connect(player).approve(dcmon.target, playerBudget);
      await dcmon.connect(player).deposit(playerBudget, player.address);
    }

    const HoldemPoker = await ethers.getContractFactory('HoldemPoker');
    const holdem = await HoldemPoker.deploy(dcmon.target, pool.target);
    await holdem.waitForDeployment();
    await pool.setAuthorized(holdem.target, true);

    await holdem.connect(player1).joinSeat(0);
    await holdem.connect(player2).joinSeat(1);

    const initialPoolBalance = await dcmon.balanceOf(pool.target);

    await holdem.beginHand(0, 0, 1);

    const bet = ethers.parseEther('1');
    await dcmon.connect(player1).approve(holdem.target, bet);
    await dcmon.connect(player2).approve(holdem.target, bet);

    const player1BalanceBefore = await dcmon.balanceOf(player1.address);
    const player2BalanceBefore = await dcmon.balanceOf(player2.address);

    await holdem.connect(player1).contribute(0, bet);
    await holdem.connect(player2).contribute(1, bet);

    expect(await holdem.pot()).to.equal(bet * 2n);

    const midPoolBalance = await dcmon.balanceOf(pool.target);
    expect(midPoolBalance).to.equal(initialPoolBalance + bet * 2n);

    const rakeBps = await holdem.rakeBps();
    const pot = bet * 2n;
    const rake = pot * BigInt(rakeBps) / 10_000n;
    const payout = pot - rake;

    const currentHand = await holdem.handId();

    await expect(holdem.settleHand([player1.address], [payout]))
      .to.emit(holdem, 'HandSettled')
      .withArgs(currentHand, [player1.address], [payout], rake);

    expect(await holdem.inHand()).to.equal(false);
    expect(await holdem.pot()).to.equal(0n);
    expect(await holdem.feesAccrued()).to.equal(rake);

    const player1BalanceAfter = await dcmon.balanceOf(player1.address);
    const player2BalanceAfter = await dcmon.balanceOf(player2.address);

    expect(player1BalanceAfter).to.equal(player1BalanceBefore - bet + payout);
    expect(player2BalanceAfter).to.equal(player2BalanceBefore - bet);

    const poolBalanceAfter = await dcmon.balanceOf(pool.target);
    expect(poolBalanceAfter).to.equal(initialPoolBalance + rake);

    await expect(holdem.withdrawFees(deployer.address, rake))
      .to.emit(holdem, 'FeesWithdrawn')
      .withArgs(deployer.address, rake);

    expect(await holdem.feesAccrued()).to.equal(0n);
    expect(await dcmon.balanceOf(deployer.address)).to.equal(rake);
  });
});
