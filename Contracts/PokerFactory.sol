// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PokerTable.sol";

/// @title PokerFactory - Deploys PokerTable instances with shared ownership
contract PokerFactory {
    address public owner;
    event OwnershipTransferred(address indexed prev, address indexed next);
    event TableCreated(address table, uint16 rakeBps, uint256 sb, uint256 bb);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor() { owner = msg.sender; }

    function transferOwnership(address next) external onlyOwner { require(next!=address(0), "zero"); emit OwnershipTransferred(owner, next); owner = next; }

    function createTable(uint16 rakeBps, uint256 sb, uint256 bb) external onlyOwner returns (address table) {
        PokerTable t = new PokerTable(rakeBps, sb, bb);
        t.transferOwnership(owner); // factory retains ownership control
        table = address(t);
        emit TableCreated(table, rakeBps, sb, bb);
    }
}

