// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
        Bust
    }

    struct Game {
        address player;
        uint64 seed;
        uint64 deckMask;
        uint8 deckIndex;
        uint256 wager;
        uint256 additionalWager;
        bool finished;
        bool doubled;
        uint8[] playerCards;
        uint8[] dealerCards;
        Outcome outcome;
        int256 payout;
    }

    event HandStarted(
        uint256 indexed gameId,
        address indexed player,
        uint8 playerCard1,
        uint8 playerCard2,
        uint8 dealerUpCard,
        bool playerBlackjack
    );

    event CardDrawn(uint256 indexed gameId, address indexed player, uint8 card, bool dealer);
    event HandSettled(uint256 indexed gameId, address indexed player, Outcome outcome, int256 payout);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolUpdated(address indexed pool);

    address public owner;
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
    uint256 private _locked = 1;

    IERC20 public immutable dcmonToken;
    IDCMonBankroll public pool;

    uint256 public nextGameId = 1;
    uint256 public maxBet = 10 ether;
    uint16 public feeBps = 100;
    uint256 public feesAccrued;
    bool public paused;

    mapping(uint256 => Game) private games;
    mapping(address => uint256) public activeGame;

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
        emit Paused(p);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPool(address poolAddr) external onlyOwner {
        require(poolAddr != address(0), "zero");
        pool = IDCMonBankroll(poolAddr);
        emit PoolUpdated(poolAddr);
    }

    function startHand(uint256 wager) external nonReentrant returns (uint256 gameId) {
        require(!paused, "paused");
        require(wager > 0 && wager <= maxBet, "bad wager");
        require(address(pool) != address(0), "pool");
        require(activeGame[msg.sender] == 0, "active hand");

        uint256 fee = (wager * uint256(feeBps)) / 10000;
        feesAccrued += fee;
        uint256 stake = wager - fee;

        dcmonToken.safeTransferFrom(msg.sender, address(this), wager);
        dcmonToken.safeTransfer(address(pool), wager);

        gameId = nextGameId++;
        Game storage game = games[gameId];
        game.player = msg.sender;
        game.wager = stake;
        game.seed = _seed(msg.sender);
        game.deckIndex = 1;
        game.finished = false;
        game.doubled = false;
        activeGame[msg.sender] = gameId;

        _dealInitial(game);

        emit HandStarted(
            gameId,
            msg.sender,
            game.playerCards[0],
            game.playerCards[1],
            game.dealerCards[0],
            _isBlackjack(game.playerCards)
        );

        if (_isBlackjack(game.playerCards)) {
            _resolveFinished(gameId, game);
        }
    }

    function hit(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        require(!game.finished, "finished");
        require(!_isBust(game.playerCards), "already bust");

        uint8 card = _drawCard(game);
        game.playerCards.push(card);
        emit CardDrawn(gameId, msg.sender, card, false);

        if (_isBust(game.playerCards)) {
            game.outcome = Outcome.Bust;
            _resolveFinished(gameId, game);
        }
    }

    function stand(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        require(!game.finished, "finished");

        _dealerPlay(gameId, game);
        _resolveFinished(gameId, game);
    }

    function doubleDown(uint256 gameId) external nonReentrant {
        Game storage game = _requirePlayerGame(gameId);
        require(!game.finished, "finished");
        require(!game.doubled, "doubled");
        require(game.playerCards.length == 2, "not allowed");

        uint256 additional = game.wager;
        uint256 fee = (additional * uint256(feeBps)) / 10000;
        uint256 stake = additional - fee;
        feesAccrued += fee;

        dcmonToken.safeTransferFrom(msg.sender, address(this), additional);
        dcmonToken.safeTransfer(address(pool), additional);

        game.wager += stake;
        game.additionalWager += stake;
        game.doubled = true;

        uint8 card = _drawCard(game);
        game.playerCards.push(card);
        emit CardDrawn(gameId, msg.sender, card, false);

        if (_isBust(game.playerCards)) {
            game.outcome = Outcome.Bust;
        } else {
            _dealerPlay(gameId, game);
        }
        _resolveFinished(gameId, game);
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            address player,
            uint256 wager,
            uint256 additionalWager,
            bool finished,
            bool doubled,
            uint8[] memory playerCards,
            uint8[] memory dealerCards,
            Outcome outcome,
            int256 payout
        )
    {
        Game storage game = games[gameId];
        player = game.player;
        wager = game.wager;
        additionalWager = game.additionalWager;
        finished = game.finished;
        doubled = game.doubled;
        playerCards = _copy(game.playerCards);
        dealerCards = _copy(game.dealerCards);
        outcome = game.outcome;
        payout = game.payout;
    }

    function _resolveFinished(uint256 gameId, Game storage game) internal {
        if (!game.finished) {
            if (game.outcome == Outcome.Pending) {
                _finaliseOutcome(gameId, game);
            }
            game.finished = true;
        }

        activeGame[game.player] = 0;
        emit HandSettled(gameId, game.player, game.outcome, game.payout);

        if (game.payout > 0) {
            uint256 amount = uint256(game.payout);
            require(pool.poolDcmonBalance() >= amount, "bankroll low");
            pool.payDcmon(game.player, amount);
        }
    }

    function _finaliseOutcome(uint256 gameId, Game storage game) internal {
        (uint8 playerTotal, , bool playerBust) = _score(game.playerCards);
        (uint8 dealerTotal, bool dealerSoft, bool dealerBust) = _score(game.dealerCards);

        if (playerBust) {
            game.outcome = Outcome.Bust;
            game.payout = 0;
            return;
        }

        if (!dealerBust) {
            if (dealerTotal < 17 || (dealerTotal == 17 && dealerSoft)) {
                _dealerPlay(gameId, game);
                (dealerTotal, , dealerBust) = _score(game.dealerCards);
            }
        }

        uint256 stake = game.wager;
        if (dealerBust) {
            bool playerBlackjack = _isBlackjack(game.playerCards);
            game.outcome = playerBlackjack ? Outcome.Blackjack : Outcome.Win;
            game.payout = playerBlackjack ? int256((stake * 5) / 2) : int256(stake * 2);
            return;
        }

        if (playerTotal > dealerTotal) {
            if (_isBlackjack(game.playerCards)) {
                game.outcome = Outcome.Blackjack;
                game.payout = int256((stake * 5) / 2);
            } else {
                game.outcome = Outcome.Win;
                game.payout = int256(stake * 2);
            }
        } else if (playerTotal == dealerTotal) {
            bool bothBlackjack = _isBlackjack(game.playerCards) && _isBlackjack(game.dealerCards);
            if (bothBlackjack) {
                game.outcome = Outcome.Push;
                game.payout = int256(stake);
            } else if (_isBlackjack(game.playerCards)) {
                game.outcome = Outcome.Blackjack;
                game.payout = int256((stake * 5) / 2);
            } else {
                game.outcome = Outcome.Push;
                game.payout = int256(stake);
            }
        } else {
            game.outcome = Outcome.Lose;
            game.payout = 0;
        }
    }

    function _dealerPlay(uint256 gameId, Game storage game) internal {
        (uint8 total, bool soft, bool bust) = _score(game.dealerCards);
        while (total < 17 || (total == 17 && soft && !bust)) {
            uint8 card = _drawCard(game);
            game.dealerCards.push(card);
            emit CardDrawn(gameId, game.player, card, true);
            (total, soft, bust) = _score(game.dealerCards);
        }
    }

    function _dealInitial(Game storage game) internal {
        game.playerCards.push(_drawCard(game));
        game.dealerCards.push(_drawCard(game));
        game.playerCards.push(_drawCard(game));
        game.dealerCards.push(_drawCard(game));

        if (_isBlackjack(game.playerCards)) {
        bool dealerBust;
        (, , dealerBust) = _score(game.dealerCards);
        if (!_isBlackjack(game.dealerCards) && !dealerBust) {
            game.outcome = Outcome.Blackjack;
            game.payout = int256((game.wager * 5) / 2);
        } else if (_isBlackjack(game.dealerCards)) {
            game.outcome = Outcome.Push;
            game.payout = int256(game.wager);
            } else {
                game.outcome = Outcome.Blackjack;
                game.payout = int256((game.wager * 5) / 2);
            }
        } else {
            game.outcome = Outcome.Pending;
        }
    }

    function _drawCard(Game storage game) internal returns (uint8 card) {
        while (true) {
            uint256 rand = uint256(keccak256(abi.encodePacked(game.seed, game.deckIndex++, block.prevrandao, block.timestamp)));
            card = uint8(rand % 52);
            uint256 mask = uint256(1) << card;
            if (game.deckMask & mask == 0) {
                game.deckMask |= uint64(mask);
                return card;
            }
        }
    }

    function _seed(address player) internal view returns (uint64) {
        return uint64(uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, player, address(this)))));
    }

    function _isBlackjack(uint8[] storage cards) internal view returns (bool) {
        if (cards.length != 2) return false;
        (uint8 total,, bool bust) = _score(cards);
        return !bust && total == 21;
    }

    function _isBust(uint8[] storage cards) internal view returns (bool) {
        (, , bool bust) = _score(cards);
        return bust;
    }

    function _score(uint8[] storage cards) internal view returns (uint8 total, bool soft, bool bust) {
        uint8 hard = 0;
        uint8 aces = 0;
        for (uint256 i = 0; i < cards.length; i++) {
            uint8 rank = cards[i] % 13;
            if (rank == 0) {
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
        for (uint256 i = 0; i < source.length; i++) {
            result[i] = source[i];
        }
    }

    function _requirePlayerGame(uint256 gameId) internal view returns (Game storage game) {
        require(gameId != 0, "game=0");
        game = games[gameId];
        require(game.player == msg.sender, "not player");
        require(game.player != address(0), "missing");
    }
}
