// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GameRouterBase.sol";

/// @title HazardRouter
/// @notice Forwards Hazard plays to the unified Tavern contract, preserving game behavior
contract HazardRouter is GameRouterBase {
    constructor(address tavernAddr) GameRouterBase(tavernAddr) {}

    function playHazard(uint8 main) external payable {
        ITavernUnified(tavern).playHazard{value: msg.value}(main);
    }
}

