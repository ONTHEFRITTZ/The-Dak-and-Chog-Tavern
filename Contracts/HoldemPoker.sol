// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HoldemPoker - Cash-game table without pre-funding
/// @notice Players contribute native coin directly per action (no separate buy-in).
///         Once contributed during a hand, funds are locked into the pot and cannot
///         be reclaimed if the player leaves mid-hand (treated as a fold).
///         The off-chain engine (table owner) orchestrates begin/settle.
contract HoldemPoker {
    // --- Reentrancy guard only ---
    uint256 private _locked = 1; modifier nonReentrant() { require(_locked==1, "reentrant"); _locked=2; _; _locked=1; }

    // --- Table params ---
    uint8 public constant MAX_SEATS = 6;
    uint16 public rakeBps; // 1 = 0.01%
    uint256 public smallBlind;
    uint256 public bigBlind;
    bool public paused; // unused in v2 (always false)

    struct Seat { address player; }
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
    event Joined(address indexed player, uint8 indexed seat);
    event LeftDuringHand(address indexed player, uint8 indexed seat);
    event HandStarted(uint256 indexed handId, uint8 dealer, uint8 sb, uint8 bb);
    event Contributed(uint256 indexed handId, uint8 indexed seat, uint256 amount);
    event HandSettled(uint256 indexed handId, address[] winners, uint256[] payouts, uint256 rake);

    constructor(address /*poolAddrIgnored*/ ) {
        // Sensible defaults; owner may adjust later
        rakeBps = 100;                 // 1%
        smallBlind = 1_000_000_000_000_000;   // 0.001 MON
        bigBlind   = 2_000_000_000_000_000;   // 0.002 MON
    }

    receive() external payable {}

    // --- Admin removed in v2: rake/blinds fixed at deploy; pause unused ---

    // --- Seat control (no pre-fund) ---
    function joinSeat(uint8 seatId) external nonReentrant {
        require(!paused, "paused");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == address(0) || s.player == msg.sender, "taken");
        if (s.player == address(0)) s.player = msg.sender;
        emit Joined(msg.sender, seatId);
    }
    function unseat(uint8 seatId) external nonReentrant {
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == msg.sender, "perm");
        require(!inHand, "in hand");
        address pl = s.player; s.player = address(0);
        emit SeatLeft(pl, seatId, 0);
    }

    /// @notice Leave during an active hand, forfeiting any contributed funds.
    function leaveDuringHand(uint8 seatId) external nonReentrant {
        require(inHand, "no hand");
        require(seatId < MAX_SEATS, "seat");
        Seat storage s = seats[seatId];
        require(s.player == msg.sender, "owner");
        s.player = address(0);
        emit LeftDuringHand(msg.sender, seatId);
    }

    // --- Hand lifecycle (permissionless orchestrator; no special wallet) ---
    function beginHand(uint8 dealer, uint8 sb, uint8 bb) external nonReentrant {
        require(!inHand, "active");
        require(dealer < MAX_SEATS && sb < MAX_SEATS && bb < MAX_SEATS, "pos");
        handId = handId + 1; inHand = true; dealerSeat = dealer; sbSeat = sb; bbSeat = bb; pot = 0;
        // Blinds are posted by players via contribute(), not auto-debited here.
        emit HandStarted(handId, dealer, sb, bb);
    }

    /// @notice Player contributes native coin to the current hand.
    function contribute(uint8 seatId) external payable nonReentrant {
        require(inHand, "no hand");
        require(seatId < MAX_SEATS, "seat");
        require(msg.value > 0, "value");
        require(seats[seatId].player == msg.sender, "seat owner");
        pot += msg.value;
        emit Contributed(handId, seatId, msg.value);
    }

    /// @notice Settle the hand; permissionless. Rake retained in contract; winners paid directly.
    function settleHand(address[] calldata winners, uint256[] calldata payouts) external nonReentrant {
        require(inHand, "no hand");
        require(winners.length == payouts.length, "len");
        uint256 total;
        for (uint256 i=0;i<payouts.length;i++){ total += payouts[i]; }
        uint256 rake = (rakeBps > 0) ? (pot * uint256(rakeBps)) / 10000 : 0;
        require(total + rake <= pot, "exceeds pot");
        // note: rake stays in contract treasury for later governance use (no privileged recipient)
        for (uint256 i=0;i<winners.length;i++) {
            uint256 amt = payouts[i];
            if (amt == 0) continue;
            (bool ok,) = payable(winners[i]).call{ value: amt }("");
            require(ok, "pay fail");
        }
        inHand = false; pot = 0;
        emit HandSettled(handId, winners, payouts, rake);
    }
}
