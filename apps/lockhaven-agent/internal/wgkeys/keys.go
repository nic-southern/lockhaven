package wgkeys

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strings"

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

func PublicKeyFromInterface(tunnelName string) string {
	result := proc.RunDefault("wg", "show", tunnelName, "public-key")
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

func TunnelConfigExists(tunnelName string) bool {
	_, err := os.Stat("/etc/wireguard/" + tunnelName + ".conf")
	return err == nil
}

func EnableTunnel(tunnelName string) {
	if proc.RunDefault("systemctl", "enable", "--now", "wg-quick@"+tunnelName).Code == 0 {
		return
	}
	_ = proc.RunDefault("wg-quick", "down", tunnelName)
	_ = proc.RunDefault("wg-quick", "up", tunnelName)
}
