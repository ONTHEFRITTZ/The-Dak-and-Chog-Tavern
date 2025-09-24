// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITavernUnified {
    function playShell(uint8 guess) external payable;
    function playHazard(uint8 main) external payable;
    function playCoin(bool chooseChog) external payable;
    function maxBet() external view returns (uint256);
    function pool() external view returns (address);
}

/// @title GameRouterBase
/// @notice Lightweight forwarder to the existing Tavern contract so games keep identical behavior
///         while exposing a per‑game contract address (useful for Games ID/attribution).
abstract contract GameRouterBase {
    address public tavern; // existing unified game contract
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _tavern) {
        owner = msg.sender;
        tavern = _tavern;
    }

    function setTavern(address _tavern) external onlyOwner {
        require(_tavern != address(0), "zero");
        tavern = _tavern;
    }

    function transferOwnership(address _new) external onlyOwner {
        require(_new != address(0), "zero");
        owner = _new;
    }

    // Surface common reads so existing UIs/admin helpers continue to work
    function maxBet() external view returns (uint256) {
        try ITavernUnified(tavern).maxBet() returns (uint256 m) { return m; } catch { return 0; }
    }

    function pool() external view returns (address) {
        try ITavernUnified(tavern).pool() returns (address p) { return p; } catch { return address(0); }
    }

    // Accept funds if ever sent directly
    receive() external payable {}
}

