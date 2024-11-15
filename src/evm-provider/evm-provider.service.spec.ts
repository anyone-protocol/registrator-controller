import { Logger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { EvmProviderService } from './evm-provider.service'

describe('EvmProviderService', () => {
  let module: TestingModule
  let service: EvmProviderService

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [EvmProviderService],
      exports: [EvmProviderService]
    })
      .setLogger(new Logger())
      .compile()

    service = module.get<EvmProviderService>(EvmProviderService)
  })

  it('should construct', () => {
    expect(service).toBeDefined()
  })
})
