package collect

import (
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc"   // pragma: allowlist secret
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/wgkeys" // pragma: allowlist secret
)

type CPU struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
	Cores  int     `json:"cores,omitempty"`
}

type WireGuardMetrics struct {
	HandshakeAgeSeconds *int `json:"handshake_age_seconds"`
}

type Metrics struct {
	UptimeSeconds int64            `json:"uptime_seconds"`
	CPU           CPU              `json:"cpu"`
	Memory        Memory           `json:"memory"`
	Disks         []Disk           `json:"disks"`
	Network       []NetworkIface   `json:"network"`
	WireGuard     WireGuardMetrics `json:"wireguard"`
}

func handshakeAgeSeconds(tunnelName string) *int {
	result := proc.RunDefault(wgkeys.WgExe(), "show", tunnelName, "dump")
	if result.Code != 0 {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(result.Stdout), "\n")
	if len(lines) < 2 {
		return nil
	}
	fields := strings.Fields(lines[1])
	if len(fields) < 5 {
		return nil
	}
	unix, err := strconv.ParseInt(fields[4], 10, 64)
	if err != nil || unix == 0 {
		return nil
	}
	age := int(time.Now().Unix() - unix)
	if age < 0 {
		age = 0
	}
	return &age
}

func CollectMetrics(tunnelName string) Metrics {
	cores := runtime.NumCPU()
	if cores < 1 {
		cores = 1
	}
	load1, load5, load15 := platformLoadavg()
	return Metrics{
		UptimeSeconds: platformUptime(),
		CPU: CPU{
			Load1:  load1,
			Load5:  load5,
			Load15: load15,
			Cores:  cores,
		},
		Memory:  platformMemory(),
		Disks:   nonempty(platformDisks()),
		Network: nonempty(platformNetwork()),
		WireGuard: WireGuardMetrics{
			HandshakeAgeSeconds: handshakeAgeSeconds(tunnelName),
		},
	}
}
