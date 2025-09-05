// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MonHazard {
    address public owner;
    bool private locked;

    event HazardPlayed(
        address indexed player,
        uint256 wager,
        bool win,
        uint8 main,
        uint8 finalSum,
        uint8 chance,
        uint256 iterations
    );

    event Funded(address indexed funder, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier noReentrant() { require(!locked, "reentrancy"); locked = true; _; locked = false; }

    constructor() payable { owner = msg.sender; }

    function fund() external payable { require(msg.value > 0, "must send MON"); emit Funded(msg.sender, msg.value); }
    receive() external payable { emit Funded(msg.sender, msg.value); }

    function play(uint8 main) external payable noReentrant {
        require(msg.value > 0, "must send MON to play");
        require(main >= 5 && main <= 9, "invalid main");
        require(address(this).balance >= msg.value * 2, "bankroll too low");

        uint256 wager = msg.value;
        uint8 chance = 0;
        bool resolved = false;
        bool win = false;
        uint8 finalSum = 0;
        bytes32 seed = keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, blockhash(block.number - 1)));
        uint256 iterations = 0;
        uint256 maxIterations = 100;

        while (!resolved && iterations < maxIterations) {
            seed = keccak256(abi.encodePacked(seed, iterations));
            uint8 d1 = uint8(uint256(seed) % 6) + 1;
            seed = keccak256(abi.encodePacked(seed, iterations, d1));
            uint8 d2 = uint8(uint256(seed) % 6) + 1;
            finalSum = d1 + d2;

            if (chance == 0) {
                if (finalSum == main) { win = true; resolved = true; }
                else if (finalSum == 2 || finalSum == 3) { win = false; resolved = true; }
                else if (finalSum == 11 || finalSum == 12) {
                    if (main == 7) { win = false; } else if (main == 5 || main == 9) { win = true; } else { win = false; }
                    resolved = true;
                } else { chance = finalSum; }
            } else {
                if (finalSum == chance) { win = true; resolved = true; }
                else if (finalSum == main) { win = false; resolved = true; }
            }
            iterations++;
        }

        if (!resolved) { win = false; }

        if (win) {
            uint256 payout = wager * 2;
            if (address(this).balance >= payout) {
                (bool ok, ) = payable(msg.sender).call{ value: payout }("");
                require(ok, "payout failed");
            } else { win = false; }
        }

        emit HazardPlayed(msg.sender, wager, win, main, finalSum, chance, iterations);
    }

    function withdraw(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "too much");
        payable(owner).transfer(amount);
    }
}
