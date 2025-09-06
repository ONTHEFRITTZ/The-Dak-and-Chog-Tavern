// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBankrollPoolV4 {
    function pay(address payable to, uint256 amount) external;
    function balance() external view returns (uint256);
}

/// @title FaroV4 - Faro with unified pool payouts and copper support
contract FaroV4 {
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    uint256 private _locked = 1;

    bool public paused;
    uint256 public maxBet = 10 ether;
    uint16 public feeBps = 100; // 1%
    uint256 public feesAccrued;
    uint256 public nonce;

    IBankrollPoolV4 public pool;
    struct PlayLocals { uint256 wager; uint256 fee; uint256 stake; uint8 bankRank; uint8 playerRank; bool push; bool win; }

    event FaroPlayed(address indexed player, uint256 wager, uint256 fee, bool win, bool push, bool copper, uint8 bankRank, uint8 playerRank, uint8 betRank);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolUpdated(address indexed pool);

    constructor(address poolAddr) { owner = msg.sender; if (poolAddr != address(0)) pool = IBankrollPoolV4(poolAddr); }
    receive() external payable {}
    function fund() external payable {}
    function withdraw(address payable to, uint256 amount) external onlyOwner { require(address(this).balance >= amount, "insufficient"); to.transfer(amount); }
    function withdrawFees(address payable to, uint256 amount) external onlyOwner { require(feesAccrued >= amount, "fees low"); feesAccrued -= amount; to.transfer(amount); }
    function emergencyWithdrawAll(address payable to) external onlyOwner { to.transfer(address(this).balance); feesAccrued = 0; }
    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 1000, "fee too high"); feeBps = _bps; }
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); emit OwnershipTransferred(owner, newOwner); owner = newOwner; }
    function setPool(address poolAddr) external onlyOwner { require(poolAddr != address(0), "zero"); pool = IBankrollPoolV4(poolAddr); emit PoolUpdated(poolAddr); }

    function _rand(uint256 mod) internal returns (uint256 r) { unchecked { r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod; } }

    /// @param betRank 1..13 (Ace=1 .. King=13)
    /// @param copper true for bet-against ("brass"), false for standard bet-on
    function playFaro(uint8 betRank, bool copper) external payable nonReentrant {
        require(!paused, "paused");
        require(betRank >= 1 && betRank <= 13, "bad rank");

        // Use a struct declared at contract scope to avoid stack-too-deep
        PlayLocals memory v;

        v.wager = msg.value; require(v.wager > 0 && v.wager <= maxBet, "bad wager");
        v.fee = (v.wager * uint256(feeBps)) / 10000; feesAccrued += v.fee; v.stake = v.wager - v.fee;

        v.bankRank = uint8(_rand(13) + 1); v.playerRank = uint8(_rand(13) + 1);
        v.push = false; v.win = false;

        if (v.bankRank == v.playerRank) {
            // Doublet: house takes half of all bets on that rank
            if (betRank != v.bankRank) {
                v.push = true; // refund stake
                if (v.stake > 0) { require(address(pool) != address(0), "pool"); pool.pay(payable(msg.sender), v.stake); }
            }
        } else {
            bool matchedBank = (betRank == v.bankRank);
            bool matchedPlayer = (betRank == v.playerRank);
            if (!copper) {
                if (matchedPlayer) { v.win = true; uint256 payout = v.stake * 2; require(address(pool) != address(0) && pool.balance() >= payout, "bankroll low"); pool.pay(payable(msg.sender), payout); }
            } else {
                if (matchedBank) { v.win = true; uint256 payout = v.stake * 2; require(address(pool) != address(0) && pool.balance() >= payout, "bankroll low"); pool.pay(payable(msg.sender), payout); }
            }
        }

        emit FaroPlayed(msg.sender, v.wager, v.fee, v.win, v.push, copper, v.bankRank, v.playerRank, betRank);

        // Forward entire wager to pool (unified treasury)
        if (address(pool) != address(0)) { (bool ok,) = payable(address(pool)).call{value:v.wager}(""); require(ok, "pool deposit failed"); }
    }
}
