// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDCMonBankroll {
    function payDcmon(address to, uint256 amount) external;
    function poolDcmonBalance() external view returns (uint256);
}

/// @title DakChog - DCmon-native coin flip with pooled payouts
contract DakChog {
    using SafeERC20 for IERC20;

    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    uint256 private _locked = 1;

    bool public paused;
    uint256 public maxBet = 10 ether; // DCmon units
    uint16 public feeBps = 100; // 1%
    uint256 public feesAccrued;
    uint256 public nonce;

    IERC20 public immutable dcmonToken;
    IDCMonBankroll public pool;

    event CoinPlayed(address indexed player, uint256 wager, uint256 fee, bool won, bool resultChog, bool chooseChog);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolUpdated(address indexed pool);

    constructor(address dcmonAddr, address poolAddr) {
        require(dcmonAddr != address(0), "dcmon=0");
        owner = msg.sender;
        dcmonToken = IERC20(dcmonAddr);
        if (poolAddr != address(0)) pool = IDCMonBankroll(poolAddr);
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        require(feesAccrued >= amount, "fees low");
        feesAccrued -= amount;
        require(address(pool) != address(0), "pool");
        pool.payDcmon(to, amount);
    }

    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 1000, "fee too high"); feeBps = _bps; }
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); emit OwnershipTransferred(owner, newOwner); owner = newOwner; }
    function setPool(address poolAddr) external onlyOwner { require(poolAddr != address(0), "zero"); pool = IDCMonBankroll(poolAddr); emit PoolUpdated(poolAddr); }

    function _rand(uint256 mod) internal returns (uint256 r) { unchecked { r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod; } }

    /// @param chooseChog true to pick Chog; false picks Dak
    /// @param wager DCmon amount (18 decimals)
    function playCoin(bool chooseChog, uint256 wager) external nonReentrant {
        require(!paused, "paused");
        require(address(pool) != address(0), "pool");
        require(wager > 0 && wager <= maxBet, "bad wager");

        uint256 fee = (wager * uint256(feeBps)) / 10000;
        feesAccrued += fee;
        uint256 stake = wager - fee;

        dcmonToken.safeTransferFrom(msg.sender, address(this), wager);
        dcmonToken.safeTransfer(address(pool), wager);

        bool resultChog = (_rand(2) == 1);
        bool won = (resultChog == chooseChog);
        if (won) {
            uint256 payout = stake * 2;
            require(pool.poolDcmonBalance() >= payout, "bankroll low");
            pool.payDcmon(msg.sender, payout);
        }

        emit CoinPlayed(msg.sender, wager, fee, won, resultChog, chooseChog);
    }
}
