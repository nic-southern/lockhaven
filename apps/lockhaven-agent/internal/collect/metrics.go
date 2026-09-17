package collect

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc"
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

func loadavg() (float64, float64, float64) {
	raw := readTrimmed("/proc/loadavg")
	fields := strings.Fields(raw)
	if len(fields) < 3 {
		return 0, 0, 0
	}
	one, _ := strconv.ParseFloat(fields[0], 64)
	five, _ := strconv.ParseFloat(fields[1], 64)
	fifteen, _ := strconv.ParseFloat(fields[2], 64)
	return one, five, fifteen
}

func uptimeSeconds() int64 {
	raw := readTrimmed("/proc/uptime")
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0
	}
	seconds, _ := strconv.ParseFloat(fields[0], 64)
	return int64(seconds)
}

func handshakeAgeSeconds(tunnelName string) *int {
	result := proc.RunDefault("wg", "show", tunnelName, "dump")
	if result.Code != 0 {
		return nil
	}
	// dump: private_key public_key ... then peer lines:
	// public_key preshared_key endpoint allowed_ips handshake rx tx keepalive
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
	one, five, fifteen := loadavg()
	memRaw, err := os.ReadFile("/proc/meminfo")
	var memory Memory
	if err == nil {
		memory = ParseProcMeminfo(string(memRaw))
	}
	netRaw, err := os.ReadFile("/proc/net/dev")
	var network []NetworkIface
	if err == nil {
		network = ParseProcNetDev(string(netRaw))
	}
	df := proc.RunDefault("df", "-kP")
	disks := []Disk{}
	if df.Code == 0 {
		disks = ParseDfKp(df.Stdout)
	}
	if disks == nil {
		disks = []Disk{}
	}
	if network == nil {
		network = []NetworkIface{}
	}
	cores := runtime.NumCPU()
	if cores < 1 {
		cores = 1
	}
	return Metrics{
		UptimeSeconds: uptimeSeconds(),
		CPU: CPU{
			Load1:  one,
			Load5:  five,
			Load15: fifteen,
			Cores:  cores,
		},
		Memory:  memory,
		Disks:   disks,
		Network: network,
		WireGuard: WireGuardMetrics{
			HandshakeAgeSeconds: handshakeAgeSeconds(tunnelName),
		},
	}
}
