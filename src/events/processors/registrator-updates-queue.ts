import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'

import { AddRegistrationCreditEventData } from '../dto/add-registration-credit-event-data'
import { OperatorRegistryService } from '../../operator-registry/operator-registry.service'

@Processor('registrator-updates-queue')
export class RegistratorUpdatesQueue extends WorkerHost {
  private readonly logger = new Logger(RegistratorUpdatesQueue.name)

  public static readonly JOB_ADD_REGISTRATION_CREDIT = 'add-registration-credit'

  constructor(
    private readonly operatorRegistryService: OperatorRegistryService
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<boolean | undefined> {
    this.logger.debug(
      `Dequeueing ${job.name} [${job.id}] - ${JSON.stringify(job.data)}`
    )

    switch (job.name) {
      case RegistratorUpdatesQueue.JOB_ADD_REGISTRATION_CREDIT:
        try {
          const data: AddRegistrationCreditEventData =
            job.data as AddRegistrationCreditEventData
          if (data != undefined) {
            this.logger.log(
              `Adding registration credit for [${data.address}] from tx [${data.label}] for fingerprint [${data.fingerprint}]`
            )
            return await this.operatorRegistryService.addRegistrationCredit(
              data.address,
              data.label,
              data.fingerprint
            )
          } else {
            this.logger.error('Missing job data')
            return undefined
          }
        } catch (error) {
          this.logger.error(
            'Exception while adding registration credits:',
            error
          )
          return undefined
        }

      default:
        this.logger.warn(`Found unknown job ${job.name} [${job.id}]`)
        return undefined
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<any, any, string>) {
    this.logger.debug(`Finished ${job.name} [${job.id}]`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<any, any, string>) {
    this.logger.error(`[alarm=failed-job-${job.name}] Failed ${job.name} [${job.id}]: ${job.failedReason}`)
  }
}
