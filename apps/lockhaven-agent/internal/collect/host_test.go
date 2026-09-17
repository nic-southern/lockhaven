package collect

import "testing"

func TestFormatWindowsNTVersion(t *testing.T) {
	got := FormatWindowsNTVersion("Windows 10 Pro", 11, "23H2")
	if got != "Windows 11 23H2" {
		t.Fatalf("got %q", got)
	}
	got = FormatWindowsNTVersion("Windows 10 Pro", 10, "22H2")
	if got != "Windows 10 Pro 22H2" {
		t.Fatalf("got %q", got)
	}
}
