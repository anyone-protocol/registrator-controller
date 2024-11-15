export type ContractFunctionInput = {
  function: string
  [key: string]: any
}

export type PartialFunctionInput<T extends ContractFunctionInput> = Partial<T> &
  Pick<T, 'function'>

/* eslint-disable-next-line @typescript-eslint/no-empty-object-type */
export interface Constructor<T = {}> {
  new (...args: any[]): T
}
