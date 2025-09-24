// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBankrollPoolV4Like {
    function pay(address payable to, uint256 amount) external;
    function balance() external view returns (uint256);
}

/// @title Hazard - Unified Hazard game with pooled payouts
/// @notice Single contract for Hazard. Forwards wagers to the pool and pays winners from the pool.
contract Hazard {
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    uint256 private _locked = 1;

    bool public paused;
    uint256 public maxBet = 10 ether;
    uint16 public feeBps = 100; // 1%
    uint256 public feesAccrued;
    uint256 public nonce;

    IBankrollPoolV4Like public pool;

    event HazardPlayed(
        address indexed player,
        uint256 wager,
        bool win,
        uint8 main,
        uint8 finalSum,
        uint8 chance,
        uint16 iterations
    );
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolUpdated(address indexed pool);

    constructor(address poolAddr) { owner = msg.sender; if (poolAddr != address(0)) pool = IBankrollPoolV4Like(poolAddr); }
    receive() external payable {}
    function fund() external payable {}
    function withdraw(address payable to, uint256 amount) external onlyOwner { require(address(this).balance >= amount, "insufficient"); to.transfer(amount); }
    function withdrawFees(address payable to, uint256 amount) external onlyOwner { require(feesAccrued >= amount, "fees low"); feesAccrued -= amount; to.transfer(amount); }
    function emergencyWithdrawAll(address payable to) external onlyOwner { to.transfer(address(this).balance); feesAccrued = 0; }
    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 1000, "fee too high"); feeBps = _bps; }
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); emit OwnershipTransferred(owner, newOwner); owner = newOwner; }
    function setPool(address poolAddr) external onlyOwner { require(poolAddr != address(0), "zero"); pool = IBankrollPoolV4Like(poolAddr); emit PoolUpdated(poolAddr); }

    function _rand(uint256 mod) internal returns (uint256 r) { unchecked { r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod; } }

    /// @dev Rules per classic Hazard: immediate outcomes on first throw, else establish chance and roll until chance or main resolves.
    /// main must be 5..9.
    function playHazard(uint8 main) external payable nonReentrant {
        require(!paused, "paused");
        require(main >= 5 && main <= 9, "bad main");
        uint256 wager = msg.value; require(wager > 0 && wager <= maxBet, "bad wager");
        uint256 fee = (wager * uint256(feeBps)) / 10000; feesAccrued += fee; uint256 stake = wager - fee;
        require(address(pool) != address(0), "pool");

        uint8 d1 = uint8(_rand(6) + 1); uint8 d2 = uint8(_rand(6) + 1); uint8 total = d1 + d2; // 2..12
        uint8 chance = 0; bool win = false; uint16 iters = 1;

        if (total == main) { win = true; }
        else if (total == 2 || total == 3) { win = false; }
        else if (total == 11 || total == 12) {
            if (main == 7) { win = false; }
            else if (main == 5 || main == 9) { win = true; }
            else { win = false; }
        } else {
            chance = total; // establish chance
            // continue rolling until chance or main appears
            while (true) {
                d1 = uint8(_rand(6) + 1); d2 = uint8(_rand(6) + 1); total = d1 + d2; iters++;
                if (total == chance) { win = true; break; }
                if (total == main) { win = false; break; }
                if (iters > 128) { win = false; break; } // safety cap
            }
        }

        if (win) {
            uint256 payout = stake * 2;
            require(pool.balance() >= payout, "bankroll low");
            pool.pay(payable(msg.sender), payout);
        }

        emit HazardPlayed(msg.sender, wager, win, main, total, chance, iters);
        // send wager to pool
        (bool ok,) = payable(address(pool)).call{value:wager}(""); require(ok, "pool deposit failed");
    }
}
