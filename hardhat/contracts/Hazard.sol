// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDCMonBankroll {
    function payDcmon(address to, uint256 amount) external;
    function poolDcmonBalance() external view returns (uint256);
}

/// @title Hazard - DCmon-native Hazard with pooled payouts
contract Hazard {
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

    event HazardPlayed(address indexed player, uint256 wager, bool win, uint8 main, uint8 finalSum, uint8 chance, uint16 iterations);
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
        dcmonToken.safeTransfer(to, amount);
    }

    function setMaxBet(uint256 _max) external onlyOwner { maxBet = _max; }
    function setFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 1000, "fee too high"); feeBps = _bps; }
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0), "zero"); emit OwnershipTransferred(owner, newOwner); owner = newOwner; }
    function setPool(address poolAddr) external onlyOwner { require(poolAddr != address(0), "zero"); pool = IDCMonBankroll(poolAddr); emit PoolUpdated(poolAddr); }

    function _rand(uint256 mod) internal returns (uint256 r) { unchecked { r = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, nonce++))) % mod; } }

    /// main must be 5..9, wager in DCmon units
    function playHazard(uint8 main, uint256 wager) external nonReentrant {
        require(!paused, "paused");
        require(main >= 5 && main <= 9, "bad main");
        require(wager > 0 && wager <= maxBet, "bad wager");
        require(address(pool) != address(0), "pool");

        uint256 fee = (wager * uint256(feeBps)) / 10000;
        feesAccrued += fee;
        uint256 stake = wager - fee;

        dcmonToken.safeTransferFrom(msg.sender, address(this), wager);
        dcmonToken.safeTransfer(address(pool), wager);

        uint8 d1 = uint8(_rand(6) + 1);
        uint8 d2 = uint8(_rand(6) + 1);
        uint8 total = d1 + d2;
        uint8 chance = 0;
        bool win = false;
        uint16 iters = 1;

        if (total == main) {
            win = true;
        } else if (total == 2 || total == 3) {
            win = false;
        } else if (total == 11 || total == 12) {
            if (main == 7) win = false;
            else if (main == 5 || main == 9) win = true;
            else win = false;
        } else {
            chance = total;
            while (true) {
                d1 = uint8(_rand(6) + 1);
                d2 = uint8(_rand(6) + 1);
                total = d1 + d2;
                iters++;
                if (total == chance) { win = true; break; }
                if (total == main) { win = false; break; }
                if (iters > 128) { win = false; break; }
            }
        }

        if (win) {
            uint256 payout = stake * 2;
            require(pool.poolDcmonBalance() >= payout, "bankroll low");
            pool.payDcmon(msg.sender, payout);
        }

        emit HazardPlayed(msg.sender, wager, win, main, total, chance, iters);
    }
}
