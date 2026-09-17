package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveAndLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCKHAVEN_STATE_DIR", dir)
	home := t.TempDir()
	t.Setenv("HOME", home)

	saved, err := Save(State{
		DeviceID:      "11111111-1111-4111-8111-111111111111",
		CheckInSecret: "secret",
		BaseURL:       "https://hub.example/",
		Hostname:      "kiosk-01",
		VpnIPv4:       "10.80.30.11",
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved != filepath.Join(dir, "agent.json") {
		t.Fatalf("saved path %s", saved)
	}

	loaded, path, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if path != saved {
		t.Fatalf("loaded %s want %s", path, saved)
	}
	if loaded.BaseURL != "https://hub.example" {
		t.Fatalf("base url %s", loaded.BaseURL)
	}
	if loaded.TunnelName != "lockhaven" {
		t.Fatalf("tunnel %s", loaded.TunnelName)
	}
	if !Valid(loaded) {
		t.Fatal("expected valid state")
	}
}

func TestLoadMissing(t *testing.T) {
	t.Setenv("LOCKHAVEN_STATE_DIR", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	_, _, err := Load()
	if !os.IsNotExist(err) {
		t.Fatalf("got %v", err)
	}
}
