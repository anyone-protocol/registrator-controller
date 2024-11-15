import { Module } from '@nestjs/common'

import { EvmProviderService } from './evm-provider.service'

@Module({
  providers: [EvmProviderService],
  exports: [EvmProviderService]
})
export class EvmProviderModule {}
