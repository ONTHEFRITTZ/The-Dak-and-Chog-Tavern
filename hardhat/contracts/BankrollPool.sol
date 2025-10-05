// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDCMon {
    function deposit(uint256 amount, address receiver) external returns (uint256);
    function redeem(uint256 amount, address receiver) external returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/// @title BankrollPool - Unified liquidity pool backing multiple games and staking via DCmon
contract BankrollPool {
    using SafeERC20 for IERC20;

    address public owner;
    bool public paused;
    uint256 private _locked = 1;

    IERC20 public immutable underlying;
    IDCMon public immutable dcmon;

    mapping(address => bool) public authorizedGames;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(bool paused);
    event Authorized(address indexed game, bool allowed);
    event Paid(address indexed to, uint256 amount, address indexed byGame, bool dcmonPayment);
    event Deposited(uint256 amountUnderlying, uint256 mintedDcmon);
    event Redeemed(uint256 dcmonBurned, uint256 underlyingReceived);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(IERC20 _underlying, IDCMon _dcmon) {
        owner = msg.sender;
        underlying = _underlying;
        dcmon = _dcmon;
    }

    receive() external payable {}
    function fund() external payable {}

    function setAuthorized(address game, bool allowed) external onlyOwner {
        authorizedGames[game] = allowed;
        emit Authorized(game, allowed);
    }

    function pause(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function depositUnderlying(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "amount=0");
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        underlying.approve(address(dcmon), amount);
        uint256 minted = dcmon.deposit(amount, address(this));
        emit Deposited(amount, minted);
    }

    function redeemDcmon(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "amount=0");
        uint256 beforeBal = underlying.balanceOf(address(this));
        dcmon.redeem(amount, address(this));
        uint256 afterBal = underlying.balanceOf(address(this));
        emit Redeemed(amount, afterBal - beforeBal);
    }

    function payDcmon(address to, uint256 amount) external notPaused {
        require(authorizedGames[msg.sender], "not authorized");
        require(dcmon.balanceOf(address(this)) >= amount, "insufficient dcmon");
        IERC20(address(dcmon)).safeTransfer(to, amount);
        emit Paid(to, amount, msg.sender, true);
    }

    function payNative(address payable to, uint256 amount) external nonReentrant notPaused {
        require(authorizedGames[msg.sender], "not authorized");
        require(address(this).balance >= amount, "insufficient pool");
        to.transfer(amount);
        emit Paid(to, amount, msg.sender, false);
    }

    function poolUnderlyingBalance() external view returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    function poolDcmonBalance() external view returns (uint256) {
        return dcmon.balanceOf(address(this));
    }

    function withdrawUnderlying(address to, uint256 amount) external onlyOwner nonReentrant {
        underlying.safeTransfer(to, amount);
    }

    function withdrawNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "insufficient");
        to.transfer(amount);
    }
}
