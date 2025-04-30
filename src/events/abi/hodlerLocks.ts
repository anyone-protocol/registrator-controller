export const hodlerLocksAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "hodler",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "fingerprint",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      }
    ],
    "name": "Locked",
    "type": "event"
  }
]