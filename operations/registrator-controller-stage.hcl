job "registrator-controller-stage" {
  datacenters = ["ator-fin"]
  type = "service"

  constraint {
    attribute = "${node.unique.id}"
    value = "89b957c9-560a-126e-1ae8-13277258fcf1" # anon-hel-arweave-1
  }

  group "registrator-controller-stage-group" {
    count = 1

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

    task "registrator-controller-stage-service" {
      kill_timeout = "30s"
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/registrator-controller:b4ddd595e8532bf0e79d0357b44f48636a60a089"
        force_pull = true
      }

      vault {
        policies = [
          "valid-ator-stage",
          "registrator-controller-service-keys-stage",
          "jsonrpc-stage-registrator-controller-eth"
        ]
      }

      template {
        data = <<-EOH
        OPERATOR_REGISTRY_PROCESS_ID="[[ consulKey "smart-contracts/stage/operator-registry-address" ]]"
        REGISTRATOR_CONTRACT_ADDRESS="[[ consulKey "registrator/sepolia/stage/address" ]]"
        HODLER_CONTRACT_ADDRESS="[[ consulKey "hodler/sepolia/stage/address" ]]"

        {{- range service "validator-stage-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/registrator-controller-stage"
        {{- end }}
        {{- range service "registrator-controller-stage-redis" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{ $workerPrefix := "worker_" }}
        {{ $apiKeyPrefix := "api_key_" }}
        {{ $allocIndex := env "NOMAD_ALLOC_INDEX" }}
        {{ $workerSuffix := "_key" }}

        {{ with secret "kv/valid-ator/stage" }}
          REGISTRATOR_OPERATOR_KEY="{{ .Data.data.REGISTRATOR_OPERATOR_KEY }}"
          EVM_NETWORK="{{ .Data.data.INFURA_NETWORK }}"
        {{ end }}
        {{ with secret "kv/controller-service-keys/registrator-controller-stage" }}
          OPERATOR_REGISTRY_CONTROLLER_KEY="{{ index .Data.data (print $workerPrefix $allocIndex $workerSuffix) }}"
        {{ end }}
        {{ with secret "kv/jsonrpc/stage/registrator-controller/infura/eth" }}
          EVM_PRIMARY_WSS="wss://sepolia.infura.io/ws/v3/{{ index .Data.data (print $apiKeyPrefix $allocIndex) }}"
          EVM_JSON_RPC="https://sepolia.infura.io/v3/{{ index .Data.data (print $apiKeyPrefix $allocIndex) }}"
        {{ end }}
        {{ with secret "kv/jsonrpc/stage/registrator-controller/alchemy/eth" }}
          EVM_SECONDARY_WSS="wss://eth-sepolia.g.alchemy.com/v2/{{ index .Data.data (print $apiKeyPrefix $allocIndex) }}"
        {{ end }}
        EOH
        destination = "local/file.env"
        env         = true
      }

      env {
        BUMP="redeploy-rewards-3"
        IS_LIVE="true"
        VERSION="[[.commit_sha]]"
        CPU_COUNT="1"
        DO_CLEAN="false"
        REGISTRATOR_CONTRACT_DEPLOYED_BLOCK="6204399"
        HODLER_CONTRACT_DEPLOYED_BLOCK="7879442"
        CU_URL="https://cu.anyone.permaweb.services"
        USE_HODLER="true"
      }
      
      resources {
        cpu    = 4096
        memory = 8192
      }

      service {
        name = "registrator-controller-stage"
        port = "registrator-controller-port"
        tags = ["logging"]
        
        check {
          name     = "Stage registrator-controller health check"
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
