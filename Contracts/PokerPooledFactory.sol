// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PokerTablePool.sol";

/// @title PokerPooledFactory - Deploys pooled PokerTable instances tied to a BankrollPool
contract PokerPooledFactory {
    address public owner;
    address public immutable pool;
    event OwnershipTransferred(address indexed prev, address indexed next);
    event TableCreated(address table, address pool, uint16 rakeBps, uint256 sb, uint256 bb);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address poolAddr) { require(poolAddr != address(0), "pool"); owner = msg.sender; pool = poolAddr; }

    function transferOwnership(address next) external onlyOwner { require(next!=address(0), "zero"); emit OwnershipTransferred(owner, next); owner = next; }

    function createTable(uint16 rakeBps, uint256 sb, uint256 bb) external onlyOwner returns (address table) {
        PokerTablePool t = new PokerTablePool(pool, rakeBps, sb, bb);
        t.transferOwnership(owner);
        table = address(t);
        emit TableCreated(table, pool, rakeBps, sb, bb);
    }
}

