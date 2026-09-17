package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config"
)

func TestAttachOrEnrollUsesLocalState(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCKHAVEN_STATE_DIR", dir)
	t.Setenv("HOME", t.TempDir())

	saved, err := config.Save(config.State{
		DeviceID:      "11111111-1111-4111-8111-111111111111",
		CheckInSecret: "secret",
		BaseURL:       "https://hub.example",
		Hostname:      "kiosk-01",
		VpnIPv4:       "10.80.30.11",
		TunnelName:    "lockhaven",
	})
	if err != nil {
		t.Fatal(err)
	}

	path, enrolled, err := AttachOrEnroll(BindOptions{
		Token:   "should-not-be-used",
		BaseURL: "https://hub.example",
	})
	if err != nil {
		t.Fatal(err)
	}
	if enrolled {
		t.Fatal("existing inventory must not enroll again")
	}
	if path != saved {
		t.Fatalf("path %s want %s", path, saved)
	}
	if _, err := os.Stat(filepath.Join(dir, "agent.json")); err != nil {
		t.Fatal(err)
	}
}
