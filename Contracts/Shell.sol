// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBankrollPool {
    function pay(address payable to, uint256 amount) external;
    function balance() external view returns (uint256);
}

/// @title Shell - Three-cup shell game with pooled payouts
contract Shell {
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    uint256 private _locked = 1;

    bool public paused;
    uint256 public maxBet = 10 ether;
    uint16 public feeBps = 100; // 1%
    uint256 public feesAccrued;
    uint256 public nonce;

    IBankrollPool public pool;

    event ShellPlayed(address indexed player, uint256 wager, uint256 fee, bool won, uint8 winningCup, uint8 guess);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolUpdated(address indexed pool);

    constructor(address poolAddr) {
        require(poolAddr != address(0), "pool");
        owner = msg.sender;
        pool = IBankrollPool(poolAddr);
    }
    receive() external payable {}
    function fund() external payable {}
    function withdraw(address payable to, uint256 amount) external onlyOwner { require(address(this).balance >= amount, "insufficient"); to.transfer(amount); }
    function withdrawFees(address payable to, uint256 amount) external onlyOwner { require(feesAccrued >= amount, "fees low"); feesAccrued -= amount; to.transfer(amount); }
    function emergencyWithdrawAll(address payable to) external onlyOwner { to.transfer(address(this).balance); feesAccrued = 0; }
    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 1000, "fee too high"); feeBps = _bps; }
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); emit OwnershipTransferred(owner, newOwner); owner = newOwner; }
    function setPool(address poolAddr) external onlyOwner { require(poolAddr != address(0), "zero"); pool = IBankrollPool(poolAddr); emit PoolUpdated(poolAddr); }

    function _rand(uint256 mod) internal returns (uint256 r) { unchecked { r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod; } }

    /// @param guess 0..2 (cup index)
    function playShell(uint8 guess) external payable nonReentrant {
        require(!paused, "paused");
        require(guess < 3, "bad guess");
        uint256 wager = msg.value; require(wager > 0 && wager <= maxBet, "bad wager");
        uint256 fee = (wager * uint256(feeBps)) / 10000; feesAccrued += fee; uint256 stake = wager - fee;
        require(address(pool) != address(0), "pool");

        uint8 winningCup = uint8(_rand(3));
        bool won = (winningCup == guess);
        if (won) {
            uint256 payout = stake * 2;
            require(pool.balance() >= payout, "bankroll low");
            pool.pay(payable(msg.sender), payout);
        }

        emit ShellPlayed(msg.sender, wager, fee, won, winningCup, guess);
        (bool ok,) = payable(address(pool)).call{value:wager}(""); require(ok, "pool deposit failed");
    }
}
