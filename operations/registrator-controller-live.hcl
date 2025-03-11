job "registrator-controller-live" {
  datacenters = ["ator-fin"]
  type = "service"

  constraint {
    attribute = "${node.unique.id}"
    value = "89b957c9-560a-126e-1ae8-13277258fcf1" # anon-hel-arweave-1
  }

  group "registrator-controller-live-group" {
    count = 1

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
        policies = ["valid-ator-live", "registrator-controller-service-keys"]
      }

      template {
        data = <<-EOH
        OPERATOR_REGISTRY_PROCESS_ID="[[ consulKey "smart-contracts/live/operator-registry-address" ]]"
        REGISTRATOR_CONTRACT_ADDRESS="[[ consulKey "registrator/sepolia/live/address" ]]"
        {{with secret "kv/valid-ator/live"}}
          REGISTRATOR_OPERATOR_KEY="{{.Data.data.REGISTRATOR_OPERATOR_KEY}}"
          EVM_NETWORK="{{.Data.data.INFURA_NETWORK}}"
          EVM_PRIMARY_WSS="{{.Data.data.INFURA_WS_URL}}"
          EVM_SECONDARY_WSS="{{.Data.data.ALCHEMY_WS_URL}}"
          EVM_JSON_RPC="{{.Data.data.JSON_RPC}}"
        {{end}}
        {{- range service "validator-live-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/registrator-controller-live"
        {{- end }}
        {{- range service "registrator-controller-live-redis" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{$prefix := "worker_" }}
        {{$allocIndex := env "NOMAD_ALLOC_INDEX"}}
        {{$suffix := "_key" }}
        {{with secret "kv/controller-service-keys/registrator-controller" }}
          OPERATOR_REGISTRY_CONTROLLER_KEY="{{index .Data.data (print $prefix $allocIndex $suffix) }}"
        {{end}}
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
        IS_LOCAL_LEADER="true"
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
