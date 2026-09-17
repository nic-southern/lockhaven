package collect

import (
	"strconv"
	"strings"
)

type Disk struct {
	Mount          string `json:"mount"`
	Filesystem     string `json:"filesystem,omitempty"`
	TotalBytes     int64  `json:"total_bytes"`
	UsedBytes      int64  `json:"used_bytes"`
	AvailableBytes int64  `json:"available_bytes"`
}

type NetworkIface struct {
	Name      string `json:"name"`
	RxBytes   int64  `json:"rx_bytes"`
	TxBytes   int64  `json:"tx_bytes"`
	RxPackets int64  `json:"rx_packets,omitempty"`
	TxPackets int64  `json:"tx_packets,omitempty"`
}

type Pkg struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Source  string `json:"source"`
}

type PkgUpdate struct {
	Name             string `json:"name"`
	CurrentVersion   string `json:"current_version,omitempty"`
	AvailableVersion string `json:"available_version"`
	Source           string `json:"source"`
}

func ParseDfKp(output string) []Disk {
	var disks []Disk
	lines := strings.Split(output, "\n")
	if len(lines) <= 1 {
		return disks
	}
	for _, line := range lines[1:] {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		parts := strings.Fields(trimmed)
		if len(parts) < 6 {
			continue
		}
		filesystem := parts[0]
		if strings.HasPrefix(filesystem, "tmpfs") {
			continue
		}
		totalKb, err1 := strconv.ParseInt(parts[1], 10, 64)
		usedKb, err2 := strconv.ParseInt(parts[2], 10, 64)
		availableKb, err3 := strconv.ParseInt(parts[3], 10, 64)
		mount := strings.Join(parts[5:], " ")
		if err1 != nil || err2 != nil || err3 != nil || mount == "" {
			continue
		}
		disks = append(disks, Disk{
			Mount:          mount,
			Filesystem:     filesystem,
			TotalBytes:     totalKb * 1024,
			UsedBytes:      usedKb * 1024,
			AvailableBytes: availableKb * 1024,
		})
	}
	return disks
}

func ParseProcNetDev(output string) []NetworkIface {
	var ifaces []NetworkIface
	lines := strings.Split(output, "\n")
	start := 0
	if len(lines) >= 2 {
		start = 2
	}
	for _, line := range lines[start:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		colon := strings.Index(line, ":")
		if colon <= 0 {
			continue
		}
		name := strings.TrimSpace(line[:colon])
		if name == "" || name == "lo" {
			continue
		}
		fields := strings.Fields(line[colon+1:])
		if len(fields) < 10 {
			continue
		}
		rxBytes, _ := strconv.ParseInt(fields[0], 10, 64)
		rxPackets, _ := strconv.ParseInt(fields[1], 10, 64)
		txBytes, _ := strconv.ParseInt(fields[8], 10, 64)
		txPackets, _ := strconv.ParseInt(fields[9], 10, 64)
		ifaces = append(ifaces, NetworkIface{
			Name:      name,
			RxBytes:   rxBytes,
			TxBytes:   txBytes,
			RxPackets: rxPackets,
			TxPackets: txPackets,
		})
	}
	return ifaces
}

type Memory struct {
	TotalBytes     int64 `json:"total_bytes"`
	AvailableBytes int64 `json:"available_bytes"`
	UsedBytes      int64 `json:"used_bytes"`
}

func ParseProcMeminfo(output string) Memory {
	values := map[string]int64{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		n, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		values[key] = n * 1024
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	if available == 0 {
		available = values["MemFree"]
	}
	used := total - available
	if used < 0 {
		used = 0
	}
	return Memory{TotalBytes: total, AvailableBytes: available, UsedBytes: used}
}

func ParseDpkgQuery(output, source string) []Pkg {
	if source == "" {
		source = "apt"
	}
	var packages []Pkg
	for _, line := range strings.Split(output, "\n") {
		name, version, ok := strings.Cut(line, "\t")
		name = strings.TrimSpace(name)
		version = strings.TrimSpace(version)
		if !ok || name == "" || version == "" {
			continue
		}
		packages = append(packages, Pkg{Name: name, Version: version, Source: source})
	}
	return packages
}

func ParseRpmQa(output string) []Pkg {
	return ParseDpkgQuery(output, "rpm")
}

func ParseAptUpgradable(output string) []PkgUpdate {
	var updates []PkgUpdate
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		slash := strings.Index(line, "/")
		if slash <= 0 {
			continue
		}
		name := line[:slash]
		rest := line[slash+1:]
		fields := strings.Fields(rest)
		if len(fields) < 2 {
			continue
		}
		available := fields[1]
		from := " [upgradable from: "
		idx := strings.Index(line, from)
		if idx < 0 {
			continue
		}
		current := strings.TrimSuffix(line[idx+len(from):], "]")
		updates = append(updates, PkgUpdate{
			Name:             name,
			AvailableVersion: available,
			CurrentVersion:   current,
			Source:           "apt",
		})
	}
	return updates
}

func ParseListeningPorts(ssOutput string) map[int]struct{} {
	ports := map[int]struct{}{}
	for _, line := range strings.Split(ssOutput, "\n") {
		for _, field := range strings.Fields(line) {
			colon := strings.LastIndex(field, ":")
			if colon < 0 || colon == len(field)-1 {
				continue
			}
			n, err := strconv.Atoi(field[colon+1:])
			if err != nil || n <= 0 {
				continue
			}
			ports[n] = struct{}{}
		}
	}
	return ports
}
