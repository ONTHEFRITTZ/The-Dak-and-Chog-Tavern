// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GameRouterBase.sol";

/// @title DakChogRouter (coin flip)
/// @notice Forwards coin flip plays to the unified Tavern contract, preserving game behavior
contract DakChogRouter is GameRouterBase {
    constructor(address tavernAddr) GameRouterBase(tavernAddr) {}

    function playCoin(bool chooseChog) external payable {
        ITavernUnified(tavern).playCoin{value: msg.value}(chooseChog);
    }
}

