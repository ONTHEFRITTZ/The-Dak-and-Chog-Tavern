const { expect } = require('chai');

describe('Tavern', function () {
  it('deploys and plays shell', async function () {
    const Tavern = await ethers.getContractFactory('Tavern');
    const tavern = await Tavern.deploy();
    await tavern.deployed();

    const [user] = await ethers.getSigners();
    const wager = ethers.utils.parseEther('0.01');
    // fund the contract so it can pay out
    await user.sendTransaction({ to: tavern.address, value: ethers.utils.parseEther('1') });

    const tx = await tavern.playShell(1, { value: wager });
    const rc = await tx.wait();
    const ev = rc.events.find(e => e.event === 'ShellPlayed');
    expect(ev.args.player).to.equal(user.address);
    expect(ev.args.wager).to.equal(wager);
  });
});

