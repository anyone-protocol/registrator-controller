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

        return

      case DiscoverRegistratorEventsQueue.JOB_MATCH_REGISTERED_EVENTS:
        try {
          await this.eventsDiscoveryService.matchDiscoveredRegistratorEvents(
            job.data.currentBlock
          )
        } catch (error) {
          this.logger.error(
            `Exception during job ${job.name} [${job.id}]`,
            error.stack
          )
        } finally {
          // NB: Re-enqueue this flow
          await this.eventsDiscoveryService
            .enqueueDiscoverRegistratorEventsFlow()
        }

        return

      default:
        this.logger.warn(`Found unknown job ${job.name} [${job.id}]`)

        return undefined
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Finished ${job.name} [${job.id}]`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<any, any, string>) {
    this.logger.error(`[alarm=failed-job-${job.name}] Failed ${job.name} [${job.id}]: ${job.failedReason}`)
  }
}
