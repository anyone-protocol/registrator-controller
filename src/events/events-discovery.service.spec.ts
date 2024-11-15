import { BullModule } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'
import { Test, TestingModule } from '@nestjs/testing'

import {
  RequestingUpdateEvent,
  RequestingUpdateEventSchema
} from './schemas/requesting-update-event'
import { EventsDiscoveryService } from './events-discovery.service'
import {
  AllocationUpdatedEvent,
  AllocationUpdatedEventSchema
} from './schemas/allocation-updated-event'

const dbName = 'facilitator-controller-events-discovery-service-tests'

describe('EventsDiscoveryService', () => {
  let module: TestingModule
  let service: EventsDiscoveryService

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        BullModule.registerFlowProducer({ name: 'facilitator-updates-flow' }),
        BullModule.registerFlowProducer({
          name: 'discover-facilitator-events-flow'
        }),
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(`mongodb://localhost/${dbName}`),
        MongooseModule.forFeature([
          {
            name: AllocationUpdatedEvent.name,
            schema: AllocationUpdatedEventSchema
          },
          {
            name: RequestingUpdateEvent.name,
            schema: RequestingUpdateEventSchema
          }
        ])
      ],
      providers: [EventsDiscoveryService],
      exports: [EventsDiscoveryService]
    })
      .setLogger(new Logger())
      .compile()
    service = module.get<EventsDiscoveryService>(EventsDiscoveryService)
  })

  afterEach(async () => {
    await module.close()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('Discovers past RequestingUpdate events & stores them', async () => {
    await service.discoverRequestingUpdateEvents()
  }, 30_000)

  it('Discovers past AllocationUpdated events & stores them', async () => {
    await service.discoverAllocationUpdatedEvents()
  }, 30_000)

  it('Matches discovered events & queues remaining unmatched', async () => {
    await service.matchDiscoveredFacilitatorEvents()
  }, 30_000)
})
