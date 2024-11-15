import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { forwardRef, Inject, Logger } from '@nestjs/common'
import { Job } from 'bullmq'

import { EventsDiscoveryService } from '../events-discovery.service'

@Processor('discover-registrator-events-queue')
export class DiscoverRegistratorEventsQueue extends WorkerHost {
  private readonly logger = new Logger(DiscoverRegistratorEventsQueue.name)

  public static readonly JOB_DISCOVER_REGISTERED_EVENTS =
    'discover-registered-events'
  public static readonly JOB_MATCH_REGISTERED_EVENTS = 'match-registered-events'

  constructor(
    @Inject(forwardRef(() => EventsDiscoveryService))
    private readonly eventsDiscoveryService: EventsDiscoveryService
  ) {
    super()
  }

  async process(job: Job<{ currentBlock: number }, any, string>) {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case DiscoverRegistratorEventsQueue.JOB_DISCOVER_REGISTERED_EVENTS:
        try {
          const lastSafeCompleteBlock =
            await this.eventsDiscoveryService.getLastSafeCompleteBlockNumber()

          return await this.eventsDiscoveryService.discoverRegisteredEvents(
            lastSafeCompleteBlock
          )
        } catch (error) {
          this.logger.error(
            `Exception during job ${job.name} [${job.id}]`,
            error.stack
          )
        }

        return undefined

      case DiscoverRegistratorEventsQueue.JOB_MATCH_REGISTERED_EVENTS:
        try {
          await this.eventsDiscoveryService.matchDiscoveredRegistratorEvents(
            job.data.currentBlock
          )

          // NB: Re-enqueue this flow
          await this.eventsDiscoveryService.enqueueDiscoverRegistratorEventsFlow()

          return
        } catch (error) {
          this.logger.error(
            `Exception during job ${job.name} [${job.id}]`,
            error.stack
          )
        }

        return undefined

      default:
        this.logger.warn(`Found unknown job ${job.name} [${job.id}]`)

        return undefined
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Finished ${job.name} [${job.id}]`)
  }
}
