package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

type CommandResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type State struct {
	DeviceID              string          `json:"deviceId"`
	CheckInSecret         string          `json:"checkInSecret"`
	BaseURL               string          `json:"baseUrl"`
	Hostname              string          `json:"hostname"`
	VpnIPv4               string          `json:"vpnIpv4"`
	TunnelName            string          `json:"tunnelName"`
	PendingCommandResults []CommandResult `json:"pendingCommandResults,omitempty"`
}

func stateDirFor(goos, programData, envDir string) string {
	if envDir != "" {
		return envDir
	}
	if goos == "windows" {
		if programData != "" {
			return filepath.Join(programData, "Lockhaven")
		}
		return filepath.Join("C:\\ProgramData", "Lockhaven")
	}
	return "/var/lib/lockhaven"
}

func DefaultStateDir() string {
	return stateDirFor(runtime.GOOS, os.Getenv("ProgramData"), os.Getenv("LOCKHAVEN_STATE_DIR"))
}

func FallbackStateDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".lockhaven"
	}
	return filepath.Join(home, ".lockhaven")
}

func StatePath(dir string) string {
	return filepath.Join(dir, "agent.json")
}

func Valid(state *State) bool {
	return state != nil &&
		state.DeviceID != "" &&
		state.CheckInSecret != "" &&
		state.BaseURL != "" &&
		state.Hostname != "" &&
		state.VpnIPv4 != ""
}

func Load() (*State, string, error) {
	candidates := []string{StatePath(DefaultStateDir()), StatePath(FallbackStateDir())}
	for _, path := range candidates {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var state State
		if err := json.Unmarshal(raw, &state); err != nil {
			continue
		}
		if state.TunnelName == "" {
			state.TunnelName = "lockhaven"
		}
		state.BaseURL = trimSlash(state.BaseURL)
		if Valid(&state) {
			return &state, path, nil
		}
	}
	return nil, "", os.ErrNotExist
}

func Save(state State) (string, error) {
	if state.TunnelName == "" {
		state.TunnelName = "lockhaven"
	}
	state.BaseURL = trimSlash(state.BaseURL)
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return "", err
	}
	payload = append(payload, '\n')
	privileged := StatePath(DefaultStateDir())
	if err := writeFile(privileged, payload, 0o600); err == nil {
		return privileged, nil
	}
	fallback := StatePath(FallbackStateDir())
	if err := writeFile(fallback, payload, 0o600); err != nil {
		return "", err
	}
	return fallback, nil
}

func writeFile(path string, payload []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, payload, mode)
}

func trimSlash(url string) string {
	for len(url) > 0 && url[len(url)-1] == '/' {
		url = url[:len(url)-1]
	}
	return url
}
