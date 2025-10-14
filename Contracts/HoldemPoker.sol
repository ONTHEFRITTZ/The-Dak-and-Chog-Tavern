// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDCMonBankroll {
    function payDcmon(address to, uint256 amount) external;
    function poolDcmonBalance() external view returns (uint256);
}

/// @title HoldemPoker - DCmon-native cash-game table without pre-funding
/// @notice Players contribute DCmon per action. Funds flow into the shared
///         BankrollPool and winners are paid out from the pool on settlement.
contract HoldemPoker {
    using SafeERC20 for IERC20;

    // --- Access control ---
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    // --- Reentrancy guard ---
    uint256 private _locked = 1; modifier nonReentrant() { require(_locked==1, "reentrant"); _locked=2; _; _locked=1; }

    // --- Table params ---
    uint8 public constant MAX_SEATS = 6;
    uint16 public rakeBps; // 1 = 0.01%
    uint256 public smallBlind;
    uint256 public bigBlind;
    bool public paused;

    struct Seat { address player; }
    Seat[MAX_SEATS] public seats;

    // --- Hand/session state ---
    uint256 public handId;
    bool public inHand;
    uint8 public dealerSeat;
    uint8 public sbSeat;
    uint8 public bbSeat;
    uint256 public pot; // logical pot tracked during hand (DCmon units)
    uint256 public feesAccrued; // DCmon units owed to the house

    IERC20 public immutable dcmonToken;
    IDCMonBankroll public pool;

    // --- Events ---
    event Paused(bool);
    event RakeUpdated(uint16 bps);
    event BlindsUpdated(uint256 sb, uint256 bb);
    event SeatTaken(address indexed player, uint8 indexed seat, uint256 amount);
    event SeatLeft(address indexed player, uint8 indexed seat, uint256 returnedAmount);
    event Joined(address indexed player, uint8 indexed seat);
    event LeftDuringHand(address indexed player, uint8 indexed seat);
    event HandStarted(uint256 indexed handId, uint8 dealer, uint8 sb, uint8 bb);
    event Contributed(uint256 indexed handId, uint8 indexed seat, uint256 amount);
    event HandSettled(uint256 indexed handId, address[] winners, uint256[] payouts, uint256 rake);
    event PoolUpdated(address indexed pool);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeesWithdrawn(address indexed to, uint256 amount);

    modifier onlySeatHolder(uint8 seatId) {
        require(seatId < MAX_SEATS, "seat");
        require(seats[seatId].player == msg.sender, "seat owner");
        _;
    }

    constructor(address dcmonAddr, address poolAddr) {
        require(dcmonAddr != address(0), "dcmon=0");
        owner = msg.sender;
        dcmonToken = IERC20(dcmonAddr);
        if (poolAddr != address(0)) {
            pool = IDCMonBankroll(poolAddr);
            emit PoolUpdated(poolAddr);
        }

        // Defaults match previous version; can be tweaked off-chain
        rakeBps = 100;                 // 1%
        smallBlind = 1_000_000_000_000_000;   // 0.001 DCmon
        bigBlind   = 2_000_000_000_000_000;   // 0.002 DCmon
    }

    // --- Admin configuration ---
    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }

    function setRakeBps(uint16 bps) external onlyOwner {
        require(bps <= 1_000, "rake too high");
        rakeBps = bps;
        emit RakeUpdated(bps);
    }

    function setBlinds(uint256 sb, uint256 bb) external onlyOwner {
        require(sb > 0 && bb >= sb, "blinds");
        smallBlind = sb;
        bigBlind = bb;
        emit BlindsUpdated(sb, bb);
    }

    function setPool(address poolAddr) external onlyOwner {
        require(poolAddr != address(0), "zero");
        pool = IDCMonBankroll(poolAddr);
        emit PoolUpdated(poolAddr);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero");
        require(amount > 0, "amount=0");
        require(feesAccrued >= amount, "fees low");
        require(address(pool) != address(0), "pool");
        feesAccrued -= amount;
        pool.payDcmon(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    // --- Seat control ---
    function joinSeat(uint8 seatId) external nonReentrant {
        require(!paused, "paused");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == address(0) || s.player == msg.sender, "taken");
        if (s.player == address(0)) {
            s.player = msg.sender;
            emit SeatTaken(msg.sender, seatId, 0);
        }
        emit Joined(msg.sender, seatId);
    }

    function unseat(uint8 seatId) external nonReentrant onlySeatHolder(seatId) {
        require(!inHand, "in hand");
        address pl = seats[seatId].player;
        seats[seatId].player = address(0);
        emit SeatLeft(pl, seatId, 0);
    }

    /// @notice Leave during an active hand, forfeiting any contributed funds.
    function leaveDuringHand(uint8 seatId) external nonReentrant onlySeatHolder(seatId) {
        require(inHand, "no hand");
        seats[seatId].player = address(0);
        emit LeftDuringHand(msg.sender, seatId);
    }

    /// @notice Owner emergency helper to clear a seat if the player is stuck/offline.
    /// @param seatId The seat to clear.
    /// @param duringHand Set true if a hand is currently active and the player must be treated as leaving mid-hand.
    function forceUnseat(uint8 seatId, bool duringHand) external nonReentrant onlyOwner {
        require(seatId < MAX_SEATS, "seat");
        address holder = seats[seatId].player;
        require(holder != address(0), "empty");

        if (duringHand) {
            require(inHand, "no hand");
            seats[seatId].player = address(0);
            emit LeftDuringHand(holder, seatId);
        } else {
            require(!inHand, "in hand");
            seats[seatId].player = address(0);
            emit SeatLeft(holder, seatId, 0);
        }
    }

    // --- Hand lifecycle ---
    function beginHand(uint8 dealer, uint8 sb, uint8 bb) external nonReentrant {
        require(!paused, "paused");
        require(!inHand, "active");
        require(dealer < MAX_SEATS && sb < MAX_SEATS && bb < MAX_SEATS, "pos");
        handId = handId + 1;
        inHand = true;
        dealerSeat = dealer;
        sbSeat = sb;
        bbSeat = bb;
        pot = 0;
        emit HandStarted(handId, dealer, sb, bb);
    }

    /// @notice Player contributes DCmon to the current hand.
    function contribute(uint8 seatId, uint256 amount) external nonReentrant onlySeatHolder(seatId) {
        require(inHand, "no hand");
        require(!paused, "paused");
        require(amount > 0, "amount=0");
        require(address(pool) != address(0), "pool");

        dcmonToken.safeTransferFrom(msg.sender, address(this), amount);
        dcmonToken.safeTransfer(address(pool), amount);
        pot += amount;
        emit Contributed(handId, seatId, amount);
    }

    /// @notice Settle the hand; permissionless orchestrator.
    function settleHand(address[] calldata winners, uint256[] calldata payouts) external nonReentrant {
        require(inHand, "no hand");
        require(address(pool) != address(0), "pool");
        require(winners.length == payouts.length, "len");

        uint256 total;
        for (uint256 i = 0; i < payouts.length; i++) {
            total += payouts[i];
        }

        uint256 rake = (rakeBps > 0) ? (pot * uint256(rakeBps)) / 10_000 : 0;
        require(total + rake <= pot, "exceeds pot");
        feesAccrued += rake;

        uint256 poolBalance = pool.poolDcmonBalance();
        require(poolBalance >= total, "bankroll low");

        for (uint256 i = 0; i < winners.length; i++) {
            uint256 amt = payouts[i];
            if (amt == 0) continue;
            pool.payDcmon(winners[i], amt);
        }

        inHand = false;
        pot = 0;
        emit HandSettled(handId, winners, payouts, rake);
    }
}
