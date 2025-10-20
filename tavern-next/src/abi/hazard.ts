export const HazardABI = [
  {
    inputs: [
      { internalType: "uint8", name: "main", type: "uint8" },
      { internalType: "uint256", name: "wager", type: "uint256" },
    ],
    name: "playHazard",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  { inputs: [{ internalType: "address", name: "poolAddr", type: "address" }], name: "setPool", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint256", name: "_max", type: "uint256" }], name: "setMaxBet", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint16", name: "_bps", type: "uint16" }], name: "setFeeBps", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "bool", name: "p", type: "bool" }], name: "pause", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "dcmonToken", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "pool", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "owner", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "maxBet", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "feeBps", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "paused", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "uint256", name: "wager", type: "uint256" },
      { indexed: false, internalType: "bool", name: "win", type: "bool" },
      { indexed: false, internalType: "uint8", name: "main", type: "uint8" },
      { indexed: false, internalType: "uint8", name: "finalSum", type: "uint8" },
      { indexed: false, internalType: "uint8", name: "chance", type: "uint8" },
      { indexed: false, internalType: "uint16", name: "iterations", type: "uint16" },
    ],
    name: "HazardPlayed",
    type: "event",
  },
] as const;

export type HazardAbi = typeof HazardABI;
