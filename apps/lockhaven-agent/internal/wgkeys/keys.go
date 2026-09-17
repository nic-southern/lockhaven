package wgkeys

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config" // pragma: allowlist secret
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc"
)

func Generate() (privateKey, publicKey string, err error) {
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	return base64.StdEncoding.EncodeToString(key.Bytes()),
		base64.StdEncoding.EncodeToString(key.PublicKey().Bytes()),
		nil
}

func wireGuardDirs() []string {
	var dirs []string
	seen := map[string]struct{}{}
	for _, env := range []string{"ProgramW6432", "ProgramFiles"} {
		if v := os.Getenv(env); v != "" {
			dir := filepath.Join(v, "WireGuard")
			if _, ok := seen[dir]; ok {
				continue
			}
			seen[dir] = struct{}{}
			dirs = append(dirs, dir)
		}
	}
	fallback := filepath.Join("C:\\Program Files", "WireGuard")
	if _, ok := seen[fallback]; !ok {
		dirs = append(dirs, fallback)
	}
	return dirs
}

func lookInWireGuard(name string) string {
	for _, dir := range wireGuardDirs() {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func WgExe() string {
	if env := strings.TrimSpace(os.Getenv("LOCKHAVEN_WG")); env != "" {
		return env
	}
	if runtime.GOOS != "windows" {
		return "wg"
	}
	if p := lookInWireGuard("wg.exe"); p != "" {
		return p
	}
	return "wg.exe"
}

func WireGuardExe() string {
	if runtime.GOOS != "windows" {
		return ""
	}
	return lookInWireGuard("wireguard.exe")
}

func PublicKeyFromInterface(tunnelName string) string {
	result := proc.RunDefault(WgExe(), "show", tunnelName, "public-key")
	if result.Code != 0 {
		return ""
	}
	return strings.TrimSpace(result.Stdout)
}

func WriteLinuxTunnel(path, privateKey, address string, settings struct {
	ServerPublicKey     string
	Endpoint            string
	AllowedIPs          []string
	PersistentKeepalive int
}) error {
	if err := os.MkdirAll("/etc/wireguard", 0o700); err != nil {
		return err
	}
	config := fmt.Sprintf(`[Interface]
Address = %s
PrivateKey = %s

[Peer]
PublicKey = %s
Endpoint = %s
AllowedIPs = %s
PersistentKeepalive = %d
`, address, privateKey, settings.ServerPublicKey, settings.Endpoint, strings.Join(settings.AllowedIPs, ", "), settings.PersistentKeepalive)
	return os.WriteFile(path, []byte(config), 0o600)
}

func tunnelConfig(privateKey, address string, settings struct {
	ServerPublicKey     string
	Endpoint            string
	AllowedIPs          []string
	PersistentKeepalive int
}) string {
	return fmt.Sprintf(`[Interface]
Address = %s
PrivateKey = %s

[Peer]
PublicKey = %s
Endpoint = %s
AllowedIPs = %s
PersistentKeepalive = %d
`, address, privateKey, settings.ServerPublicKey, settings.Endpoint, strings.Join(settings.AllowedIPs, ", "), settings.PersistentKeepalive)
}

func TunnelConfigExists(tunnelName string) bool {
	if runtime.GOOS == "windows" {
		return WindowsTunnelExists(tunnelName)
	}
	_, err := os.Stat("/etc/wireguard/" + tunnelName + ".conf")
	return err == nil
}

func WindowsTunnelExists(tunnelName string) bool {
	if proc.RunDefault(WgExe(), "show", tunnelName).Code == 0 {
		return true
	}
	query := proc.RunDefault("sc.exe", "query", "WireGuardTunnel$"+tunnelName)
	return query.Code == 0
}

func WriteWindowsTunnel(tunnelName, privateKey, address string, settings struct {
	ServerPublicKey     string
	Endpoint            string
	AllowedIPs          []string
	PersistentKeepalive int
}) error {
	if WindowsTunnelExists(tunnelName) {
		return nil
	}
	exe := WireGuardExe()
	if exe == "" {
		return fmt.Errorf("WireGuard is not installed.")
	}
	dir := config.DefaultStateDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(dir, tunnelName+".conf")
	if err := os.WriteFile(path, []byte(tunnelConfig(privateKey, address, settings)), 0o600); err != nil {
		return err
	}
	result := proc.RunDefault(exe, "/installtunnelservice", path)
	if result.Code != 0 {
		msg := strings.TrimSpace(result.Stderr)
		if msg == "" {
			msg = strings.TrimSpace(result.Stdout)
		}
		if msg == "" {
			return fmt.Errorf("Tunnel setup failed.")
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

func EnableTunnel(tunnelName string) {
	if proc.RunDefault("systemctl", "enable", "--now", "wg-quick@"+tunnelName).Code == 0 {
		return
	}
	_ = proc.RunDefault("wg-quick", "down", tunnelName)
	_ = proc.RunDefault("wg-quick", "up", tunnelName)
}
