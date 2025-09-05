const { expect } = require('chai');

describe('Faro', function () {
  it('deploys and takes rake, emits event', async function () {
    const [user] = await ethers.getSigners();
    const Faro = await ethers.getContractFactory('Faro');
    const faro = await Faro.deploy();
    await faro.deployed();

    // fund bankroll
    await user.sendTransaction({ to: faro.address, value: ethers.utils.parseEther('1') });

    const feeBps = await faro.feeBps();
    expect(feeBps).to.equal(100);

    const wager = ethers.utils.parseEther('0.01');
    const tx = await faro.playFaro(7, { value: wager });
    const rc = await tx.wait();
    const ev = rc.events.find(e => e.event === 'FaroPlayed');
    expect(ev.args.player).to.equal(user.address);
    expect(ev.args.wager).to.equal(wager);
    // fee recorded
    const fee = ev.args.fee;
    expect(fee).to.equal(wager.mul(feeBps).div(10000));
    const feesAccrued = await faro.feesAccrued();
    expect(feesAccrued).to.equal(fee);
  });
});

