import { Test, TestingModule } from '@nestjs/testing'
import { BullModule } from '@nestjs/bullmq'
import { ConfigModule } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'

import { EventsService } from './events.service'
import { FacilitatorUpdatesQueue } from './processors/facilitator-updates-queue'
import { ClusterModule } from '../cluster/cluster.module'
import { DistributionModule } from '../distribution/distribution.module'
import {
  RequestingUpdateEvent,
  RequestingUpdateEventSchema
} from './schemas/requesting-update-event'

describe('EventsService', () => {
  let module: TestingModule
  let service: EventsService

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ClusterModule,
        DistributionModule,
        BullModule.registerQueue({
          name: 'facilitator-updates-queue'
        }),
        BullModule.registerFlowProducer({
          name: 'facilitator-updates-flow'
        }),
        MongooseModule.forRoot(
          'mongodb://localhost/facilitator-controller-events-service-tests'
        ),
        MongooseModule.forFeature([
          {
            name: RequestingUpdateEvent.name,
            schema: RequestingUpdateEventSchema
          }
        ])
      ],
      providers: [EventsService, FacilitatorUpdatesQueue],
      exports: [EventsService]
    }).compile()

    service = module.get<EventsService>(EventsService)

    await service.subscribeToFacilitator()
  })

  afterEach(async () => {
    await module.close()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
