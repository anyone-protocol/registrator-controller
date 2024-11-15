import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

import { createResilientProviders } from '../util/resilient-websocket-provider'

const DefaultEvmProviderServiceConfig = {
  EVM_NETWORK: '',
  EVM_PRIMARY_WSS: '',
  EVM_SECONDARY_WSS: ''
}
const DESTROY_WEBSOCKET_INTERVAL = 5

@Injectable()
export class EvmProviderService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(EvmProviderService.name)

  public readonly config: typeof DefaultEvmProviderServiceConfig =
    DefaultEvmProviderServiceConfig

  private primaryWebSocketProvider!: ethers.WebSocketProvider
  private secondaryWebSocketProvider!: ethers.WebSocketProvider
  private currentWebSocketProvider!: ethers.WebSocketProvider
  private currentWebSocketName: 'primary (infura)' | 'secondary (alchemy)' =
    'primary (infura)'

  private providerSwapCallbacks: ((
    provider: ethers.WebSocketProvider
  ) => void)[] = []

  constructor(config: ConfigService<typeof DefaultEvmProviderServiceConfig>) {
    this.config.EVM_NETWORK = config.get<string>('EVM_NETWORK', { infer: true })
    if (!this.config.EVM_NETWORK) {
      throw new Error('EVM_NETWORK is not set!')
    }
    this.config.EVM_PRIMARY_WSS = config.get<string>('EVM_PRIMARY_WSS', {
      infer: true
    })
    if (!this.config.EVM_PRIMARY_WSS) {
      throw new Error('EVM_PRIMARY_WSS is not set!')
    }
    this.config.EVM_SECONDARY_WSS = config.get<string>('EVM_SECONDARY_WSS', {
      infer: true
    })
    if (!this.config.EVM_SECONDARY_WSS) {
      throw new Error('EVM_SECONDARY_WSS is not set!')
    }
  }

  onApplicationShutdown() {
    const waitForWebsocketAndDestroy = (provider: ethers.WebSocketProvider) => {
      setTimeout(() => {
        if (provider.websocket.readyState) {
          provider.destroy()
        } else {
          waitForWebsocketAndDestroy(provider)
        }
      }, DESTROY_WEBSOCKET_INTERVAL)
    }

    waitForWebsocketAndDestroy(this.primaryWebSocketProvider)
    waitForWebsocketAndDestroy(this.secondaryWebSocketProvider)
  }

  async onApplicationBootstrap() {
    const [primaryProvider] = await createResilientProviders(
      [{ url: this.config.EVM_PRIMARY_WSS, name: 'primary (infura)' }],
      this.config.EVM_NETWORK,
      this.swapProviders.bind(this)
    )
    this.primaryWebSocketProvider = primaryProvider
    const [secondaryProvider] = await createResilientProviders(
      [{ url: this.config.EVM_SECONDARY_WSS, name: 'secondary (alchemy)' }],
      this.config.EVM_NETWORK,
      this.swapProviders.bind(this)
    )
    this.secondaryWebSocketProvider = secondaryProvider
    this.currentWebSocketProvider = this.primaryWebSocketProvider
  }

  private swapProviders() {
    if (this.currentWebSocketName === 'primary (infura)') {
      this.currentWebSocketName = 'secondary (alchemy)'
      this.currentWebSocketProvider = this.secondaryWebSocketProvider
    } else {
      this.currentWebSocketName = 'primary (infura)'
      this.currentWebSocketProvider = this.primaryWebSocketProvider
    }

    for (const providerSwapCallback of this.providerSwapCallbacks) {
      providerSwapCallback(this.currentWebSocketProvider)
    }

    this.logger.log(`Swapped provider to ${this.currentWebSocketName}`)
  }

  private async waitOnBootstrap() {
    this.logger.debug('Waiting for service to bootstrap')
    return new Promise<void>((resolve) => {
      const checkReadyAndResolve = () => {
        if (
          this.currentWebSocketProvider &&
          this.currentWebSocketProvider.websocket &&
          this.currentWebSocketProvider.websocket.readyState
        ) {
          this.logger.debug(`Service is bootstrapped and ready`)
          resolve()
        } else {
          setTimeout(checkReadyAndResolve, 100)
        }
      }

      checkReadyAndResolve()
    })
  }

  async getCurrentWebSocketProvider(
    onSwapProvidersCallback: (provider: ethers.WebSocketProvider) => void
  ) {
    await this.waitOnBootstrap()
    this.providerSwapCallbacks.push(onSwapProvidersCallback)

    return this.currentWebSocketProvider
  }
}
