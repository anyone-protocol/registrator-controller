import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { forwardRef, Inject, Logger } from '@nestjs/common'
import { Job } from 'bullmq'

import { HealingService } from '../healing.service'

@Processor('healing-queue')
export class HealingQueue extends WorkerHost {
  private readonly logger = new Logger(HealingQueue.name)

  public static readonly JOB_HEAL_LOCKS_AND_REGISTRATION_CREDITS =
    'heal-locks-and-registration-credits'

  constructor(
    @Inject(forwardRef(() => HealingService))
    private readonly healingService: HealingService
  ) {
    super()
  }

  async process(job: Job<any, any, string>) {
    this.logger.log(`Processing ${job.name} [${job.id}]`)

    switch (job.name) {
      case HealingQueue.JOB_HEAL_LOCKS_AND_REGISTRATION_CREDITS:
        try {
          await this.healingService.discoverLocksNeedingRegistrationCredits()
          await this.healingService.enqueueHealingLocksAndRegistrationCredits()
        } catch (error) {
          this.logger.error(
            `Exception during job ${job.name} [${job.id}]`,
            error.stack
          )
        }
        break

      default:
        this.logger.warn(`Unknown job ${job.name} [${job.id}]`)
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<any, any, string>) {
    this.logger.log(`Finished ${job.name} [${job.id}]`)
  }
}
