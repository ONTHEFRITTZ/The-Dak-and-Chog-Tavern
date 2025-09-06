// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BankrollPool - Unified liquidity pool for multiple game contracts
/// @notice Holds MON (native) liquidity and pays out winners on behalf of authorized games.
contract BankrollPool {
    address public owner;
    bool public paused;
    uint256 private _locked = 1;

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }
    modifier notPaused() { require(!paused, "paused"); _; }

    mapping(address => bool) public authorizedGames;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(bool paused);
    event Authorized(address indexed game, bool allowed);
    event Paid(address indexed to, uint256 amount, address indexed byGame);

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}
    function fund() external payable {}

    function setAuthorized(address game, bool allowed) external onlyOwner {
        authorizedGames[game] = allowed;
        emit Authorized(game, allowed);
    }

    function pause(bool p) external onlyOwner { paused = p; emit Paused(p); }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Pay out a winner from the pool. Callable only by authorized games.
    function pay(address payable to, uint256 amount) external nonReentrant notPaused {
        require(authorizedGames[msg.sender], "not authorized");
        require(address(this).balance >= amount, "insufficient pool");
        to.transfer(amount);
        emit Paid(to, amount, msg.sender);
    }

    /// @notice Current pool balance
    function balance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Owner withdraws any amount
    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "insufficient");
        to.transfer(amount);
    }

    /// @notice Owner withdraws all funds
    function withdrawAll(address payable to) external onlyOwner nonReentrant {
        to.transfer(address(this).balance);
    }
}

