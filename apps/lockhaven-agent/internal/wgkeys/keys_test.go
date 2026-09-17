package wgkeys

import "testing"

func TestWgExeHonorsOverride(t *testing.T) {
	t.Setenv("LOCKHAVEN_WG", "/opt/wg")
	if WgExe() != "/opt/wg" {
		t.Fatalf("got %s", WgExe())
	}
}

func TestWgExeIsNonEmpty(t *testing.T) {
	t.Setenv("LOCKHAVEN_WG", "")
	if WgExe() == "" {
		t.Fatal("empty wg path")
	}
}
