//go:build !windows

package collect

import (
	"os"
	"strconv"
	"strings"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc" // pragma: allowlist secret
)

func platformLoadavg() (float64, float64, float64) {
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

func platformUptime() int64 {
	raw := readTrimmed("/proc/uptime")
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0
	}
	seconds, _ := strconv.ParseFloat(fields[0], 64)
	return int64(seconds)
}

func platformMemory() Memory {
	memRaw, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return Memory{}
	}
	return ParseProcMeminfo(string(memRaw))
}

func platformDisks() []Disk {
	df := proc.RunDefault("df", "-kP")
	if df.Code != 0 {
		return []Disk{}
	}
	return ParseDfKp(df.Stdout)
}

func platformNetwork() []NetworkIface {
	netRaw, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return []NetworkIface{}
	}
	return ParseProcNetDev(string(netRaw))
}
