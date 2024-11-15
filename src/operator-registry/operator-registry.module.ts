import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { OperatorRegistryService } from './operator-registry.service'

@Module({
  imports: [ConfigModule],
  providers: [OperatorRegistryService],
  exports: [OperatorRegistryService]
})
export class OperatorRegistryModule {}
