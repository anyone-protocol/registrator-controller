import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { HealingService } from './healing.service'
import { HealingQueue } from './processors/healing.queue'
import { OperatorRegistryModule } from '../operator-registry/operator-registry.module'
import { EventsModule } from '../events/events.module'

@Module({
  imports: [
    EventsModule,
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
