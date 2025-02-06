import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { HealingService } from './healing.service'
import { HealingQueue } from './processors/healing.queue'
import { EventsService } from '../events/events.service'
import { EvmProviderModule } from '../evm-provider/evm-provider.module'
import { OperatorRegistryModule } from 'src/operator-registry/operator-registry.module'

@Module({
  imports: [
    EventsService,
    EvmProviderModule,
    OperatorRegistryModule,
    BullModule.registerQueue({
      name: 'healing-queue',
      streams: { events: { maxLen: 1000 } }
    }),
    BullModule.registerFlowProducer({ name: 'healing-flow' })
  ],
  providers: [HealingService, HealingQueue],//, ValidationQueue, VerificationQueue],
  exports: [HealingService]
})
export class HealingModule {}
