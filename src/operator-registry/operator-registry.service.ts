import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  AosSigningFunction,
  sendAosDryRun,
  sendAosMessage
} from '../util/send-aos-message'
import { createEthereumDataItemSigner } from '../util/create-ethereum-data-item-signer'
import { EthereumSigner } from '../util/arbundles-lite'

@Injectable()
export class OperatorRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OperatorRegistryService.name)

  private readonly operatorRegistryProcessId: string
  private readonly operatorRegistryControllerKey: string

  private signer!: AosSigningFunction

  constructor(
    private readonly config: ConfigService<{
      OPERATOR_REGISTRY_CONTROLLER_KEY: string
      OPERATOR_REGISTRY_PROCESS_ID: string
      IS_LIVE: string
    }>
  ) {
    this.operatorRegistryProcessId = config.get<string>(
      'OPERATOR_REGISTRY_PROCESS_ID',
      { infer: true }
    )
    if (!this.operatorRegistryProcessId) {
      throw new Error('OPERATOR_REGISTRY_PROCESS_ID is not set!')
    }

    this.operatorRegistryControllerKey = config.get<string>(
      'OPERATOR_REGISTRY_CONTROLLER_KEY',
      { infer: true }
    )
    if (!this.operatorRegistryControllerKey) {
      throw new Error('OPERATOR_REGISTRY_CONTROLLER_KEY is not set!')
    }
  }

  async onApplicationBootstrap() {
    this.signer = await createEthereumDataItemSigner(
      new EthereumSigner(this.operatorRegistryControllerKey)
    )
  }

  public async getOperatorRegistryState(): Promise<{
    RegistrationCreditsFingerprintsToOperatorAddresses: {
      [fingerprint: string]: string
    }
    VerifiedFingerprintsToOperatorAddresses: { [fingerprint: string]: string }
    VerifiedHardwareFingerprints: { [fingerprint: string]: boolean }
  }> {
    const operatorRegistryState = {
      RegistrationCreditsFingerprintsToOperatorAddresses: {},
      VerifiedFingerprintsToOperatorAddresses: {},
      VerifiedHardwareFingerprints: {}
    }

    const { result: registrationCreditsResult } = await sendAosDryRun({
      processId: this.operatorRegistryProcessId,
      tags: [{ name: 'Action', value: 'List-Registration-Credits' }]
    })
    const parsedRegistrationCredits = JSON.parse(
      registrationCreditsResult.Messages[0].Data
    )
    operatorRegistryState.RegistrationCreditsFingerprintsToOperatorAddresses =
      Array.isArray(parsedRegistrationCredits) ? {} : parsedRegistrationCredits

    const { result: verifiedFingerprintsResult } = await sendAosDryRun({
      processId: this.operatorRegistryProcessId,
      tags: [{ name: 'Action', value: 'List-Fingerprint-Certificates' }]
    })
    const parsedVerifiedFingerprints = JSON.parse(
      verifiedFingerprintsResult.Messages[0].Data
    )
    operatorRegistryState.VerifiedFingerprintsToOperatorAddresses =
      Array.isArray(parsedVerifiedFingerprints)
        ? {}
        : parsedVerifiedFingerprints

    const { result: verifiedHardwareResult } = await sendAosDryRun({
      processId: this.operatorRegistryProcessId,
      tags: [{ name: 'Action', value: 'List-Verified-Hardware' }]
    })
    const parsedVerifiedHardware = JSON.parse(
      verifiedHardwareResult.Messages[0].Data
    )
    operatorRegistryState.VerifiedHardwareFingerprints = Array.isArray(
      parsedVerifiedHardware
    )
      ? {}
      : parsedVerifiedHardware

    return operatorRegistryState
  }

  public async addRegistrationCredit(
    address: string,
    transactionHash: string,
    fingerprint: string
  ): Promise<boolean> {
    if (!this.signer) {
      throw new Error('Signer is not defined!')
    }

    try {
      const { messageId, result } = await sendAosMessage({
        processId: this.operatorRegistryProcessId,
        signer: this.signer as any, // NB: types, lol
        tags: [
          { name: 'Action', value: 'Add-Registration-Credit' },
          { name: 'Address', value: address },
          { name: 'Fingerprint', value: fingerprint },
          { name: 'EVM-TX', value: transactionHash }
        ]
      })

      if (!result.Error) {
        this.logger.log(
          `Added registration credit to [${address}|${fingerprint}]: ${
            messageId ?? 'no-message-id'
          }`
        )

        return true
      }

      this.logger.warn(
        `Add-Registration-Credit resulted in an Error for ` +
          ` [${JSON.stringify({ address, transactionHash, fingerprint })}]`,
        result.Error
      )
    } catch (error) {
      this.logger.error(
        `Exception when adding registration credit` +
          ` [${JSON.stringify({ address, transactionHash, fingerprint })}]`,
        error.stack
      )
    }

    return false
  }
}
