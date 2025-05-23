import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Wallet } from 'ethers'

import {
  AosSigningFunction,
  sendAosDryRun,
  sendAosMessage
} from '../util/send-aos-message'
import { createEthereumDataItemSigner } from '../util/create-ethereum-data-item-signer'
import { EthereumSigner } from '../util/arbundles-lite'
import { OperatorRegistryState } from './interfaces/operator-registry'

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
    const wallet = new Wallet(this.operatorRegistryControllerKey)
    const address = await wallet.getAddress()
    this.logger.log(`Bootstrapped Operator Registry ${this.operatorRegistryProcessId} with signer address ${address}`)
  }

  public async getOperatorRegistryState(): Promise<OperatorRegistryState> {
    const { result } = await sendAosDryRun({
      processId: this.operatorRegistryProcessId,
      tags: [{ name: 'Action', value: 'View-State' }]
    })

    if (result.Error) {
      this.logger.error(
        `Error when calling View-State on operator registry process: ${result.Error}`
      )
      throw new Error(result.Error)
    }
    if (!result.Messages || result.Messages.length < 1) {
      this.logger.error(
        `Error when calling View-State on operator registry process: no messages`
      )
      throw new Error('No messages returned from View-State')
    }

    const state = JSON.parse(result.Messages[0].Data)

    for (const prop in state) {
      // NB: Lua returns empty tables as JSON arrays, so we normalize them to
      //     empty objects as when they are populated they will also be objects
      if (Array.isArray(state[prop]) && state[prop].length < 1) {
        state[prop] = {}
      }
    }

    return state
  }

  public async removeRegistrationCredit(
    address: string,
    label: string,
    fingerprint: string    
  ) {
    if (!this.signer) {
      throw new Error('Signer is not defined!')
    }

    try {
      const { messageId, result } = await sendAosMessage({
        processId: this.operatorRegistryProcessId,
        signer: this.signer as any, // NB: types, lol
        tags: [
          { name: 'Action', value: 'Remove-Registration-Credit' },
          { name: 'Address', value: address },
          { name: 'Fingerprint', value: fingerprint },
          { name: 'EVM-TX', value: label }
        ]
      })

      if (!result.Error) {
        this.logger.log(
          `Removed registration credit from [${address}|${fingerprint}]: ${
            messageId ?? 'no-message-id'
          }`
        )
      }

      this.logger.warn(
        `Remove-Registration-Credit resulted in an Error for ` +
          ` [${JSON.stringify({ address, transactionHash: label, fingerprint })}]`,
        result.Error
      )
    } catch (error) {
      if (error.message.includes('400') && error.message.includes('MessageExists')) {
        this.logger.warn(
          `Remove-Registration-Credit resulted in a MessageExists Error for ` +
            ` [${JSON.stringify({ address, transactionHash: label, fingerprint })}]`
        )
      }

      this.logger.error(
        `Exception when removing registration credit` +
          ` [${JSON.stringify({ address, transactionHash: label, fingerprint })}]`,
        error.stack
      )
    }
  }

  public async addRegistrationCredit(
    address: string,
    label: string,
    fingerprint: string,
    checkAndRemoveStaleCredits = true
  ): Promise<boolean> {
    if (!this.signer) {
      throw new Error('Signer is not defined!')
    }

    if (checkAndRemoveStaleCredits) {
      const state = await this.getOperatorRegistryState()
      const uppercaseAddress = `0x${address.substring(2).toUpperCase()}`
      const existingAddress = state.RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
      if (existingAddress && existingAddress !== uppercaseAddress) {
        this.logger.warn(
          `Removing stale registration credit from [${existingAddress}|${fingerprint}]`
        )
        await this.removeRegistrationCredit(existingAddress, label, fingerprint)
      } else if (existingAddress && existingAddress === uppercaseAddress) {
        this.logger.warn(`Registration credit already exists for [${address}|${fingerprint}]`)
        return true
      }
    }

    try {
      const { messageId, result } = await sendAosMessage({
        processId: this.operatorRegistryProcessId,
        signer: this.signer as any, // NB: types, lol
        tags: [
          { name: 'Action', value: 'Add-Registration-Credit' },
          { name: 'Address', value: address },
          { name: 'Fingerprint', value: fingerprint },
          { name: 'EVM-TX', value: label }
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
          ` [${JSON.stringify({ address, transactionHash: label, fingerprint })}]`,
        result.Error
      )
    } catch (error) {
      if (error.message.includes('400') && error.message.includes('MessageExists')) {
        this.logger.warn(
          `Add-Registration-Credit resulted in a MessageExists Error for ` +
            ` [${JSON.stringify({ address, transactionHash: label, fingerprint })}]`
        )

        return true
      }

      this.logger.error(
        `Exception when adding registration credit` +
          ` [${JSON.stringify({ address, transactionHash: label, fingerprint })}]`,
        error.stack
      )
    }

    this.logger.warn(
      '[alarm=add-registration-credit-failed] Failed to add registration credit for ' +
        ` [${JSON.stringify({ address, transactionHash: label, fingerprint })}]`
    )

    return false
  }
}
