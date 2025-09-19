// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GameRouterBase.sol";

/// @title ShellRouter
/// @notice Forwards Shell Game plays to the unified Tavern contract, preserving game behavior
contract ShellRouter is GameRouterBase {
    constructor(address tavernAddr) GameRouterBase(tavernAddr) {}

    function playShell(uint8 guess) external payable {
        ITavernUnified(tavern).playShell{value: msg.value}(guess);
    }
}

