// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Faro - Minimal on-chain Faro game with rake
/// @notice Development-grade randomness; not suitable for production without VRF or commit-reveal.
/// Game model (simplified):
/// - Player places a wager on a rank 1..13 (Ace=1, ..., King=13).
/// - House draws two ranks pseudo-randomly: bankRank then playerRank.
/// - If betRank == bankRank => player loses the wager (house keeps it).
/// - If betRank == playerRank => player wins 1:1 on the effective wager (wager minus rake).
/// - If bankRank == playerRank (doublet) => push: refund the effective wager.
/// - Rake: feeBps (basis points) is taken from every wager and accumulated for the house.
contract Faro {
    // --- Admin / Ownable ---
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    // --- Reentrancy guard ---
    uint256 private _locked = 1;
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }

    // --- Config ---
    uint256 public maxBet = 10 ether;
    uint16 public feeBps = 100; // 1.00% rake by default (100 bps)
    uint256 public feesAccrued; // in wei
    uint256 public nonce;

    // --- Events ---
    event FaroPlayed(
        address indexed player,
        uint256 wager,
        uint256 fee,
        bool win,
        bool push,
        uint8 bankRank,
        uint8 playerRank,
        uint8 betRank
    );

    constructor() { owner = msg.sender; }

    // --- Admin functions ---
    receive() external payable {}
    function fund() external payable {}
    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 1000, "fee too high"); feeBps = _bps; }
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient");
        to.transfer(amount);
    }
    function withdrawFees(address payable to, uint256 amount) external onlyOwner {
        require(feesAccrued >= amount, "fees low");
        feesAccrued -= amount;
        to.transfer(amount);
    }

    // --- Internal randomness (development only) ---
    function _rand(uint256 mod) internal returns (uint256 r) {
        unchecked {
            r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod;
        }
    }

    // --- Game ---
    // betRank in [1..13]
    function playFaro(uint8 betRank) external payable nonReentrant {
        require(betRank >= 1 && betRank <= 13, "bad rank");
        uint256 wager = msg.value;
        require(wager > 0 && wager <= maxBet, "bad wager");

        // Take rake
        uint256 fee = (wager * uint256(feeBps)) / 10000;
        feesAccrued += fee;
        uint256 stake = wager - fee; // effective stake used for payout or refund

        // Draw ranks
        uint8 bankRank = uint8(_rand(13) + 1);
        uint8 playerRank = uint8(_rand(13) + 1);

        bool push = false;
        bool win = false;

        if (bankRank == playerRank) {
            // doublet => push (refund stake)
            push = true;
            if (stake > 0) {
                payable(msg.sender).transfer(stake);
            }
        } else if (betRank == bankRank) {
            // lose all (house keeps stake)
            win = false;
        } else if (betRank == playerRank) {
            // win 1:1 on stake
            win = true;
            uint256 payout = stake * 2; // return stake + win equal to stake
            require(address(this).balance >= payout, "bankroll low");
            payable(msg.sender).transfer(payout);
        } else {
            // neither matched; lose
            win = false;
        }

        emit FaroPlayed(msg.sender, wager, fee, win, push, bankRank, playerRank, betRank);
    }
}

