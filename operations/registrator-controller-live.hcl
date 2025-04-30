job "registrator-controller-live" {
  datacenters = ["ator-fin"]
  type = "service"

  constraint {
    attribute = "${node.unique.id}"
    value = "89b957c9-560a-126e-1ae8-13277258fcf1" # anon-hel-arweave-1
  }

  group "registrator-controller-live-group" {
    count = 2

    update {
      stagger      = "30s"
      max_parallel = 1
      canary       = 1
      auto_revert  = true
      auto_promote = true
    }

    network {
      mode = "bridge"
      port "registrator-controller-port" {
        to = 3000
        host_network = "wireguard"
      }
      port "redis" {
        host_network = "wireguard"
      }
    }

    task "registrator-controller-live-service" {
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/registrator-controller:[[.commit_sha]]"
        force_pull = true
      }

      vault {
        policies = [
          "valid-ator-live",
          "registrator-controller-service-keys",
          "jsonrpc-live-registrator-controller-eth"
        ]
      }

      template {
        data = <<-EOH
        OPERATOR_REGISTRY_PROCESS_ID="[[ consulKey "smart-contracts/live/operator-registry-address" ]]"
        REGISTRATOR_CONTRACT_ADDRESS="[[ consulKey "registrator/sepolia/live/address" ]]"
        HODLER_CONTRACT_ADDRESS="[[ consulKey "hodler/sepolia/live/address" ]]"

        {{- range service "validator-live-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/registrator-controller-live"
        {{- end }}
        {{- range service "registrator-controller-live-redis" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{ $workerPrefix := "worker_" }}
        {{ $apiKeyPrefix := "api_key_" }}
        {{ $allocIndex := env "NOMAD_ALLOC_INDEX" }}
        {{ $workerSuffix := "_key" }}

        {{ with secret "kv/valid-ator/live" }}
          REGISTRATOR_OPERATOR_KEY="{{ .Data.data.REGISTRATOR_OPERATOR_KEY }}"
          EVM_NETWORK="{{ .Data.data.INFURA_NETWORK }}"
        {{ end }}
        {{ with secret "kv/controller-service-keys/registrator-controller" }}
          OPERATOR_REGISTRY_CONTROLLER_KEY="{{ index .Data.data (print $workerPrefix $allocIndex $workerSuffix) }}"
        {{ end }}
        {{ with secret "kv/jsonrpc/live/registrator-controller/infura/eth" }}
          EVM_PRIMARY_WSS="wss://sepolia.infura.io/ws/v3/{{ index .Data.data (print $apiKeyPrefix $allocIndex) }}"
          EVM_JSON_RPC="https://sepolia.infura.io/v3/{{ index .Data.data (print $apiKeyPrefix $allocIndex) }}"
        {{ end }}
        {{ with secret "kv/jsonrpc/live/registrator-controller/alchemy/eth" }}
          EVM_SECONDARY_WSS="wss://eth-sepolia.g.alchemy.com/v2/{{ index .Data.data (print $apiKeyPrefix $allocIndex) }}"
        {{ end }}
        EOH
        destination = "secrets/file.env"
        env         = true
      }

      env {
        BUMP="1"
        IS_LIVE="true"
        VERSION="[[.commit_sha]]"
        CPU_COUNT="1"
        DO_CLEAN="true"
        REGISTRATOR_CONTRACT_DEPLOYED_BLOCK="6789472"
        CU_URL="https://cu.anyone.permaweb.services"
        USE_HODLER="false"
        USE_REGISTRATOR="true"
      }
      
      resources {
        cpu    = 4096
        memory = 8192
      }

      service {
        name = "registrator-controller-live"
        port = "registrator-controller-port"
        tags = ["logging"]
        
        check {
          name     = "live registrator-controller health check"
          type     = "http"
          path     = "/health"
          interval = "5s"
          timeout  = "10s"
          check_restart {
            limit = 180
            grace = "15s"
          }
        }
      }
    }
  }
}
