package wgkeys

import (
	"runtime"
	"testing"
)

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

func TestRequireInstalledLinuxLooksForTools(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("linux tool check")
	}
	// On CI/dev images wg-quick may or may not exist; only assert the helper
	// returns a clear error when PATH cannot resolve either binary.
	t.Setenv("PATH", t.TempDir())
	err := RequireInstalled()
	if err == nil {
		t.Fatal("expected missing tools to fail")
	}
	if got := err.Error(); got != "WireGuard tools are not installed." {
		t.Fatalf("got %q", got)
	}
}
