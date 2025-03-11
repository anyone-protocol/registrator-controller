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
      driver = "docker"
      config {
        image = "ghcr.io/anyone-protocol/registrator-controller:b4ddd595e8532bf0e79d0357b44f48636a60a089"
        force_pull = true
      }

      vault {
        policies = ["valid-ator-stage", "registrator-controller-service-keys-stage"]
      }

      template {
        data = <<-EOH
        OPERATOR_REGISTRY_PROCESS_ID="cFTzntWbZFBfReuz9pAY7wRoRVlYuCW5TH90jiwN6hI"
        REGISTRATOR_CONTRACT_ADDRESS="0xa7325b28ED397AC0391529425bB7d5C34dD4FD74"
        {{with secret "kv/valid-ator/stage"}}
          REGISTRATOR_OPERATOR_KEY="{{.Data.data.REGISTRATOR_OPERATOR_KEY}}"
          EVM_NETWORK="{{.Data.data.INFURA_NETWORK}}"
          EVM_PRIMARY_WSS="{{.Data.data.INFURA_WS_URL}}"
          EVM_SECONDARY_WSS="{{.Data.data.ALCHEMY_WS_URL}}"
          EVM_JSON_RPC="{{.Data.data.JSON_RPC}}"
        {{end}}
        {{- range service "validator-stage-mongo" }}
          MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/registrator-controller-stage"
        {{- end }}
        {{- range service "registrator-controller-stage-redis" }}
          REDIS_HOSTNAME="{{ .Address }}"
          REDIS_PORT="{{ .Port }}"
        {{- end }}

        {{$prefix := "worker_" }}
        {{$allocIndex := env "NOMAD_ALLOC_INDEX"}}
        {{$suffix := "_key" }}
        {{with secret "kv/controller-service-keys/registrator-controller-stage" }}
          OPERATOR_REGISTRY_CONTROLLER_KEY="{{index .Data.data (print $prefix $allocIndex $suffix) }}"
        {{end}}
        EOH
        destination = "local/file.env"
        env         = true
      }

      env {
        BUMP="redeploy-rewards-3"
        IS_LIVE="true"
        VERSION="b4ddd595e8532bf0e79d0357b44f48636a60a089"
        CPU_COUNT="1"
        DO_CLEAN="true"
        REGISTRATOR_CONTRACT_DEPLOYED_BLOCK="6204399"
        IS_LOCAL_LEADER="true"
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
