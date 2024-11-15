import { Logger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { Wallet } from 'ethers'

import { OperatorRegistryService } from './operator-registry.service'

describe('OperatorRegistryService', () => {
  let module: TestingModule
  let service: OperatorRegistryService

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [OperatorRegistryService],
      exports: [OperatorRegistryService]
    })
      .setLogger(new Logger())
      .compile()
    service = module.get<OperatorRegistryService>(OperatorRegistryService)

    await service.onApplicationBootstrap()
  })

  afterEach(async () => {
    await module.close()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('Gets Operator Registry State', async () => {
    const state = await service.getOperatorRegistryState()

    console.log('Got state', state)

    expect(state).toBeDefined()
  }, 30_000)

  it('Adds Registration Credits', async () => {
    const wallet = Wallet.createRandom()
    const address = wallet.address
    const transactionHash = 'mock-tx-hash-' + address
    const fingerprint = address.substring(2).toUpperCase()

    const success = await service.addRegistrationCredit(
      address,
      transactionHash,
      fingerprint
    )

    expect(success).toBe(true)
  }, 30_000)

  it('Handles adding duplicate Registration Credits', async () => {
    const wallet = Wallet.createRandom()
    const address = wallet.address
    const transactionHash = 'mock-tx-hash-' + address
    const fingerprint = address.substring(2).toUpperCase()

    await service.addRegistrationCredit(address, transactionHash, fingerprint)
    const success = await service.addRegistrationCredit(
      address,
      transactionHash,
      fingerprint
    )

    expect(success).toBe(false)
  }, 30_000)
})
