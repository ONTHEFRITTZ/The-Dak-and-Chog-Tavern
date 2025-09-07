// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title WalletWhitelist - Simple owner-managed whitelist for early access
/// @notice Owner can add/remove addresses; dApps can query `isAllowed`.
contract WalletWhitelist {
    address public owner;
    mapping(address => bool) private allowed;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AllowedSet(address indexed account, bool allowed);
    event AllowedMany(address[] accounts, bool allowed);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor() { owner = msg.sender; }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function isAllowed(address account) external view returns (bool) {
        return allowed[account];
    }

    function set(address account, bool isAllowed_) public onlyOwner {
        allowed[account] = isAllowed_;
        emit AllowedSet(account, isAllowed_);
    }

    function add(address account) external onlyOwner { set(account, true); }
    function remove(address account) external onlyOwner { set(account, false); }

    function setMany(address[] calldata accounts, bool isAllowed_) public onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            allowed[accounts[i]] = isAllowed_;
        }
        emit AllowedMany(accounts, isAllowed_);
    }

    function addMany(address[] calldata accounts) external onlyOwner { setMany(accounts, true); }
    function removeMany(address[] calldata accounts) external onlyOwner { setMany(accounts, false); }
}
