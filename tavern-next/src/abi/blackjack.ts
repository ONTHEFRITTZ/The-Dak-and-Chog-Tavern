export const BlackjackABI = [
  "function startHand(uint256 wager) returns (uint256)",
  "function hit(uint256 gameId)",
  "function stand(uint256 gameId)",
  "function doubleDown(uint256 gameId)",
  "function getGame(uint256 gameId) view returns (address player,uint256 wager,uint256 additionalWager,bool finished,bool doubled,uint8[] memory playerCards,uint8[] memory dealerCards,uint8 outcome,int256 payout)",
  "function activeGame(address player) view returns (uint256)",
  "event HandStarted(uint256 indexed gameId, address indexed player, uint8 playerCard1, uint8 playerCard2, uint8 dealerUpCard, bool playerBlackjack)",
  "event CardDrawn(uint256 indexed gameId, address indexed player, uint8 card, bool dealer)",
  "event HandSettled(uint256 indexed gameId, address indexed player, uint8 outcome, int256 payout)"
] as const;
