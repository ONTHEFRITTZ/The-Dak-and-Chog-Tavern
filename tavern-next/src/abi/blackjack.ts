export const BlackjackABI = [
  "function startHand(uint256 wager) returns (uint256)",
  "function hit(uint256 gameId)",
  "function stand(uint256 gameId)",
  "function doubleDown(uint256 gameId)",
  "function split(uint256 gameId)",
  "function takeInsurance(uint256 gameId)",
  "function surrender(uint256 gameId)",
"function getGame(uint256 gameId) view returns ((address player,bool finished,uint8 activeHand,uint8 handCount,uint256 baseBet,uint256 baseStake,uint256 insuranceBet,bool insuranceAvailable,bool insuranceResolved,uint8[] dealerCards,uint8 finalOutcome,int256 totalPayout,(uint8[] cards,uint256 stake,bool doubled,bool surrendered,bool finished,bool isSplitAces,uint8 outcome,int256 payout)[] hands))",
  "function activeGame(address player) view returns (uint256)",
  "event HandStarted(uint256 indexed gameId, address indexed player, uint8 playerCard1, uint8 playerCard2, uint8 dealerUpCard, bool playerBlackjack)",
  "event CardDrawn(uint256 indexed gameId, address indexed player, uint8 card, bool dealer)",
  "event InsuranceTaken(uint256 indexed gameId, uint256 amount)",
  "event HandSplit(uint256 indexed gameId, uint8 fromHand, uint8 newHand)",
  "event HandSurrendered(uint256 indexed gameId, uint8 handIndex)",
  "event HandSettled(uint256 indexed gameId, address indexed player, uint8 outcome, int256 payout)"
] as const;
