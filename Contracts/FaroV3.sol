// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FaroV3 - Faro with on-chain copper (bet-against) and doublet half-loss
/// @notice Development randomness; consider VRF/commit-reveal for production fairness.
contract FaroV3 {
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    uint256 private _locked = 1;

    bool public paused;
    uint256 public maxBet = 10 ether;
    uint16 public feeBps = 100; // 1%
    uint256 public feesAccrued;
    uint256 public nonce;

    event FaroPlayed(address indexed player, uint256 wager, uint256 fee, bool win, bool push, bool copper, uint8 bankRank, uint8 playerRank, uint8 betRank);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() { owner = msg.sender; }
    receive() external payable {}
    function fund() external payable {}
    function withdraw(address payable to, uint256 amount) external onlyOwner { require(address(this).balance >= amount, "insufficient"); to.transfer(amount); }
    function withdrawFees(address payable to, uint256 amount) external onlyOwner { require(feesAccrued >= amount, "fees low"); feesAccrued -= amount; to.transfer(amount); }
    function emergencyWithdrawAll(address payable to) external onlyOwner { to.transfer(address(this).balance); feesAccrued = 0; }
    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 1000, "fee too high"); feeBps = _bps; }
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); emit OwnershipTransferred(owner, newOwner); owner = newOwner; }

    function _rand(uint256 mod) internal returns (uint256 r) { unchecked { r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod; } }

    /// @param betRank 1..13 (Ace=1 .. King=13)
    /// @param copper true for bet-against ("brass"), false for standard bet-on
    function playFaro(uint8 betRank, bool copper) external payable nonReentrant {
        require(!paused, "paused");
        require(betRank >= 1 && betRank <= 13, "bad rank");
        uint256 wager = msg.value; require(wager > 0 && wager <= maxBet, "bad wager");
        uint256 fee = (wager * uint256(feeBps)) / 10000; feesAccrued += fee; uint256 stake = wager - fee;

        uint8 bankRank = uint8(_rand(13) + 1); uint8 playerRank = uint8(_rand(13) + 1);
        bool push = false; bool win = false;

        if (bankRank == playerRank) {
            // Doublet: house takes half of all bets on that rank
            if (betRank == bankRank) {
                // Lose half stake
                // (no transfer needed; funds remain in contract)
            } else {
                push = true; // others unaffected
                if (stake > 0) payable(msg.sender).transfer(stake);
            }
        } else {
            bool matchedBank = (betRank == bankRank);
            bool matchedPlayer = (betRank == playerRank);
            if (!copper) {
                if (matchedPlayer) { win = true; uint256 payout = stake * 2; require(address(this).balance >= payout, "bankroll low"); payable(msg.sender).transfer(payout); }
                else if (matchedBank) { win = false; }
            } else {
                // Against: opposite outcome
                if (matchedBank) { win = true; uint256 payout = stake * 2; require(address(this).balance >= payout, "bankroll low"); payable(msg.sender).transfer(payout); }
                else if (matchedPlayer) { win = false; }
            }
        }

        emit FaroPlayed(msg.sender, wager, fee, win, push, copper, bankRank, playerRank, betRank);
    }
}

