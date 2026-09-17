package collect

import (
	"os"
	"runtime"
	"strings"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc"   // pragma: allowlist secret
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/wgkeys" // pragma: allowlist secret
)

type ServiceStatus struct {
	Type      string `json:"type"`
	Port      int    `json:"port"`
	Listening bool   `json:"listening"`
}

type VPNStatus struct {
	InterfaceUp bool   `json:"interface_up"`
	VpnIPv4     string `json:"vpn_ipv4"`
}

func listeningOutput() string {
	if runtime.GOOS == "windows" {
		netstat := proc.RunDefault("netstat", "-an")
		if netstat.Code == 0 {
			return netstat.Stdout
		}
		return ""
	}
	ss := proc.RunDefault("ss", "-ltn")
	output := ss.Stdout
	if ss.Code != 0 {
		netstat := proc.RunDefault("netstat", "-lnt")
		if netstat.Code == 0 {
			output = netstat.Stdout
		} else {
			output = ""
		}
	}
	return output
}

func CollectServices(osFamily string) []ServiceStatus {
	ports := ParseListeningPorts(listeningOutput())
	types := []struct {
		Type string
		Port int
	}{
		{Type: "ssh", Port: 22},
		{Type: "vnc", Port: 5900},
	}
	if osFamily == "windows" {
		types = []struct {
			Type string
			Port int
		}{
			{Type: "rdp", Port: 3389},
			{Type: "winrm_https", Port: 5986},
		}
	}
	out := make([]ServiceStatus, 0, len(types))
	for _, spec := range types {
		_, listening := ports[spec.Port]
		out = append(out, ServiceStatus{
			Type:      spec.Type,
			Port:      spec.Port,
			Listening: listening,
		})
	}
	return out
}

func InterfaceExists(name string) bool {
	if runtime.GOOS == "windows" {
		return ServiceQueryRunning(proc.RunDefault("sc.exe", "query", "WireGuardTunnel$"+name).Stdout)
	}
	_, err := os.Stat("/sys/class/net/" + name)
	return err == nil
}

func ServiceQueryRunning(output string) bool {
	return strings.Contains(output, "RUNNING")
}

func CollectVPN(tunnelName, expectedIPv4 string) VPNStatus {
	dump := proc.RunDefault(wgkeys.WgExe(), "show", tunnelName, "dump")
	ip := strings.TrimSpace(expectedIPv4)
	if idx := strings.Index(ip, "/"); idx >= 0 {
		ip = ip[:idx]
	}
	return VPNStatus{
		InterfaceUp: dump.Code == 0 || InterfaceExists(tunnelName),
		VpnIPv4:     ip,
	}
}
