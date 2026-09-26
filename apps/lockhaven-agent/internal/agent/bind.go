package agent

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/collect"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/hub"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/wgkeys"
)

type BindOptions struct {
	Token      string
	BaseURL    string
	TunnelName string
	DeviceID   string
}

func defaultServices(osFamily string) []hub.ServiceIn {
	if osFamily == "windows" {
		return []hub.ServiceIn{{Type: "rdp", Protocol: "tcp", Port: 3389}}
	}
	return []hub.ServiceIn{
		{Type: "ssh", Protocol: "tcp", Port: 22},
		{Type: "vnc", Protocol: "tcp", Port: 5900},
	}
}

func persistSecret(tunnelName, secret string) {
	dir := config.DefaultStateDir()
	_ = os.MkdirAll(dir, 0o700)
	_ = os.WriteFile(filepath.Join(dir, tunnelName+".check-in-secret"), []byte(secret+"\n"), 0o600)
}

func ApplyBind(state *config.State, bound *hub.BindResponse, privateKey string, writeTunnel bool) (*config.State, string, error) {
	next := *state
	next.DeviceID = bound.DeviceID
	next.CheckInSecret = bound.CheckInSecret
	next.VpnIPv4 = bound.VpnIPv4
	path, err := config.Save(next)
	if err != nil {
		return nil, "", err
	}
	persistSecret(next.TunnelName, bound.CheckInSecret)
	if writeTunnel && privateKey != "" {
		settings := struct {
			ServerPublicKey     string
			Endpoint            string
			AllowedIPs          []string
			PersistentKeepalive int
		}{
			ServerPublicKey:     bound.WireGuard.ServerPublicKey,
			Endpoint:            bound.WireGuard.Endpoint,
			AllowedIPs:          bound.WireGuard.AllowedIPs,
			PersistentKeepalive: bound.WireGuard.PersistentKeepalive,
		}
		switch collect.OSFamily() {
		case "linux":
			if !wgkeys.TunnelConfigExists(next.TunnelName) {
				if err := wgkeys.WriteLinuxTunnel(
					"/etc/wireguard/"+next.TunnelName+".conf",
					privateKey,
					bound.VpnIPv4,
					settings,
				); err != nil {
					return nil, "", err
				}
				if err := wgkeys.EnableTunnel(next.TunnelName); err != nil {
					return nil, "", err
				}
			}
		case "windows":
			if err := wgkeys.WriteWindowsTunnel(next.TunnelName, privateKey, bound.VpnIPv4, settings); err != nil {
				return nil, "", err
			}
		}
	}
	return &next, path, nil
}

func Attach(opts BindOptions) (*config.State, string, error) {
	host := collect.Host()
	client := hub.New(opts.BaseURL)
	req := hub.AttachRequest{
		Token:              opts.Token,
		Hostname:           host.Hostname,
		OSFamily:           host.OSFamily,
		OSVersion:          host.OSVersion,
		Architecture:       host.Architecture,
		SerialNumber:       host.SerialNumber,
		Manufacturer:       host.Manufacturer,
		Model:              host.Model,
		DeviceID:           opts.DeviceID,
		WireGuardPublicKey: wgkeys.PublicKeyFromInterface(opts.TunnelName),
	}
	bound, apiErr, err := client.Attach(req)
	if err != nil {
		if apiErr.Code != "" {
			return nil, "", fmt.Errorf("%s", apiErr.Error)
		}
		return nil, "", err
	}
	state := config.State{
		BaseURL:    opts.BaseURL,
		Hostname:   host.Hostname,
		TunnelName: opts.TunnelName,
	}
	return ApplyBind(&state, bound, "", false)
}

func Enroll(opts BindOptions) (*config.State, string, error) {
	host := collect.Host()
	if err := wgkeys.RequireInstalled(); err != nil {
		return nil, "", err
	}
	privateKey, publicKey, err := wgkeys.Generate()
	if err != nil {
		return nil, "", err
	}
	client := hub.New(opts.BaseURL)
	bound, apiErr, err := client.Enroll(hub.EnrollRequest{
		Token:              opts.Token,
		Hostname:           host.Hostname,
		OSFamily:           host.OSFamily,
		OSVersion:          host.OSVersion,
		Architecture:       host.Architecture,
		SerialNumber:       host.SerialNumber,
		Manufacturer:       host.Manufacturer,
		Model:              host.Model,
		WireGuardPublicKey: publicKey,
		Services:           defaultServices(host.OSFamily),
	})
	if err != nil {
		if apiErr.Code == "device_exists" {
			return nil, "", fmt.Errorf("%s", apiErr.Error)
		}
		if apiErr.Error != "" {
			return nil, "", fmt.Errorf("%s", apiErr.Error)
		}
		return nil, "", err
	}
	state := config.State{
		BaseURL:    opts.BaseURL,
		Hostname:   host.Hostname,
		TunnelName: opts.TunnelName,
	}
	return ApplyBind(&state, bound, privateKey, true)
}

func AttachOrEnroll(opts BindOptions) (string, bool, error) {
	if state, path, err := config.Load(); err == nil && config.Valid(state) {
		return path, false, nil
	}
	if opts.Token == "" || opts.BaseURL == "" {
		return "", false, fmt.Errorf("This device is not enrolled yet.")
	}
	if opts.TunnelName == "" {
		opts.TunnelName = "lockhaven"
	}
	if _, path, err := Attach(opts); err == nil {
		return path, false, nil
	}
	_, path, err := Enroll(opts)
	return path, true, err
}
