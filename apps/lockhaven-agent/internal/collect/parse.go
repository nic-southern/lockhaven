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
	Severity         string `json:"severity,omitempty"`
}

func nonempty[T any](in []T) []T {
	if in == nil {
		return []T{}
	}
	return in
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
	return nonempty(disks)
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
	return nonempty(ifaces)
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
	return nonempty(packages)
}

func ParseRpmQa(output string) []Pkg {
	return ParseDpkgQuery(output, "rpm")
}

func aptPocketIsSecurity(suite string) bool {
	for _, part := range strings.Split(suite, ",") {
		for _, token := range strings.Split(strings.ToLower(strings.TrimSpace(part)), "-") {
			if token == "security" {
				return true
			}
		}
	}
	return false
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
		suite := fields[0]
		available := fields[1]
		from := " [upgradable from: "
		idx := strings.Index(line, from)
		if idx < 0 {
			continue
		}
		current := strings.TrimSuffix(line[idx+len(from):], "]")
		severity := ""
		if aptPocketIsSecurity(suite) {
			severity = "security"
		}
		updates = append(updates, PkgUpdate{
			Name:             name,
			AvailableVersion: available,
			CurrentVersion:   current,
			Source:           "apt",
			Severity:         severity,
		})
	}
	return nonempty(updates)
}

var rpmArchSuffixes = []string{
	".x86_64", ".aarch64", ".noarch", ".i686", ".i386", ".ppc64le", ".s390x", ".armv7hl",
}

func looksLikeRpmVersion(value string) bool {
	if value == "" {
		return false
	}
	rest := value
	if colon := strings.Index(rest, ":"); colon >= 0 {
		epoch := rest[:colon]
		if epoch == "" {
			return false
		}
		for _, r := range epoch {
			if r < '0' || r > '9' {
				return false
			}
		}
		rest = rest[colon+1:]
	}
	return rest != "" && rest[0] >= '0' && rest[0] <= '9'
}

func rpmNameFromArch(field string) (string, bool) {
	for _, suffix := range rpmArchSuffixes {
		if strings.HasSuffix(field, suffix) && len(field) > len(suffix) {
			return field[:len(field)-len(suffix)], true
		}
	}
	return "", false
}

func parseNevra(field string) (string, string, bool) {
	base, ok := rpmNameFromArch(field)
	if !ok {
		return "", "", false
	}
	releaseAt := strings.LastIndex(base, "-")
	if releaseAt <= 0 {
		return "", "", false
	}
	versionAt := strings.LastIndex(base[:releaseAt], "-")
	if versionAt <= 0 {
		return "", "", false
	}
	name := base[:versionAt]
	version := base[versionAt+1:]
	upstream := version
	if dash := strings.Index(version, "-"); dash >= 0 {
		upstream = version[:dash]
	}
	if name == "" || !looksLikeRpmVersion(upstream) {
		return "", "", false
	}
	return name, version, true
}

func dnfAdvisorySeverity(typeToken string) string {
	token := strings.ToLower(strings.TrimSpace(typeToken))
	token = strings.TrimRight(token, ".")
	switch token {
	case "security":
		return "security"
	case "critical/sec", "critical/security":
		return "critical"
	case "important/sec", "important/security", "moderate/sec", "moderate/security", "low/sec", "low/security":
		return "security"
	default:
		return ""
	}
}

func ParseDnfSecurityUpdates(output string) []PkgUpdate {
	var updates []PkgUpdate
	seen := map[string]int{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		severity := ""
		name := ""
		version := ""
		for _, field := range fields {
			if next := dnfAdvisorySeverity(field); next != "" {
				if severity == "" || (severity != "critical" && next == "critical") {
					severity = next
				}
			}
			if parsedName, parsedVersion, ok := parseNevra(field); ok {
				name = parsedName
				version = parsedVersion
			}
		}
		if severity == "" || name == "" {
			continue
		}
		update := PkgUpdate{
			Name:             name,
			AvailableVersion: version,
			Source:           "rpm",
			Severity:         severity,
		}
		key := strings.ToLower(name)
		if idx, exists := seen[key]; exists {
			if updates[idx].Severity != "critical" && severity == "critical" {
				updates[idx] = update
			}
			continue
		}
		seen[key] = len(updates)
		updates = append(updates, update)
	}
	return nonempty(updates)
}

func ParseDnfCheckUpdate(output string) []PkgUpdate {
	var updates []PkgUpdate
	skipping := false
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(strings.ToLower(trimmed), "obsoleting") {
			skipping = true
			continue
		}
		if skipping {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}
		name, ok := rpmNameFromArch(fields[0])
		if !ok || !looksLikeRpmVersion(fields[1]) {
			continue
		}
		updates = append(updates, PkgUpdate{
			Name:             name,
			AvailableVersion: fields[1],
			Source:           "rpm",
			Severity:         "security",
		})
	}
	return nonempty(updates)
}

func ClassifyWindowsUpdateCategories(categories string) string {
	security := false
	critical := false
	for _, part := range strings.Split(categories, "|") {
		switch strings.ToLower(strings.TrimSpace(part)) {
		case "security updates":
			security = true
		case "critical updates":
			critical = true
		}
	}
	if security {
		return "security"
	}
	if critical {
		return "critical"
	}
	return ""
}

func ParseWindowsUpdateList(output string) []PkgUpdate {
	var updates []PkgUpdate
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		parts := strings.Split(trimmed, "\t")
		title := strings.TrimSpace(parts[0])
		if title == "" {
			continue
		}
		if len(title) > 256 {
			title = title[:256]
		}
		kb := ""
		categories := ""
		if len(parts) > 1 {
			kb = strings.TrimSpace(parts[1])
		}
		if len(parts) > 2 {
			categories = parts[2]
		}
		available := "pending"
		if kb != "" {
			if strings.HasPrefix(strings.ToUpper(kb), "KB") {
				available = kb
			} else {
				available = "KB" + kb
			}
		}
		if len(available) > 128 {
			available = available[:128]
		}
		updates = append(updates, PkgUpdate{
			Name:             title,
			AvailableVersion: available,
			Source:           "windows-update",
			Severity:         ClassifyWindowsUpdateCategories(categories),
		})
	}
	return nonempty(updates)
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
