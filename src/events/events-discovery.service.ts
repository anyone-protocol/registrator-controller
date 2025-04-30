import { InjectFlowProducer, InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { FlowProducer, Queue } from 'bullmq'
import { ethers, EthersError } from 'ethers'
import { sortBy, uniqBy } from 'lodash'
import { Model, Types as MongooseTypes } from 'mongoose'

import { registratorABI } from './abi/registrator'
import { DiscoverRegistratorEventsQueue } from './processors/discover-registrator-events-queue'
import { EventsDiscoveryServiceState } from './schemas/events-discovery-service-state'
import { EvmProviderService } from '../evm-provider/evm-provider.service'
import { RegisteredEvent } from './schemas/registered-event'
import { OperatorRegistryService } from '../operator-registry/operator-registry.service'
import { EventsService } from './events.service'
import { hodlerLocksAbi } from './abi/hodlerLocks'
import { DiscoverHodlerEventsQueue } from './processors/discover-hodler-events-queue'

@Injectable()
export class EventsDiscoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EventsDiscoveryService.name)

  private static readonly removeOnComplete = true
  private static readonly removeOnFail = 8

  public static jobOpts = {
    removeOnComplete: EventsDiscoveryService.removeOnComplete,
    removeOnFail: EventsDiscoveryService.removeOnFail
  }

  private isLive?: string
  private doClean?: string
  private doDbNuke?: string
  private provider: ethers.WebSocketProvider

  private useRegistrator?: string
  private registratorAddress?: string
  private registratorContract: ethers.Contract
  private registratorContractDeployedBlock: ethers.BlockTag

  private useHodler: string | undefined
  private hodlerAddress: string | undefined
  private hodlerContract: ethers.Contract
  private hodlerContractDeployedBlock: ethers.BlockTag

  private state: {
    _id?: MongooseTypes.ObjectId
    isDiscovering: boolean
    lastSafeCompleteBlock?: number
  } = { isDiscovering: false }

  constructor(
    private readonly config: ConfigService<{
      REGISTRATOR_CONTRACT_ADDRESS: string
      REGISTRATOR_CONTRACT_DEPLOYED_BLOCK: string
      HODLER_CONTRACT_ADDRESS: string
      HODLER_CONTRACT_DEPLOYED_BLOCK: string
      USE_HODLER: string
      USE_REGISTRATOR: string
      IS_LIVE: string
      DO_CLEAN: string
      DO_DB_NUKE: string
    }>,
    private readonly evmProviderService: EvmProviderService,
    private readonly operatorRegistryService: OperatorRegistryService,
    private readonly eventsService: EventsService,
    @InjectQueue('discover-registrator-events-queue')
    public discoverRegistratorEventsQueue: Queue,
    @InjectFlowProducer('discover-registrator-events-flow')
    public discoverRegistratorEventsFlow: FlowProducer,
    @InjectQueue('discover-hodler-events-queue')
    public discoverHodlerEventsQueue: Queue,
    @InjectFlowProducer('discover-hodler-events-flow')
    public discoverHodlerEventsFlow: FlowProducer,
    @InjectModel(EventsDiscoveryServiceState.name)
    private readonly eventsDiscoveryServiceStateModel: Model<EventsDiscoveryServiceState>,
    @InjectModel(RegisteredEvent.name)
    private readonly registeredEventModel: Model<RegisteredEvent>
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.doClean = this.config.get<string>('DO_CLEAN', { infer: true })
    this.doDbNuke = this.config.get<string>('DO_DB_NUKE', { infer: true })

    this.useHodler = this.config.get<string>(
      'USE_HODLER',
      { infer: true }
    )

    this.useRegistrator = this.config.get<string>(
      'USE_REGISTRATOR',
      { infer: true }
    )

    if (this.useRegistrator == 'true') {
      this.registratorAddress = this.config.get<string>(
        'REGISTRATOR_CONTRACT_ADDRESS',
        { infer: true }
      )
      if (!this.registratorAddress) {
        throw new Error('REGISTRATOR_CONTRACT_ADDRESS is not set!')
      }

      const registratorContractDeployedBlock = Number.parseInt(
        this.config.get<string>('REGISTRATOR_CONTRACT_DEPLOYED_BLOCK', {
          infer: true
        })
      )
      this.registratorContractDeployedBlock = registratorContractDeployedBlock
      if (Number.isNaN(registratorContractDeployedBlock)) {
        throw new Error('REGISTRATOR_CONTRACT_DEPLOYED_BLOCK is NaN!')
      }
    }

    if (this.useHodler == 'true') {
      this.hodlerAddress = this.config.get<string>(
        'HODLER_CONTRACT_ADDRESS',
        { infer: true }
      )
      if (!this.hodlerAddress) {
        throw new Error('HODLER_CONTRACT_ADDRESS is not set!')
      }

      const hodlerContractDeployedBlock = Number.parseInt(
        this.config.get<string>('HODLER_CONTRACT_DEPLOYED_BLOCK', {
          infer: true
        })
      )
      this.hodlerContractDeployedBlock = hodlerContractDeployedBlock
      if (Number.isNaN(hodlerContractDeployedBlock)) {
        throw new Error('HODLER_CONTRACT_DEPLOYED_BLOCK is NaN!')
      }
    }

    this.logger.log(
      `Initializing events discovery service (IS_LIVE: ${this.isLive}, ` +
        `REGISTRATOR: ${this.registratorAddress} HODLER: ${this.hodlerAddress})`
    )
  }

  async onApplicationBootstrap() {
    this.provider = await this.evmProviderService.getCurrentWebSocketProvider(
      (provider => {
        this.provider = provider
        this.registratorContract = new ethers.Contract(
          this.registratorAddress,
          registratorABI,
          this.provider
        )
        if (this.useHodler == 'true') {
          this.hodlerContract = new ethers.Contract(
            this.hodlerAddress,
            hodlerLocksAbi,
            this.provider
          )
        }
      }).bind(this)
    )
    if (this.useRegistrator == 'true') {
      this.registratorContract = new ethers.Contract(
        this.registratorAddress,
        registratorABI,
        this.provider
      )
    }
    if (this.useHodler == 'true') {
      this.hodlerContract = new ethers.Contract(
        this.hodlerAddress,
        hodlerLocksAbi,
        this.provider
      )
    }

    const eventsDiscoveryServiceState =
      await this.eventsDiscoveryServiceStateModel.findOne()

    if (eventsDiscoveryServiceState) {
      this.state = eventsDiscoveryServiceState.toObject()
    } else {
      await this.eventsDiscoveryServiceStateModel.create(this.state)
    }

    if (this.doClean != 'true') {
      this.logger.log('Skipped cleaning up old jobs')
    } else {
      this.logger.log('Cleaning up old (24hrs+) jobs')
      await this.discoverRegistratorEventsQueue.drain(true)
      await this.discoverRegistratorEventsQueue.clean(0, -1, 'active')
      await this.discoverRegistratorEventsQueue.clean(0, -1, 'completed')
      await this.discoverRegistratorEventsQueue.clean(0, -1, 'failed')

      await this.discoverHodlerEventsQueue.drain(true)
      await this.discoverHodlerEventsQueue.clean(0, -1, 'active')
      await this.discoverHodlerEventsQueue.clean(0, -1, 'completed')
      await this.discoverHodlerEventsQueue.clean(0, -1, 'failed')
      if (this.state.isDiscovering) {
        this.state.isDiscovering = false
        await this.updateServiceState()
      }
    }

    if (this.doDbNuke === 'true') {
      this.logger.log('Nuking DB')
      const { deletedCount } = await this.registeredEventModel.deleteMany({})
      this.logger.log(`Nuked RegisteredEvent collection: ${deletedCount} del`)
    }

    if (this.state.isDiscovering) {
      this.logger.log('Discovering registrator events should already be queued')
    } else {
      if (this.useRegistrator == 'true') {
        await this.enqueueDiscoverRegistratorEventsFlow(0)
      }
      if (this.useHodler == 'true') {
        await this.enqueueDiscoverHodlerEventsFlow(0)
      }
      this.logger.log('Queued immediate discovery of registrator events')
    }
  }

  public async discoverLockedEvents(from?: ethers.BlockTag) {
    const fromBlock = from || this.hodlerContractDeployedBlock

    this.logger.log(
      `Discovering Locked events from block ${fromBlock.toString()}`
    )

    const filter = this.hodlerContract.filters['Locked']()
    const events = (await this.hodlerContract.queryFilter(
      filter,
      fromBlock
    )) as ethers.EventLog[]

    this.logger.log(
      `Found ${events.length} Locked events` +
        ` since block ${fromBlock.toString()}`
    )

    let knownEvents = 0,
      newEvents = 0
    for (const evt of events) {
      const knownEvent = await this.registeredEventModel.findOne({
        eventName: 'Locked',
        transactionHash: evt.transactionHash
      })

      if (!knownEvent) {
        try {
          await this.registeredEventModel.create({
            blockNumber: evt.blockNumber,
            blockHash: evt.blockHash,
            transactionHash: evt.transactionHash,
            address: evt.args[3],
            fingerprint: evt.args[1]
          })
          newEvents++
        } catch (err) {
          this.logger.error(`RegisteredEvent model creation error`, err.stack)
        }
      } else {
        knownEvents++
      }
    }

    this.logger.log(
      `Stored ${newEvents} newly discovered` +
        ` Locked events` +
        ` and skipped storing ${knownEvents} previously known` +
        ` out of ${events.length} total`
    )
  }
  
  public async matchDiscoveredLockedEvents(currentBlock: number) {
    this.logger.log('Matching Locked events to Operator Registry State')

    const unfulfilledRegisteredEvents = await this.registeredEventModel.find({
      eventName: 'Locked',
      fulfilled: false
    })

    if (unfulfilledRegisteredEvents.length < 1) {
      this.logger.log(`No unfulfilled Registered events to match`)

      return
    }

    this.logger.log(
      `Found ${unfulfilledRegisteredEvents.length}` +
        ` unfulfilled Registered events`
    )

    const operatorRegistryState =
      await this.operatorRegistryService.getOperatorRegistryState()

    let matchedCount = 0
    const unmatchedEvents: typeof unfulfilledRegisteredEvents = []
    for (const unfulfilledEvent of unfulfilledRegisteredEvents) {
      const address = `0x${unfulfilledEvent.address.substring(2).toUpperCase()}`
      const fingerprint = unfulfilledEvent.fingerprint
      if (
        operatorRegistryState.RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint] === address ||
        operatorRegistryState.VerifiedFingerprintsToOperatorAddresses[fingerprint] === address ||
        operatorRegistryState.VerifiedHardwareFingerprints[fingerprint]
      ) {
        unfulfilledEvent.fulfilled = true
        await unfulfilledEvent.save()
        matchedCount++
      } else {
        this.logger.log(`Unmatched Locked event: [${JSON.stringify(unfulfilledEvent)}]`)
        unmatchedEvents.push(unfulfilledEvent)
      }
    }

    const unmatchedToQueue = sortBy(
      uniqBy(
        unmatchedEvents.map(
          ({ address, fingerprint, transactionHash, blockNumber }) => ({
            address,
            fingerprint,
            transactionHash,
            blockNumber
          })
        ),
        ({ address, fingerprint }) => address + fingerprint
      ),
      'blockNumber'
    )

    for (const { address, fingerprint, transactionHash } of unmatchedToQueue) {
      await this.eventsService.enqueueAddRegistrationCredit(
        address,
        transactionHash,
        fingerprint
      )
    }

    const duplicates = unmatchedEvents.length - unmatchedToQueue.length
    const lastSafeCompleteBlock = unmatchedToQueue.length > 0
      ? unmatchedToQueue[0].blockNumber
      : currentBlock

    this.logger.log(
      `Matched ${matchedCount} Locked events to Operator Registry State` +
        ` and enqueued ${unmatchedToQueue.length}` +
        ` Add-Registration-Credit jobs` +
        ` (${duplicates} duplicate address/fingerprint credits)`
    )

    await this.setLastSafeCompleteBlockNumber(lastSafeCompleteBlock)
  }

  public async discoverRegisteredEvents(from?: ethers.BlockTag) {
    const fromBlock = from || this.registratorContractDeployedBlock

    this.logger.log(
      `Discovering Registered events from block ${fromBlock.toString()}`
    )

    const filter = this.registratorContract.filters['Registered']()
    const events = (await this.registratorContract.queryFilter(
      filter,
      fromBlock
    )) as ethers.EventLog[]

    this.logger.log(
      `Found ${events.length} Registered events` +
        ` since block ${fromBlock.toString()}`
    )

    let knownEvents = 0,
      newEvents = 0
    for (const evt of events) {
      const knownEvent = await this.registeredEventModel.findOne({
        eventName: 'Registered',
        transactionHash: evt.transactionHash
      })

      if (!knownEvent) {
        try {
          await this.registeredEventModel.create({
            blockNumber: evt.blockNumber,
            blockHash: evt.blockHash,
            transactionHash: evt.transactionHash,
            address: evt.args[0],
            fingerprint: evt.args[1]
          })
          newEvents++
        } catch (err) {
          this.logger.error(`RegisteredEvent model creation error`, err.stack)
        }
      } else {
        knownEvents++
      }
    }

    this.logger.log(
      `Stored ${newEvents} newly discovered` +
        ` Registered events` +
        ` and skipped storing ${knownEvents} previously known` +
        ` out of ${events.length} total`
    )
  }

  public async matchDiscoveredRegistratorEvents(currentBlock: number) {
    this.logger.log('Matching Registered events to Operator Registry State')

    const unfulfilledRegisteredEvents = await this.registeredEventModel.find({
      eventName: 'Registered',
      fulfilled: false
    })

    if (unfulfilledRegisteredEvents.length < 1) {
      this.logger.log(`No unfulfilled Registered events to match`)

      return
    }

    this.logger.log(
      `Found ${unfulfilledRegisteredEvents.length}` +
        ` unfulfilled Registered events`
    )

    const operatorRegistryState =
      await this.operatorRegistryService.getOperatorRegistryState()

    let matchedCount = 0
    const unmatchedEvents: typeof unfulfilledRegisteredEvents = []
    for (const unfulfilledEvent of unfulfilledRegisteredEvents) {
      const address = `0x${unfulfilledEvent.address.substring(2).toUpperCase()}`
      const fingerprint = unfulfilledEvent.fingerprint
      if (
        operatorRegistryState.RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint] === address ||
        operatorRegistryState.VerifiedFingerprintsToOperatorAddresses[fingerprint] === address ||
        operatorRegistryState.VerifiedHardwareFingerprints[fingerprint]
      ) {
        unfulfilledEvent.fulfilled = true
        await unfulfilledEvent.save()
        matchedCount++
      } else {
        this.logger.log(`Unmatched Registered event: [${JSON.stringify(unfulfilledEvent)}]`)
        unmatchedEvents.push(unfulfilledEvent)
      }
    }

    const unmatchedToQueue = sortBy(
      uniqBy(
        unmatchedEvents.map(
          ({ address, fingerprint, transactionHash, blockNumber }) => ({
            address,
            fingerprint,
            transactionHash,
            blockNumber
          })
        ),
        ({ address, fingerprint }) => address + fingerprint
      ),
      'blockNumber'
    )

    for (const { address, fingerprint, transactionHash } of unmatchedToQueue) {
      await this.eventsService.enqueueAddRegistrationCredit(
        address,
        transactionHash,
        fingerprint
      )
    }

    const duplicates = unmatchedEvents.length - unmatchedToQueue.length
    const lastSafeCompleteBlock = unmatchedToQueue.length > 0
      ? unmatchedToQueue[0].blockNumber
      : currentBlock

    this.logger.log(
      `Matched ${matchedCount} Registered events to Operator Registry State` +
        ` and enqueued ${unmatchedToQueue.length}` +
        ` Add-Registration-Credit jobs` +
        ` (${duplicates} duplicate address/fingerprint credits)`
    )

    await this.setLastSafeCompleteBlockNumber(lastSafeCompleteBlock)
  }

  public async enqueueDiscoverRegistratorEventsFlow(
    delayJob: number = 1000 * 60 * 60 * 1
  ) {
    if (!this.state.isDiscovering) {
      this.state.isDiscovering = true
      await this.updateServiceState()
    }

    const currentBlock = await this.provider.getBlockNumber()

    await this.discoverRegistratorEventsFlow.add({
      name: DiscoverRegistratorEventsQueue.JOB_MATCH_REGISTERED_EVENTS,
      queueName: 'discover-registrator-events-queue',
      opts: EventsDiscoveryService.jobOpts,
      data: { currentBlock },
      children: [
        {
          name: DiscoverRegistratorEventsQueue.JOB_DISCOVER_REGISTERED_EVENTS,
          queueName: 'discover-registrator-events-queue',
          opts: { delay: delayJob, ...EventsDiscoveryService.jobOpts },
          data: { currentBlock }
        }
      ]
    })

    this.logger.log(
      '[alarm=enqueued-discover-registrator-events] Enqueued discover registrator events flow'
    )
  }
  
  public async enqueueDiscoverHodlerEventsFlow(
    delayJob: number = 1000 * 60 * 60 * 1
  ) {
    if (!this.state.isDiscovering) {
      this.state.isDiscovering = true
      await this.updateServiceState()
    }

    const currentBlock = await this.provider.getBlockNumber()

    await this.discoverHodlerEventsFlow.add({
      name: DiscoverHodlerEventsQueue.JOB_MATCH_REGISTERED_EVENTS,
      queueName: 'discover-hodler-events-queue',
      opts: EventsDiscoveryService.jobOpts,
      data: { currentBlock },
      children: [
        {
          name: DiscoverHodlerEventsQueue.JOB_DISCOVER_REGISTERED_EVENTS,
          queueName: 'discover-hodler-events-queue',
          opts: { delay: delayJob, ...EventsDiscoveryService.jobOpts },
          data: { currentBlock }
        }
      ]
    })

    this.logger.log(
      '[alarm=enqueued-discover-hodler-events] Enqueued discover hodler events flow'
    )
  }

  private async updateServiceState() {
    await this.eventsDiscoveryServiceStateModel.updateMany({}, this.state)
  }

  private async setLastSafeCompleteBlockNumber(blockNumber: number) {
    this.logger.log(`Setting last safe complete block number ${blockNumber}`)

    this.state.lastSafeCompleteBlock = blockNumber
    await this.updateServiceState()
  }

  public async getLastSafeCompleteBlockNumber() {
    return this.state.lastSafeCompleteBlock
  }
}
