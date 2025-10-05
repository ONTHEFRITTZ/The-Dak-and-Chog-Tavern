// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title DCmon (Dak & Chog Monad LST)
 * @notice Liquid staking token that wraps the MON asset (or another base token)
 *         and routes staking yield according to the house/player split.
 * @dev    This contract intentionally keeps staking logic abstract. For the
 *         first version we rely on an external operator (agent) to deposit
 *         MON into the staking venue and sweep harvested rewards back into
 *         this contract via `recordRewards`. When a native staking integrator
 *         becomes available we can extend the hooks.
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract DCMon is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Underlying token that users deposit (native MON ERC-20)
    IERC20 public immutable underlying;

    /// @notice Address that receives 70% of staking rewards (house treasury)
    address public houseTreasury;

    /// @notice Address that accumulates the 30% player reward budget
    address public playerRewardPool;

    /// @notice 70/30 split expressed in basis points (7000 / 3000)
    uint256 public constant HOUSE_BPS = 7000;
    uint256 public constant PLAYER_BPS = 3000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    event HouseTreasuryUpdated(address indexed previous, address indexed next);
    event PlayerRewardPoolUpdated(address indexed previous, address indexed next);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 underlyingAmount, uint256 burnedShares);
    event RewardsRecorded(uint256 amountUnderlying, uint256 housePortion, uint256 playerPortion);
    event PlayerRewardsDistributed(address indexed to, uint256 amountUnderlying, bytes32 memo);

    constructor(
        IERC20 _underlying,
        address _admin,
        address _houseTreasury,
        address _playerRewardPool
    ) ERC20("Dak & Chog Monad LST", "DCmon") {
        require(address(_underlying) != address(0), "DCmon: underlying=0");
        require(_admin != address(0), "DCmon: admin=0");
        require(_houseTreasury != address(0), "DCmon: house=0");
        require(_playerRewardPool != address(0), "DCmon: rewardPool=0");

        underlying = _underlying;
        houseTreasury = _houseTreasury;
        playerRewardPool = _playerRewardPool;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    // ------------------------------------------------------------------------
    // Admin configuration
    // ------------------------------------------------------------------------

    function setHouseTreasury(address next) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(next != address(0), "DCmon: house=0");
        address prev = houseTreasury;
        houseTreasury = next;
        emit HouseTreasuryUpdated(prev, next);
    }

    function setPlayerRewardPool(address next) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(next != address(0), "DCmon: rewards=0");
        address prev = playerRewardPool;
        playerRewardPool = next;
        emit PlayerRewardPoolUpdated(prev, next);
    }

    function grantOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(OPERATOR_ROLE, operator);
    }

    function revokeOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(OPERATOR_ROLE, operator);
    }

    // ------------------------------------------------------------------------
    // Core LST functionality
    // ------------------------------------------------------------------------

    /**
     * @notice Deposit underlying MON and mint DCmon 1:1 (adjust later for staking APY).
     */
    function deposit(uint256 amount, address receiver) external nonReentrant returns (uint256 minted) {
        require(amount > 0, "DCmon: amount=0");
        require(receiver != address(0), "DCmon: receiver=0");

        underlying.safeTransferFrom(msg.sender, address(this), amount);
        _mint(receiver, amount);
        emit Deposited(receiver, amount);
        return amount;
    }

    /**
     * @notice Redeem DCmon for underlying MON at a 1:1 ratio (minus any future fee logic).
     */
    function redeem(uint256 dcAmount, address receiver) external nonReentrant returns (uint256 underlyingAmount) {
        require(dcAmount > 0, "DCmon: burn=0");
        require(receiver != address(0), "DCmon: receiver=0");

        _burn(msg.sender, dcAmount);
        underlying.safeTransfer(receiver, dcAmount);
        emit Withdrawn(receiver, dcAmount, dcAmount);
        return dcAmount;
    }

    // ------------------------------------------------------------------------
    // Reward lifecycle
    // ------------------------------------------------------------------------

    /**
     * @notice Called by an operator when new staking rewards are realised in underlying MON.
     *         Splits according to the 70/30 rule and transfers to the configured recipients.
     */
    function recordRewards(uint256 amount) external nonReentrant onlyRole(OPERATOR_ROLE) {
        require(amount > 0, "DCmon: reward=0");
        underlying.safeTransferFrom(msg.sender, address(this), amount);

        uint256 houseShare = (amount * HOUSE_BPS) / BPS_DENOMINATOR;
        uint256 playerShare = amount - houseShare;

        if (houseShare > 0) {
            underlying.safeTransfer(houseTreasury, houseShare);
        }

        if (playerShare > 0) {
            underlying.safeTransfer(playerRewardPool, playerShare);
        }

        emit RewardsRecorded(amount, houseShare, playerShare);
    }

    /**
     * @notice Operator convenience helper to move tokens from player reward pool to a recipient.
     *         Used when distributing top-user bonuses.
     */
    function distributePlayerReward(address to, uint256 amount, bytes32 memo) external onlyRole(OPERATOR_ROLE) {
        require(to != address(0), "DCmon: to=0");
        require(amount > 0, "DCmon: amount=0");
        IERC20(underlying).safeTransferFrom(playerRewardPool, to, amount);
        emit PlayerRewardsDistributed(to, amount, memo);
    }

    // ------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------

    function totalUnderlying() public view returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    function houseShareBps() external pure returns (uint256) {
        return HOUSE_BPS;
    }

    function playerShareBps() external pure returns (uint256) {
        return PLAYER_BPS;
    }
}

