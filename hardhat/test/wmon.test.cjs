const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('WMON', function () {
  it('wraps and unwraps native MON while supporting ERC-20 semantics', async function () {
    const [alice, bob] = await ethers.getSigners();
    const WMON = await ethers.getContractFactory('WMON');
    const wmon = await WMON.deploy();
    await wmon.waitForDeployment();

    const wrapAmount = ethers.parseEther('5');
    await expect(alice.sendTransaction({ to: wmon.target, value: wrapAmount }))
      .to.emit(wmon, 'Deposit')
      .withArgs(alice.address, wrapAmount);

    expect(await wmon.balanceOf(alice.address)).to.equal(wrapAmount);
    expect(await wmon.totalSupply()).to.equal(wrapAmount);

    const transferAmount = ethers.parseEther('1');
    await wmon.connect(alice).approve(bob.address, transferAmount);
    await expect(wmon.connect(bob).transferFrom(alice.address, bob.address, transferAmount))
      .to.emit(wmon, 'Transfer')
      .withArgs(alice.address, bob.address, transferAmount);

    expect(await wmon.balanceOf(bob.address)).to.equal(transferAmount);
    expect(await wmon.balanceOf(alice.address)).to.equal(wrapAmount - transferAmount);

    const bobBalanceBefore = await ethers.provider.getBalance(bob.address);
    const tx = await wmon.connect(bob).withdraw(transferAmount);
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;

    expect(await wmon.balanceOf(bob.address)).to.equal(0n);

    const bobBalanceAfter = await ethers.provider.getBalance(bob.address);
    expect(bobBalanceAfter).to.equal(bobBalanceBefore + transferAmount - gasCost);

    const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);
    const tx2 = await wmon.connect(alice).withdraw(wrapAmount - transferAmount);
    const receipt2 = await tx2.wait();
    const gasCost2 = receipt2.gasUsed * receipt2.gasPrice;

    expect(await wmon.totalSupply()).to.equal(0n);

    const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);
    expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + wrapAmount - transferAmount - gasCost2);
  });
});
