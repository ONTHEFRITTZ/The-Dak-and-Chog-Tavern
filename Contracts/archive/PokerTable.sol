// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PokerTable - Minimal cash-game ledger + settlement for Texas Hold'em
/// @notice Off-chain engine sequences actions. Contract holds player balances, blinds, and settles winners.
contract PokerTable {
    // Basic ownable + reentrancy
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    uint256 private _locked = 1; modifier nonReentrant() { require(_locked==1, "reentrant"); _locked=2; _; _locked=1; }
    event OwnershipTransferred(address indexed prev, address indexed next);

    // Game params
    uint8 public constant MAX_SEATS = 6;
    uint16 public rakeBps; // 1 = 0.01%
    uint256 public smallBlind;
    uint256 public bigBlind;
    bool public paused;

    struct Seat { address player; uint256 balance; }
    Seat[MAX_SEATS] public seats;

    // Hand state
    uint256 public handId;
    bool public inHand;
    uint8 public dealerSeat;
    uint8 public sbSeat;
    uint8 public bbSeat;
    uint256 public pot;

    event Paused(bool);
    event RakeUpdated(uint16 bps);
    event BlindsUpdated(uint256 sb, uint256 bb);
    event SeatTaken(address indexed player, uint8 indexed seat, uint256 amount);
    event SeatLeft(address indexed player, uint8 indexed seat, uint256 returnedAmount);
    event Deposited(address indexed player, uint8 indexed seat, uint256 amount);
    event Withdrawn(address indexed player, uint8 indexed seat, uint256 amount);
    event HandStarted(uint256 indexed handId, uint8 dealer, uint8 sb, uint8 bb);
    event Contributed(uint256 indexed handId, uint8 indexed seat, uint256 amount);
    event HandSettled(uint256 indexed handId, address[] winners, uint256[] payouts, uint256 rake);

    constructor(uint16 _rakeBps, uint256 _sb, uint256 _bb) {
        owner = msg.sender;
        rakeBps = _rakeBps; smallBlind = _sb; bigBlind = _bb;
    }

    receive() external payable {}

    function transferOwnership(address next) external onlyOwner { require(next != address(0), "zero"); emit OwnershipTransferred(owner, next); owner = next; }
    function setRake(uint16 _bps) external onlyOwner { require(_bps <= 1000, "high"); rakeBps = _bps; emit RakeUpdated(_bps); }
    function setBlinds(uint256 _sb, uint256 _bb) external onlyOwner { smallBlind=_sb; bigBlind=_bb; emit BlindsUpdated(_sb,_bb); }
    function pause(bool p) external onlyOwner { paused=p; emit Paused(p); }

    function seat(uint8 seatId) external payable nonReentrant {
        require(!paused, "paused");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == address(0) || s.player == msg.sender, "taken");
        if (s.player == address(0)) s.player = msg.sender;
        s.balance += msg.value;
        emit SeatTaken(msg.sender, seatId, msg.value);
    }

    function deposit(uint8 seatId) external payable nonReentrant {
        require(!paused, "paused");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == msg.sender && s.player != address(0), "owner");
        s.balance += msg.value;
        emit Deposited(msg.sender, seatId, msg.value);
    }

    function withdraw(uint8 seatId, uint256 amount) external nonReentrant {
        require(!paused, "paused");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == msg.sender, "owner");
        require(!inHand, "in hand");
        require(s.balance >= amount, "funds");
        s.balance -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, seatId, amount);
    }

    function unseat(uint8 seatId) external nonReentrant {
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == msg.sender || msg.sender == owner, "perm");
        require(!inHand, "in hand");
        uint256 amt = s.balance; s.balance = 0; address pl = s.player; s.player = address(0);
        if (amt > 0) payable(pl).transfer(amt);
        emit SeatLeft(pl, seatId, amt);
    }

    // --- Hand lifecycle (off-chain engine) ---
    function beginHand(uint256 nextHandId, uint8 dealer, uint8 sb, uint8 bb) external onlyOwner {
        require(!inHand, "active");
        require(dealer < MAX_SEATS && sb < MAX_SEATS && bb < MAX_SEATS, "pos");
        handId = nextHandId; inHand = true; dealerSeat = dealer; sbSeat = sb; bbSeat = bb; pot = 0;
        // reserve blinds from seat balances into pot
        if (seats[sb].player != address(0) && seats[sb].balance >= smallBlind) { seats[sb].balance -= smallBlind; pot += smallBlind; }
        if (seats[bb].player != address(0) && seats[bb].balance >= bigBlind) { seats[bb].balance -= bigBlind; pot += bigBlind; }
        emit HandStarted(handId, dealer, sb, bb);
    }

    function contribute(uint8 seatId, uint256 amount) external onlyOwner {
        require(inHand, "no hand");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player != address(0) && s.balance >= amount, "funds");
        s.balance -= amount; pot += amount;
        emit Contributed(handId, seatId, amount);
    }

    function settleHand(address[] calldata winners, uint256[] calldata payouts, uint256 rakeOverride) external onlyOwner nonReentrant {
        require(inHand, "no hand");
        require(winners.length == payouts.length, "len");
        uint256 total;
        for (uint256 i=0;i<payouts.length;i++){ total += payouts[i]; }
        uint256 rake = rakeOverride;
        if (rake == 0 && rakeBps > 0) { rake = (pot * uint256(rakeBps)) / 10000; }
        require(total + rake <= pot, "exceeds pot");
        // pay winners from pot back into their seat balances
        for (uint256 i=0;i<winners.length;i++) {
            address w = winners[i]; uint256 amt = payouts[i];
            if (amt == 0) continue;
            // credit to the seat the winner currently occupies
            for (uint8 s=0;s<MAX_SEATS;s++) { if (seats[s].player == w) { seats[s].balance += amt; break; } }
        }
        // any unused pot (including rake) stays in contract for now
        inHand = false; pot = 0; emit HandSettled(handId, winners, payouts, rake);
    }

    // Admin emergency: withdraw table funds (not recommended in production)
    function emergencyWithdraw(address payable to, uint256 amount) external onlyOwner nonReentrant { to.transfer(amount); }
}

