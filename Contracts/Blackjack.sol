// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDCMonBankroll {
    function payDcmon(address to, uint256 amount) external;
    function poolDcmonBalance() external view returns (uint256);
}

contract Blackjack {
    using SafeERC20 for IERC20;

    enum Outcome {
        Pending,
        Blackjack,
        Win,
        Push,
        Lose,
        Bust,
        Surrender
    }

    struct Hand {
        uint8[] cards;
        uint256 stake;
        bool doubled;
        bool surrendered;
        bool finished;
        bool isSplitAces;
        Outcome outcome;
        int256 payout;
    }

    struct HandView {
        uint8[] cards;
        uint256 stake;
        bool doubled;
        bool surrendered;
        bool finished;
        bool isSplitAces;
        Outcome outcome;
        int256 payout;
    }

    struct Game {
        address player;
        uint64 seed;
        uint64 deckMask;
        uint8 deckIndex;
        uint256 baseBet;
        uint256 baseStake;
        uint256 insuranceBet;
        bool insuranceAvailable;
        bool insuranceResolved;
        bool finished;
        uint8 activeHand;
        uint8[] dealerCards;
        Hand[] hands;
        Outcome finalOutcome;
        int256 totalPayout;
    }

    struct GameView {
        address player;
        bool finished;
        uint8 activeHand;
        uint8 handCount;
        uint256 baseBet;
        uint256 baseStake;
        uint256 insuranceBet;
        bool insuranceAvailable;
        bool insuranceResolved;
        uint8[] dealerCards;
        Outcome finalOutcome;
        int256 totalPayout;
        HandView[] hands;
    }

    uint8 private constant MAX_HANDS = 4;
    uint8 private constant ACE_RANK = 0;

    event HandStarted(
        uint256 indexed gameId,
        address indexed player,
        uint8 playerCard1,
        uint8 playerCard2,
        uint8 dealerUpCard,
        bool playerBlackjack
    );
    event CardDrawn(uint256 indexed gameId, address indexed player, uint8 card, bool dealer);
    event InsuranceTaken(uint256 indexed gameId, uint256 amount);
    event HandSplit(uint256 indexed gameId, uint8 fromHand, uint8 newHand);
    event HandSurrendered(uint256 indexed gameId, uint8 handIndex);
    event HandSettled(uint256 indexed gameId, address indexed player, Outcome outcome, int256 payout);

    address public owner;
    IERC20 public immutable dcmonToken;
    IDCMonBankroll public pool;

    uint256 public nextGameId = 1;
    uint256 public maxBet = 10 ether;
    uint16 public feeBps = 100;
    uint256 public feesAccrued;
    bool public paused;

    mapping(uint256 => Game) private games;
    mapping(address => uint256) public activeGame;

    uint256 private _locked = 1;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address dcmonAddr, address poolAddr) {
        require(dcmonAddr != address(0), "dcmon=0");
        owner = msg.sender;
        dcmonToken = IERC20(dcmonAddr);
        if (poolAddr != address(0)) {
            pool = IDCMonBankroll(poolAddr);
        }
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        require(feesAccrued >= amount, "fees low");
        feesAccrued -= amount;
        dcmonToken.safeTransfer(to, amount);
    }

    function setMaxBet(uint256 _max) external onlyOwner {
        maxBet = _max;
    }

    function setFeeBps(uint16 _bps) external onlyOwner {
        require(_bps <= 1000, "fee too high");
        feeBps = _bps;
    }

    function pause(bool p) external onlyOwner {
        paused = p;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }

    function setPool(address poolAddr) external onlyOwner {
        require(poolAddr != address(0), "zero");
        pool = IDCMonBankroll(poolAddr);
    }

    function startHand(uint256 wager) external nonReentrant returns (uint256 gameId) {
        require(!paused, "paused");
        require(wager > 0 && wager <= maxBet, "bad wager");
        require(address(pool) != address(0), "pool");
        require(activeGame[msg.sender] == 0, "active hand");

        uint256 stake = _collectBet(msg.sender, wager);

        gameId = nextGameId++;
        Game storage game = games[gameId];
        game.player = msg.sender;
        game.seed = _seed(msg.sender);
        game.deckIndex = 1;
        game.baseBet = wager;
        game.baseStake = stake;
        game.finalOutcome = Outcome.Pending;

        game.hands.push();
        Hand storage hand = game.hands[0];
        hand.stake = stake;
        hand.outcome = Outcome.Pending;

        activeGame[msg.sender] = gameId;

        _dealInitial(gameId, game, hand);

        uint8 dealerUpCard = game.dealerCards[0];
        game.insuranceAvailable = (dealerUpCard % 13) == ACE_RANK;
        game.insuranceResolved = !game.insuranceAvailable;

        emit HandStarted(
            gameId,
            msg.sender,
            hand.cards[0],
            hand.cards[1],
            dealerUpCard,
            _isNaturalBlackjack(hand)
        );

        if (_isNaturalBlackjack(hand) && !game.insuranceAvailable) {
            _completeGame(gameId, game);
        }
    }

    function hit(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        if (_ensureInsuranceResolved(gameId, game)) {
            return;
        }

        Hand storage hand = _currentHand(game);
        require(!hand.finished, "hand finished");
        require(!hand.surrendered, "hand surrendered");
        require(!hand.isSplitAces, "split aces locked");

        _dealCardToHand(gameId, game, hand);

        (, , bool bust) = _score(hand.cards);
        if (playerBust) {
            hand.finished = true;
            hand.outcome = Outcome.Bust;
            hand.payout = 0;
            _advanceHand(gameId, game);
        }
    }

    function stand(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        if (_ensureInsuranceResolved(gameId, game)) {
            return;
        }

        Hand storage hand = _currentHand(game);
        require(!hand.finished, "hand finished");
        hand.finished = true;
        _advanceHand(gameId, game);
    }

    function doubleDown(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        if (_ensureInsuranceResolved(gameId, game)) {
            return;
        }

        Hand storage hand = _currentHand(game);
        require(!hand.finished, "hand finished");
        require(!hand.doubled, "doubled");
        require(!hand.surrendered, "hand surrendered");
        require(!hand.isSplitAces, "split aces locked");
        require(hand.cards.length == 2, "double restricted");

        uint256 stake = _collectBet(msg.sender, game.baseBet);
        hand.stake += stake;
        hand.doubled = true;

        _dealCardToHand(gameId, game, hand);

        (, , bool bust) = _score(hand.cards);
        if (playerBust) {
            hand.outcome = Outcome.Bust;
            hand.payout = 0;
        }
        hand.finished = true;
        _advanceHand(gameId, game);
    }

    function split(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        if (_ensureInsuranceResolved(gameId, game)) {
            return;
        }

        Hand storage hand = _currentHand(game);
        require(!hand.finished, "hand finished");
        require(!hand.surrendered, "hand surrendered");
        require(hand.cards.length == 2, "split restricted");
        require(game.hands.length < MAX_HANDS, "max hands");
        require(_canSplit(hand.cards), "cannot split");

        uint256 stake = _collectBet(msg.sender, game.baseBet);

        uint8 secondCard = hand.cards[1];
        hand.cards.pop();
        hand.doubled = false;
        hand.isSplitAces = (hand.cards[0] % 13) == ACE_RANK;

        game.hands.push();
        uint8 newIndex = uint8(game.hands.length - 1);
        Hand storage splitHand = game.hands[newIndex];
        splitHand.stake = stake;
        splitHand.outcome = Outcome.Pending;
        splitHand.cards.push(secondCard);
        splitHand.isSplitAces = (secondCard % 13) == ACE_RANK;

        _dealCardToHand(gameId, game, hand);
        _dealCardToHand(gameId, game, splitHand);

        if (hand.isSplitAces) {
            hand.finished = true;
        }
        if (splitHand.isSplitAces) {
            splitHand.finished = true;
        }

        emit HandSplit(gameId, game.activeHand, newIndex);

        if (hand.finished) {
            _advanceHand(gameId, game);
        }
    }

    function takeInsurance(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        require(game.insuranceAvailable, "insurance unavailable");
        require(!game.insuranceResolved, "insurance resolved");
        require(game.insuranceBet == 0, "insurance placed");

        uint256 amount = game.baseStake / 2;
        require(amount > 0, "insurance zero");

        dcmonToken.safeTransferFrom(msg.sender, address(this), amount);
        dcmonToken.safeTransfer(address(pool), amount);

        game.insuranceBet = amount;

        emit InsuranceTaken(gameId, amount);
    }

    function surrender(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        if (_ensureInsuranceResolved(gameId, game)) {
            return;
        }

        Hand storage hand = _currentHand(game);
        require(!hand.finished, "hand finished");
        require(!hand.surrendered, "hand surrendered");
        require(hand.cards.length == 2, "surrender restricted");

        hand.surrendered = true;
        hand.finished = true;
        hand.outcome = Outcome.Surrender;
        hand.payout = int256(hand.stake / 2);

        emit HandSurrendered(gameId, game.activeHand);

        _advanceHand(gameId, game);
    }

    function getGame(uint256 gameId) external view returns (GameView memory view_) {
        Game storage game = games[gameId];
        view_.player = game.player;
        view_.finished = game.finished;
        view_.activeHand = game.activeHand;
        view_.handCount = uint8(game.hands.length);
        view_.baseBet = game.baseBet;
        view_.baseStake = game.baseStake;
        view_.insuranceBet = game.insuranceBet;
        view_.insuranceAvailable = game.insuranceAvailable;
        view_.insuranceResolved = game.insuranceResolved;
        view_.dealerCards = _copy(game.dealerCards);
        view_.finalOutcome = game.finalOutcome;
        view_.totalPayout = game.totalPayout;

        uint256 length = game.hands.length;
        view_.hands = new HandView[](length);
        for (uint256 i = 0; i < length; i += 1) {
            Hand storage hand = game.hands[i];
            HandView memory hv;
            hv.cards = _copy(hand.cards);
            hv.stake = hand.stake;
            hv.doubled = hand.doubled;
            hv.surrendered = hand.surrendered;
            hv.finished = hand.finished;
            hv.isSplitAces = hand.isSplitAces;
            hv.outcome = hand.outcome;
            hv.payout = hand.payout;
            view_.hands[i] = hv;
        }
    }

    function _requirePlayerGame(uint256 gameId) internal view returns (Game storage game) {
        require(gameId != 0, "game=0");
        game = games[gameId];
        require(game.player == msg.sender, "not player");
        require(!game.finished, "game finished");
    }

    function _currentHand(Game storage game) internal view returns (Hand storage) {
        require(game.activeHand < game.hands.length, "no active hand");
        return game.hands[game.activeHand];
    }

    function _collectBet(address player, uint256 gross) internal returns (uint256 stake) {
        uint256 fee = (gross * uint256(feeBps)) / 10000;
        feesAccrued += fee;
        stake = gross - fee;

        dcmonToken.safeTransferFrom(player, address(this), gross);
        dcmonToken.safeTransfer(address(pool), gross);
    }

    function _dealInitial(uint256 gameId, Game storage game, Hand storage hand) internal {
        _dealCardToHand(gameId, game, hand);
        _dealCardToDealer(gameId, game);
        _dealCardToHand(gameId, game, hand);
        _dealCardToDealer(gameId, game);
    }

    function _dealCardToHand(uint256 gameId, Game storage game, Hand storage hand) internal {
        uint8 card = _drawCard(game);
        hand.cards.push(card);
        emit CardDrawn(gameId, game.player, card, false);
    }

    function _dealCardToDealer(uint256 gameId, Game storage game) internal {
        uint8 card = _drawCard(game);
        game.dealerCards.push(card);
        emit CardDrawn(gameId, game.player, card, true);
    }

    function _advanceHand(uint256 gameId, Game storage game) internal {
        while (game.activeHand < game.hands.length && game.hands[game.activeHand].finished) {
            game.activeHand += 1;
        }
        if (game.activeHand >= game.hands.length) {
            _completeGame(gameId, game);
        }
    }

    function _ensureInsuranceResolved(uint256 gameId, Game storage game) internal returns (bool) {
        if (game.insuranceResolved) {
            return false;
        }

        game.insuranceResolved = true;
        bool dealerBlackjack = _dealerHasBlackjack(game.dealerCards);
        if (!dealerBlackjack) {
            return false;
        }

        int256 total;
        uint8 length = uint8(game.hands.length);
        bool sawPush = false;
        bool sawLose = false;

        for (uint8 i = 0; i < length; i += 1) {
            Hand storage hand = game.hands[i];
            if (_isNaturalBlackjack(hand)) {
                hand.outcome = Outcome.Push;
                hand.payout = int256(hand.stake);
                total += hand.payout;
                aggregate = Outcome.Push;
                sawPush = true;
            } else {
                hand.outcome = Outcome.Lose;
                hand.payout = 0;
                sawLose = true;
            }
            hand.finished = true;
        }

        if (game.insuranceBet > 0) {
            total += int256(game.insuranceBet * 3);
        }

        game.finalOutcome = sawPush && !sawLose ? Outcome.Push : Outcome.Lose;
        game.totalPayout = total;
        game.finished = true;
        activeGame[game.player] = 0;

        emit HandSettled(gameId, game.player, game.finalOutcome, total);

        if (total > 0) {
            uint256 payout = uint256(total);
            require(pool.poolDcmonBalance() >= payout, "bankroll low");
            pool.payDcmon(game.player, payout);
        }
        return true;
    }

    function _completeGame(uint256 gameId, Game storage game) internal {
        if (game.finished) {
            return;
        }

        bool anyLive = false;
        for (uint256 i = 0; i < game.hands.length; i += 1) {
            Hand storage hand = game.hands[i];
            if (hand.outcome != Outcome.Pending) {
                continue;
            }
            if (hand.finished) {
                anyLive = true;
                continue;
            }
            (, , bool bust) = _score(hand.cards);
            if (playerBust) {
                hand.finished = true;
                hand.outcome = Outcome.Bust;
                hand.payout = 0;
            } else {
                anyLive = true;
            }
        }

        if (anyLive) {
            _dealerPlay(gameId, game);
        }

        (uint8 dealerTotal, , bool dealerBust) = _score(game.dealerCards);
        bool dealerNatural = _dealerHasBlackjack(game.dealerCards);

        int256 total;
        bool sawBlackjack = false;
        bool sawWin = false;
        bool sawPush = true;
        bool sawLose = false;
        bool sawSurrender = true;

        for (uint256 i = 0; i < game.hands.length; i += 1) {
            Hand storage hand = game.hands[i];

            if (hand.outcome == Outcome.Bust) {
                total += hand.payout;
                sawPush = false;
                sawSurrender = false;
                sawLose = true;
                continue;
            }

            if (hand.outcome == Outcome.Surrender) {
                total += hand.payout;
                sawPush = false;
                continue;
            }
            (uint8 playerTotal,, bool playerBust) = _score(hand.cards);
            if (playerBust) {
                hand.outcome = Outcome.Bust;
                hand.payout = 0;
                total += hand.payout;
                sawPush = false;
                sawSurrender = false;
                sawLose = true;
                continue;
            }

            bool natural = _isNaturalBlackjack(hand);
            if (dealerBust) {
                hand.outcome = natural ? Outcome.Blackjack : Outcome.Win;
                hand.payout = natural ? int256((hand.stake * 5) / 2) : int256(hand.stake * 2);
            } else if (playerTotal > dealerTotal) {
                hand.outcome = natural ? Outcome.Blackjack : Outcome.Win;
                hand.payout = natural ? int256((hand.stake * 5) / 2) : int256(hand.stake * 2);
            } else if (playerTotal == dealerTotal) {
                if (natural && dealerNatural) {
                    hand.outcome = Outcome.Push;
                    hand.payout = int256(hand.stake);
                } else if (natural && !dealerNatural) {
                    hand.outcome = Outcome.Blackjack;
                    hand.payout = int256((hand.stake * 5) / 2);
                } else {
                    hand.outcome = Outcome.Push;
                    hand.payout = int256(hand.stake);
                }
            } else {
                hand.outcome = Outcome.Lose;
                hand.payout = 0;
            }

            hand.finished = true;
            total += hand.payout;

            if (hand.outcome == Outcome.Blackjack) {
                sawBlackjack = true;
                sawPush = false;
                sawSurrender = false;
            } else if (hand.outcome == Outcome.Win) {
                sawWin = true;
                sawPush = false;
                sawSurrender = false;
            } else if (hand.outcome == Outcome.Push) {
                sawSurrender = false;
            } else if (hand.outcome == Outcome.Lose) {
                sawPush = false;
                sawSurrender = false;
                sawLose = true;
            } else if (hand.outcome == Outcome.Bust) {
                sawPush = false;
                sawSurrender = false;
                sawLose = true;
            }
        }

        game.totalPayout = total;
        if (sawBlackjack) {
            game.finalOutcome = Outcome.Blackjack;
        } else if (sawWin) {
            game.finalOutcome = Outcome.Win;
        } else if (sawPush && !sawLose) {
            game.finalOutcome = Outcome.Push;
        } else if (sawSurrender && !sawWin && !sawBlackjack && !sawLose) {
            game.finalOutcome = Outcome.Surrender;
        } else if (sawLose && !sawWin && !sawBlackjack && !sawPush) {
            game.finalOutcome = Outcome.Lose;
        } else {
            game.finalOutcome = Outcome.Lose;
        }

        game.finished = true;
        activeGame[game.player] = 0;

        emit HandSettled(gameId, game.player, game.finalOutcome, total);

        if (total > 0) {
            uint256 amount = uint256(total);
            require(pool.poolDcmonBalance() >= amount, "bankroll low");
            pool.payDcmon(game.player, amount);
        }
    }

    function _dealerPlay(uint256 gameId, Game storage game) internal {
        (uint8 total, bool soft, bool bust) = _score(game.dealerCards);
        while (total < 17 || (total == 17 && soft && !bust)) {
            _dealCardToDealer(gameId, game);
            (total, soft, bust) = _score(game.dealerCards);
        }
    }

    function _dealerHasBlackjack(uint8[] storage dealerCards) internal view returns (bool) {
        if (dealerCards.length != 2) return false;
        (uint8 total, , bool bust) = _score(dealerCards);
        return !bust && total == 21;
    }

    function _isNaturalBlackjack(Hand storage hand) internal view returns (bool) {
        if (hand.isSplitAces) return false;
        if (hand.cards.length != 2) return false;
        (uint8 total, , bool bust) = _score(hand.cards);
        return !bust && total == 21;
    }

    function _canSplit(uint8[] storage cards) internal pure returns (bool) {
        if (cards.length != 2) return false;
        uint8 rankA = cards[0] % 13;
        uint8 rankB = cards[1] % 13;
        if (rankA == rankB) return true;
        if (rankA >= 9 && rankB >= 9) return true;
        return false;
    }

    function _drawCard(Game storage game) internal returns (uint8 card) {
        while (true) {
            uint256 rand = uint256(
                keccak256(
                    abi.encodePacked(game.seed, game.deckIndex++, block.prevrandao, block.timestamp)
                )
            );
            card = uint8(rand % 52);
            uint64 mask = uint64(1) << card;
            if (game.deckMask & mask == 0) {
                game.deckMask |= mask;
                return card;
            }
        }
    }

    function _seed(address player) internal view returns (uint64) {
        return uint64(
            uint256(
                keccak256(abi.encodePacked(block.prevrandao, block.timestamp, player, address(this)))
            )
        );
    }

    function _score(uint8[] storage cards)
        internal
        view
        returns (uint8 total, bool soft, bool bust)
    {
        uint8 hard = 0;
        uint8 aces = 0;
        for (uint256 i = 0; i < cards.length; i += 1) {
            uint8 rank = cards[i] % 13;
            if (rank == ACE_RANK) {
                aces += 1;
                hard += 1;
            } else if (rank >= 9) {
                hard += 10;
            } else {
                hard += rank + 1;
            }
        }
        uint8 best = hard;
        if (aces > 0 && hard + 10 <= 21) {
            best = hard + 10;
            soft = true;
        }
        bust = hard > 21;
        total = bust ? hard : best;
    }

    function _copy(uint8[] storage source) internal view returns (uint8[] memory result) {
        result = new uint8[](source.length);
        for (uint256 i = 0; i < source.length; i += 1) {
            result[i] = source[i];
        }
    }
}
