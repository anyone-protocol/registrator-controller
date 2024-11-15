import { OwnableState } from './ownable'

// From warp sdk
interface WarpEvolveState {
  settings: any[] | unknown | null
  /**
   * whether contract is allowed to evolve.
   */
  canEvolve: boolean
  /**
   * the transaction id of the Arweave transaction with the updated source code.
   */
  evolve: string
}

export type EvolvableState = Partial<WarpEvolveState> & OwnableState
