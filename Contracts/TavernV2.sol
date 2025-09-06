// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TavernV2 {
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    uint256 private _locked = 1;

    bool public paused;
    uint256 public maxBet = 10 ether;
    uint256 public nonce;

    event ShellPlayed(address indexed player, uint256 wager, bool won, uint8 winningCup, uint8 guess);
    event HazardPlayed(address indexed player, uint256 wager, bool win, uint8 main, uint8 finalSum, uint8 chance, uint8 iterations);
    event CoinPlayed(address indexed player, uint256 wager, bool won, bool resultChog);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() { owner = msg.sender; }

    receive() external payable {}
    function fund() external payable {}
    function withdraw(address payable to, uint256 amount) external onlyOwner { require(address(this).balance >= amount, "insufficient"); to.transfer(amount); }
    function emergencyWithdrawAll(address payable to) external onlyOwner { to.transfer(address(this).balance); }
    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); emit OwnershipTransferred(owner, newOwner); owner = newOwner; }

    function _rand(uint256 mod) internal returns (uint256 r) { unchecked { r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod; } }
    function _rollSum() internal returns (uint8) { uint8 d1 = uint8(_rand(6) + 1); uint8 d2 = uint8(_rand(6) + 1); return d1 + d2; }

    function playShell(uint8 guess) external payable nonReentrant {
        require(!paused, "paused"); require(guess < 3, "bad guess");
        uint256 wager = msg.value; require(wager > 0 && wager <= maxBet, "bad wager"); require(address(this).balance >= wager * 2, "bankroll low");
        uint8 winningCup = uint8(_rand(3)); bool won = (winningCup == guess);
        if (won) { payable(msg.sender).transfer(wager * 2); }
        emit ShellPlayed(msg.sender, wager, won, winningCup, guess);
    }
    function playHazard(uint8 main) external payable nonReentrant {
        require(!paused, "paused"); require(main >= 5 && main <= 9, "bad main");
        uint256 wager = msg.value; require(wager > 0 && wager <= maxBet, "bad wager"); require(address(this).balance >= wager * 2, "bankroll low");
        uint8 sum = _rollSum(); uint8 chance = 0; uint8 iterations = 1; bool win;
        if (sum == main) { win = true; }
        else if (sum == 2 || sum == 3) { win = false; }
        else if (sum == 11 || sum == 12) { if (main == 7) win = false; else if (main == 5 || main == 9) win = true; else win = false; }
        else { chance = sum; for (uint8 i = 0; i < 64; i++) { sum = _rollSum(); iterations++; if (sum == chance) { win = true; break; } if (sum == main) { win = false; break; } } }
        if (win) { payable(msg.sender).transfer(wager * 2); }
        emit HazardPlayed(msg.sender, wager, win, main, sum, chance, iterations);
    }
    function playCoin(bool chooseChog) external payable nonReentrant {
        require(!paused, "paused"); uint256 wager = msg.value; require(wager > 0 && wager <= maxBet, "bad wager"); require(address(this).balance >= wager * 2, "bankroll low");
        bool resultChog = (_rand(2) == 1); bool won = (resultChog == chooseChog); if (won) { payable(msg.sender).transfer(wager * 2); }
        emit CoinPlayed(msg.sender, wager, won, resultChog);
    }
}

