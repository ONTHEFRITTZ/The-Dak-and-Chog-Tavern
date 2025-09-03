// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MonGame {
    address public owner;

    event Played(address indexed player, uint256 amount, bool win, uint8 guess, uint8 correct);
    event Funded(address indexed funder, uint256 amount);

    constructor() payable {
        owner = msg.sender;
    }

    // Fund the bankroll
    function fund() external payable {
        require(msg.value > 0, "Must send MON");
        emit Funded(msg.sender, msg.value);
    }

    // Receive MON directly
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // Play with guess
    function play(uint8 guess) external payable {
        require(msg.value > 0, "Must send MON to play");
        require(address(this).balance >= msg.value * 2, "bankroll too low");
        require(guess < 3, "invalid guess"); // 3 shells

        // pseudo random correct shell using only guaranteed block values
        uint8 correct = uint8(uint256(keccak256(abi.encodePacked(block.timestamp, block.number, msg.sender))) % 3);

        bool win = (guess == correct);

        if (win) {
            (bool success, ) = payable(msg.sender).call{value: msg.value * 2}("");
            require(success, "payout failed");
        }

        emit Played(msg.sender, msg.value, win, guess, correct);
    }

    // Owner withdraw
    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "not owner");
        require(amount <= address(this).balance, "too much");
        payable(owner).transfer(amount);
    }
}
