import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import { Contract, JsonRpcProvider } from 'ethers'

import { registratorABI } from '../events/abi/registrator'
import { EventsService } from '../events/events.service'
import { EvmProviderService } from '../evm-provider/evm-provider.service'
import { OperatorRegistryService } from '../operator-registry/operator-registry.service'

@Injectable()
export class HealingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealingService.name)

  private isLive?: string
  private doClean?: string
  private registratorAddress?: string
  private registratorContract: Contract

  static readonly removeOnComplete = true
  static readonly removeOnFail = 8

  public static jobOpts = {
    removeOnComplete: HealingService.removeOnComplete,
    removeOnFail: HealingService.removeOnFail
  }

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      DO_CLEAN: boolean
      EVM_JSON_RPC: string
      EVM_NETWORK: string
      REGISTRATOR_CONTRACT_ADDRESS: string
    }>,
    @InjectQueue('healing-queue') public healingQueue: Queue,
    private readonly eventsService: EventsService,
    private readonly operatorRegistryService: OperatorRegistryService
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.doClean = this.config.get<string>('DO_CLEAN', { infer: true })

    const evmJsonRpcUrl = config.get<string>('EVM_JSON_RPC', {
      infer: true
    })
    if (!evmJsonRpcUrl) {
      throw new Error('EVM_JSON_RPC is not set!')
    }
    const evmNetwork = config.get<string>('EVM_NETWORK', { infer: true })
    if (!evmNetwork) {
      throw new Error('EVM_NETWORK is not set!')
    }
    this.registratorAddress = this.config.get<string>(
      'REGISTRATOR_CONTRACT_ADDRESS',
      { infer: true }
    )
    if (!this.registratorAddress) {
      throw new Error('REGISTRATOR_CONTRACT_ADDRESS is not set!')
    }
    this.registratorContract = new Contract(
      this.registratorAddress,
      registratorABI,
      new JsonRpcProvider(evmJsonRpcUrl, evmNetwork)
    )
  }

  async onApplicationBootstrap() {
    this.logger.log('Bootstrapping Tasks Service')

    if (this.doClean != 'true') {
      this.logger.log('Skipped cleaning up old jobs')
    } else {
      this.logger.log('Cleaning up old (24hrs+) jobs')
      await this.healingQueue.clean(24 * 60 * 60 * 1000, -1)
      // await this.validationQueue.clean(24 * 60 * 60 * 1000, -1)
      // await this.verificationQueue.clean(24 * 60 * 60 * 1000, -1)
    }

    if (this.isLive != 'true') {
      this.logger.log('Cleaning up queues for dev...')
      await this.healingQueue.obliterate({ force: true })
      // await this.validationQueue.obliterate({ force: true })
      // await this.verificationQueue.obliterate({ force: true })
    }

    await this.enqueueHealingLocksAndRegistrationCredits(0)
    this.logger.log(
      'Queued immediate healing of locks and registration credits'
    )
  }

  public async enqueueHealingLocksAndRegistrationCredits(
    delayJob: number = 1000 * 60 * 15 // every 15 minutes
  ) {
    await this.healingQueue.add(
      'heal-locks-and-registration-credits',
      {},
      {
        delay: delayJob,
        removeOnComplete: HealingService.removeOnComplete,
        removeOnFail: HealingService.removeOnFail
      }
    )
  }

  public async discoverLocksNeedingRegistrationCredits() {
    this.logger.log('Healing locks and registration credits')

    // Get Registration Credits & Claimable Fingerprints from Operator Registry
    const {
      ClaimableFingerprintsToOperatorAddresses,
      RegistrationCreditsFingerprintsToOperatorAddresses
    } = await this.operatorRegistryService.getOperatorRegistryState()

    // From Claimable Fingerprints, grab the ones without registration credits
    const fingerprintsWithoutRegistrationCredits = Object.keys(ClaimableFingerprintsToOperatorAddresses)
      .filter(fingerprint => !RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint])

    this.logger.log(`Found [${fingerprintsWithoutRegistrationCredits.length}] fingerprints without registration credits`)

    // For each fingerprint without a registration credit, check for a matching lock, & enqueue adding a registration credit
    for (const fingerprint of fingerprintsWithoutRegistrationCredits) {
      const operatorAddress = ClaimableFingerprintsToOperatorAddresses[fingerprint]
      this.logger.log(`Checking operator [${operatorAddress}] for lock with fingerprint [${fingerprint}]`)
      const [
        penalty,
        registrations
      ] = await this.registratorContract.getRegistration(operatorAddress) as [bigint, [bigint, bigint, string, string][]]

      if (registrations.length === 0) {
        this.logger.error(`No registration data found for operator [${operatorAddress}]`)
        continue
      }

      const fingerprintsWithLocks = registrations.map(([
        _amount,
        _unlockAt,
        _unlockTo,
        fingerprintFromContract
      ]) => fingerprintFromContract)

      if (!fingerprintsWithLocks.includes(fingerprint)) {
        this.logger.error(`Operator [${operatorAddress}] does not have a lock for fingerprint [${fingerprint}]`)
        continue
      }

      this.logger.log(`Operator [${operatorAddress}] has a lock for fingerprint [${fingerprint}]`)
      await this.eventsService.enqueueAddRegistrationCredit(operatorAddress, 'from-healing-queue', fingerprint)

      // NB: Don't spam JSON RPC endpoint too quickly :)
      this.logger.log(`Sleeping for 1s before next read from Registrator Contract...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}
