export const BlackjackABI = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "startHand",
    inputs: [
      { internalType: "uint256", name: "wager", type: "uint256" },
    ],
    outputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "hit",
    inputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "stand",
    inputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "doubleDown",
    inputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "split",
    inputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "takeInsurance",
    inputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "surrender",
    inputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getGame",
    inputs: [
      { internalType: "uint256", name: "gameId", type: "uint256" },
    ],
    outputs: [
      {
        internalType: "struct Blackjack.GameView",
        name: "view_",
        type: "tuple",
        components: [
          { internalType: "address", name: "player", type: "address" },
          { internalType: "bool", name: "finished", type: "bool" },
          { internalType: "uint8", name: "activeHand", type: "uint8" },
          { internalType: "uint8", name: "handCount", type: "uint8" },
          { internalType: "uint256", name: "baseBet", type: "uint256" },
          { internalType: "uint256", name: "baseStake", type: "uint256" },
          { internalType: "uint256", name: "insuranceBet", type: "uint256" },
          { internalType: "bool", name: "insuranceAvailable", type: "bool" },
          { internalType: "bool", name: "insuranceResolved", type: "bool" },
          { internalType: "uint8[]", name: "dealerCards", type: "uint8[]" },
          { internalType: "uint8", name: "finalOutcome", type: "uint8" },
          { internalType: "int256", name: "totalPayout", type: "int256" },
          {
            internalType: "struct Blackjack.HandView[]",
            name: "hands",
            type: "tuple[]",
            components: [
              { internalType: "uint8[]", name: "cards", type: "uint8[]" },
              { internalType: "uint256", name: "stake", type: "uint256" },
              { internalType: "bool", name: "doubled", type: "bool" },
              { internalType: "bool", name: "surrendered", type: "bool" },
              { internalType: "bool", name: "finished", type: "bool" },
              { internalType: "bool", name: "isSplitAces", type: "bool" },
              { internalType: "uint8", name: "outcome", type: "uint8" },
              { internalType: "int256", name: "payout", type: "int256" },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "activeGame",
    inputs: [
      { internalType: "address", name: "player", type: "address" },
    ],
    outputs: [
      { internalType: "uint256", name: "", type: "uint256" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "HandStarted",
    inputs: [
      { indexed: true, internalType: "uint256", name: "gameId", type: "uint256" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "uint8", name: "playerCard1", type: "uint8" },
      { indexed: false, internalType: "uint8", name: "playerCard2", type: "uint8" },
      { indexed: false, internalType: "uint8", name: "dealerUpCard", type: "uint8" },
      { indexed: false, internalType: "bool", name: "playerBlackjack", type: "bool" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "CardDrawn",
    inputs: [
      { indexed: true, internalType: "uint256", name: "gameId", type: "uint256" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "uint8", name: "card", type: "uint8" },
      { indexed: false, internalType: "bool", name: "dealer", type: "bool" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "InsuranceTaken",
    inputs: [
      { indexed: true, internalType: "uint256", name: "gameId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "HandSplit",
    inputs: [
      { indexed: true, internalType: "uint256", name: "gameId", type: "uint256" },
      { indexed: false, internalType: "uint8", name: "fromHand", type: "uint8" },
      { indexed: false, internalType: "uint8", name: "newHand", type: "uint8" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "HandSurrendered",
    inputs: [
      { indexed: true, internalType: "uint256", name: "gameId", type: "uint256" },
      { indexed: false, internalType: "uint8", name: "handIndex", type: "uint8" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "HandSettled",
    inputs: [
      { indexed: true, internalType: "uint256", name: "gameId", type: "uint256" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "uint8", name: "outcome", type: "uint8" },
      { indexed: false, internalType: "int256", name: "payout", type: "int256" },
    ],
  },
] as const;
