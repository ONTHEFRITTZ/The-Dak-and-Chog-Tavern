// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface of BankrollPool used by pooled poker
interface IBankrollPoolPay {
    function pay(address payable to, uint256 amount) external;
    function balance() external view returns (uint256);
}

/// @title HoldemPoker - Cash-game table with pooled custody (BankrollPool)
/// @notice Single poker contract. All deposits are forwarded to the shared pool. This contract tracks
///         per-seat balances and uses the pool to pay withdrawals. Hand lifecycle is owner-orchestrated
///         by the off-chain engine.
contract HoldemPoker {
    // --- Ownership + reentrancy ---
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    uint256 private _locked = 1; modifier nonReentrant() { require(_locked==1, "reentrant"); _locked=2; _; _locked=1; }
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // --- Pool ---
    IBankrollPoolPay public immutable pool;

    // --- Table params ---
    uint8 public constant MAX_SEATS = 6;
    uint16 public rakeBps; // 1 = 0.01%
    uint256 public smallBlind;
    uint256 public bigBlind;
    bool public paused;

    struct Seat { address player; uint256 balance; }
    Seat[MAX_SEATS] public seats;

    // --- Hand/session state ---
    uint256 public handId;
    bool public inHand;
    uint8 public dealerSeat;
    uint8 public sbSeat;
    uint8 public bbSeat;
    uint256 public pot; // logical pot tracked during hand

    // --- Events ---
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

    constructor(address poolAddr, uint16 _rakeBps, uint256 _sb, uint256 _bb) {
        require(poolAddr != address(0), "pool");
        pool = IBankrollPoolPay(poolAddr);
        owner = msg.sender;
        rakeBps = _rakeBps; smallBlind = _sb; bigBlind = _bb;
    }

    receive() external payable {}

    // --- Admin ---
    function transferOwnership(address next) external onlyOwner { require(next != address(0), "zero"); emit OwnershipTransferred(owner, next); owner = next; }
    function setRake(uint16 _bps) external onlyOwner { require(_bps <= 1000, "high"); rakeBps = _bps; emit RakeUpdated(_bps); }
    function setBlinds(uint256 _sb, uint256 _bb) external onlyOwner { smallBlind=_sb; bigBlind=_bb; emit BlindsUpdated(_sb,_bb); }
    function pause(bool p) external onlyOwner { paused=p; emit Paused(p); }

    // --- Player funding (custodied in pool) ---
    function seat(uint8 seatId) external payable nonReentrant {
        require(!paused, "paused");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == address(0) || s.player == msg.sender, "taken");
        if (s.player == address(0)) s.player = msg.sender;
        if (msg.value > 0) {
            s.balance += msg.value;
            // forward deposit into pool
            (bool ok,) = payable(address(pool)).call{ value: msg.value }("");
            require(ok, "pool deposit failed");
        }
        emit SeatTaken(msg.sender, seatId, msg.value);
    }

    function deposit(uint8 seatId) external payable nonReentrant {
        require(!paused, "paused");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == msg.sender && s.player != address(0), "owner");
        require(msg.value > 0, "value");
        s.balance += msg.value;
        (bool ok,) = payable(address(pool)).call{ value: msg.value }("");
        require(ok, "pool deposit failed");
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
        // pool must authorize this contract; otherwise pay() will revert
        pool.pay(payable(msg.sender), amount);
        emit Withdrawn(msg.sender, seatId, amount);
    }

    function unseat(uint8 seatId) external nonReentrant {
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == msg.sender || msg.sender == owner, "perm");
        require(!inHand, "in hand");
        uint256 amt = s.balance; address pl = s.player;
        s.balance = 0; s.player = address(0);
        if (amt > 0) { pool.pay(payable(pl), amt); }
        emit SeatLeft(pl, seatId, amt);
    }

    // --- Hand lifecycle (off-chain engine drives sequencing) ---
    function beginHand(uint256 nextHandId, uint8 dealer, uint8 sb, uint8 bb) external onlyOwner {
        require(!inHand, "active");
        require(dealer < MAX_SEATS && sb < MAX_SEATS && bb < MAX_SEATS, "pos");
        handId = nextHandId; inHand = true; dealerSeat = dealer; sbSeat = sb; bbSeat = bb; pot = 0;
        // post blinds from seat balances into logical pot
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

    /// @notice Settle the hand, crediting payouts to winners' seat balances. Rake is kept in-contract (implicitly in pool treasury).
    function settleHand(address[] calldata winners, uint256[] calldata payouts, uint256 rakeOverride) external onlyOwner nonReentrant {
        require(inHand, "no hand");
        require(winners.length == payouts.length, "len");
        uint256 total;
        for (uint256 i=0;i<payouts.length;i++){ total += payouts[i]; }
        uint256 rake = rakeOverride;
        if (rake == 0 && rakeBps > 0) { rake = (pot * uint256(rakeBps)) / 10000; }
        require(total + rake <= pot, "exceeds pot");
        // credit payouts to winners' seat balances
        for (uint256 i=0;i<winners.length;i++) {
            address w = winners[i]; uint256 amt = payouts[i];
            if (amt == 0) continue;
            for (uint8 s=0;s<MAX_SEATS;s++) { if (seats[s].player == w) { seats[s].balance += amt; break; } }
        }
        inHand = false; pot = 0;
        emit HandSettled(handId, winners, payouts, rake);
    }
}

