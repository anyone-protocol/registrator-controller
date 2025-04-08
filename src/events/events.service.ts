import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import {
  InjectQueue,
  InjectFlowProducer,
  QueueEventsHost,
  QueueEventsListener,
  OnQueueEvent
} from '@nestjs/bullmq'
import { Queue, FlowProducer } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import { ethers, AddressLike } from 'ethers'

import { registratorABI } from './abi/registrator'
import { EvmProviderService } from '../evm-provider/evm-provider.service'
import { hodlerLocksAbi } from './abi/hodlerLocks'

@Injectable()
@QueueEventsListener('facilitator-updates-queue')
export class EventsService
  extends QueueEventsHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(EventsService.name)

  private isLive?: string
  private doClean?: string

  private static readonly removeOnComplete = true
  private static readonly removeOnFail = 8

  public static jobOpts = {
    removeOnComplete: EventsService.removeOnComplete,
    removeOnFail: EventsService.removeOnFail
  }

  private provider: ethers.WebSocketProvider

  private registratorAddress: string | undefined
  private registratorOperatorKey: string | undefined
  private registratorOperator: ethers.Wallet
  private registratorContract: ethers.Contract
  private registratorSignerContract: ethers.Contract
  
  private useHodler: string | undefined
  private hodlerAddress: string | undefined
  private hodlerContract: ethers.Contract

  constructor(
    private readonly config: ConfigService<{
      HODLER_CONTRACT_ADDRESS: string
      USE_HODLER: string
      REGISTRATOR_CONTRACT_ADDRESS: string
      REGISTRATOR_OPERATOR_KEY: string
      IS_LIVE: string
      DO_CLEAN: string
    }>,
    private readonly evmProviderService: EvmProviderService,
    @InjectQueue('registrator-updates-queue')
    public registratorUpdatesQueue: Queue,
    @InjectFlowProducer('registrator-updates-flow')
    public registratorUpdatesFlow: FlowProducer
  ) {
    super()

    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.doClean = this.config.get<string>('DO_CLEAN', { infer: true })

    this.useHodler = this.config.get<string>(
      'REGISTRATOR_CONTRACT_ADDRESS',
      { infer: true }
    )

    this.hodlerAddress = this.config.get<string>(
      'HODLER_CONTRACT_ADDRESS',
      { infer: true }
    )
    if (!this.hodlerAddress) {
      if (this.useHodler == 'true') {
        throw new Error('HODLER_CONTRACT_ADDRESS is not set!')
      }
    }

    this.registratorAddress = this.config.get<string>(
      'REGISTRATOR_CONTRACT_ADDRESS',
      { infer: true }
    )
    if (!this.registratorAddress) {
      throw new Error('REGISTRATOR_CONTRACT_ADDRESS is not set!')
    }

    this.registratorOperatorKey = this.config.get<string>(
      'REGISTRATOR_OPERATOR_KEY',
      { infer: true }
    )
    if (!this.registratorOperatorKey) {
      throw new Error('REGISTRATOR_OPERATOR_KEY is not set!')
    }

    this.logger.log(
      `Initializing events service (IS_LIVE: ${this.isLive}, ` +
        `REGISTRATOR: ${this.registratorAddress})`
    )
  }

  async onApplicationBootstrap(): Promise<void> {
    this.provider = await this.evmProviderService.getCurrentWebSocketProvider(
      async (provider) => {
        this.provider = provider
        await this.subscribeToRegistrator()
      }
    )

    if (this.doClean != 'true') {
      this.logger.log('Skipped cleaning up old jobs')
    } else {
      this.logger.log('Cleaning up old (24hrs+) jobs')
      await this.registratorUpdatesQueue.drain(true)
      await this.registratorUpdatesQueue.clean(0, -1, 'active')
      await this.registratorUpdatesQueue.clean(0, -1, 'completed')
      await this.registratorUpdatesQueue.clean(0, -1, 'failed')
    }

    if (this.hodlerAddress != undefined) {
      this.subscribeToHodler().catch((error) =>
        this.logger.error('Failed subscribing to hodler events:', error)
      )
    } else {
      this.logger.warn(
        'Missing HODLER_CONTRACT_ADDRESS, ' +
          'not subscribing to Hodler Locking EVM events'
      )
    }

    if (this.registratorAddress != undefined) {
      this.subscribeToRegistrator().catch((error) =>
        this.logger.error('Failed subscribing to registrator events:', error)
      )
    } else {
      this.logger.warn(
        'Missing REGISTRATOR_CONTRACT_ADDRESS, ' +
          'not subscribing to Registrator EVM events'
      )
    }
  }

  @OnQueueEvent('duplicated')
  onDuplicatedJob({ jobId }: { jobId: string }) {
    this.logger.warn(`Did not queue duplicate job id [${jobId}]`)
  }

  private async onRegisteredEvent(
    account: AddressLike,
    fingerprint: string | Promise<string>,
    event: ethers.EventLog
  ) {
    let accountString: string
    if (account instanceof Promise) {
      accountString = await account
    } else if (ethers.isAddressable(account)) {
      accountString = await account.getAddress()
    } else {
      accountString = account
    }

    let fingerprintString: string
    if (fingerprint instanceof Promise) {
      fingerprintString = await fingerprint
    } else {
      fingerprintString = fingerprint
    }

    let transactionHash = event.transactionHash
    if (!event.transactionHash) {
      const tx = await event.getTransaction()
      transactionHash = tx.hash
    }

    if (accountString != undefined) {
      this.logger.log(
        `Noticed registration lock for ${accountString} ` +
          `with fingerprint ${fingerprintString} ` +
          `and tx ${transactionHash}`
      )
      await this.enqueueAddRegistrationCredit(
        accountString,
        transactionHash,
        fingerprintString
      )
    } else {
      this.logger.error(
        'Trying to request facility update but missing address in data'
      )
    }
  }

  private async onLockedEvent(
    hodler: AddressLike,
    fingerprint: string | Promise<string>,
    amount: ethers.BigNumberish,
    event: ethers.EventLog
  ) {
    let hodlerString: string
    if (hodler instanceof Promise) {
      hodlerString = await hodler
    } else if (ethers.isAddressable(hodler)) {
      hodlerString = await hodler.getAddress()
    } else {
      hodlerString = hodler
    }

    let fingerprintString: string
    if (fingerprint instanceof Promise) {
      fingerprintString = await fingerprint
    } else {
      fingerprintString = fingerprint
    }

    let transactionHash = event.transactionHash
    if (!event.transactionHash) {
      const tx = await event.getTransaction()
      transactionHash = tx.hash
    }

    if (hodlerString != undefined) {
      this.logger.log(
        `Noticed hodler lock for ${hodlerString} ` +
          `with fingerprint ${fingerprintString} ` +
          `and tx ${transactionHash}`
      )
      await this.enqueueAddRegistrationCredit(
        hodlerString,
        transactionHash,
        fingerprintString
      )
    } else {
      this.logger.error(
        'Trying to request hodler lock update but missing address in data'
      )
    }
  }

  private async subscribeToHodler() {
    try {
      if (!this.hodlerAddress) {
        this.logger.error(
          'Missing HODLER_CONTRACT_ADDRESS.' +
            ' Skipping registrator subscription'
        )
      } else {
        this.logger.log(
          `Subscribing to the Hodler contract` +
            ` ${this.hodlerAddress} ...`
        )

        this.hodlerContract = new ethers.Contract(
          this.hodlerAddress,
          hodlerLocksAbi,
          this.provider
        )
        this.hodlerContract.on(
          'Locked',
          this.onLockedEvent.bind(this)
        )
      }
    } catch (error) {
      this.logger.error(
        `Caught error while subscribing to hodler events:`,
        error.stack
      )
    }
  }

  private async subscribeToRegistrator() {
    try {
      if (!this.registratorOperatorKey) {
        this.logger.error(
          'Missing REGISTRATOR_OPERATOR_KEY. Skipping registrator subscription'
        )
      } else {
        this.registratorOperator = new ethers.Wallet(
          this.registratorOperatorKey,
          this.provider
        )
      }

      if (!this.registratorAddress) {
        this.logger.error(
          'Missing REGISTRATOR_CONTRACT_ADDRESS.' +
            ' Skipping registrator subscription'
        )
      } else {
        this.logger.log(
          `Subscribing to the Registrator contract` +
            ` ${this.registratorAddress} with` +
            ` ${this.registratorOperator.address}...`
        )

        this.registratorContract = new ethers.Contract(
          this.registratorAddress,
          registratorABI,
          this.provider
        )
        this.registratorContract.on(
          'Registered',
          this.onRegisteredEvent.bind(this)
        )
      }
    } catch (error) {
      this.logger.error(
        `Caught error while subscribing to registrator events:`,
        error.stack
      )
    }
  }

  public async enqueueAddRegistrationCredit(
    address: string,
    label: string,
    fingerprint: string
  ) {
    // NB: To ensure the queue only contains unique event attempts
    //     the jobId is suffixed with the requesting address and fingerprint
    const suffix = `${address}-${fingerprint}-${label}`

    await this.registratorUpdatesFlow.add({
      name: 'add-registration-credit',
      queueName: 'registrator-updates-queue',
      data: {
        address,
        fingerprint,
        label
      },
      opts: {
        ...EventsService.jobOpts,
        jobId: `add-registration-credit-${suffix}`
      }
    })
  }
}
