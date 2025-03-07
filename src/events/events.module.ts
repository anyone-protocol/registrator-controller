import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { EventsService } from './events.service'
import { EventsDiscoveryService } from './events-discovery.service'
import { DiscoverRegistratorEventsQueue } from './processors/discover-registrator-events-queue'
import {
  EventsDiscoveryServiceState,
  EventsDiscoveryServiceStateSchema
} from './schemas/events-discovery-service-state'
import { EvmProviderModule } from '../evm-provider/evm-provider.module'
import { RegistratorUpdatesQueue } from './processors/registrator-updates-queue'
import { OperatorRegistryModule } from '../operator-registry/operator-registry.module'
import {
  RegisteredEvent,
  RegisteredEventSchema
} from './schemas/registered-event'

@Module({
  imports: [
    EvmProviderModule,
    OperatorRegistryModule,
    BullModule.registerQueue({
      name: 'registrator-updates-queue',
      streams: { events: { maxLen: 5000 } }
    }),
    BullModule.registerFlowProducer({ name: 'registrator-updates-flow' }),
    BullModule.registerQueue({
      name: 'discover-registrator-events-queue',
      streams: { events: { maxLen: 1000 } }
    }),
    BullModule.registerFlowProducer({
      name: 'discover-registrator-events-flow'
    }),
    MongooseModule.forFeature([
      {
        name: EventsDiscoveryServiceState.name,
        schema: EventsDiscoveryServiceStateSchema
      },
      {
        name: RegisteredEvent.name,
        schema: RegisteredEventSchema
      }
    ])
  ],
  providers: [
    EventsService,
    EventsDiscoveryService,
    RegistratorUpdatesQueue,
    DiscoverRegistratorEventsQueue
  ],
  exports: [EventsService]
})
export class EventsModule {}
