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

func TestIsPlaceholderSerial(t *testing.T) {
	placeholders := []string{
		"",
		"   ",
		"None",
		"N/A",
		"Not Specified",
		"Default string",
		"System Serial Number",
		"To be filled by O.E.M.",
		"To Be Filled By O.E.M.",
		"0",
		"00000000",
		"XXXXXXXX",
		"xx-xx-xx-xx",
	}
	for _, value := range placeholders {
		if !IsPlaceholderSerial(value) {
			t.Fatalf("expected placeholder %q", value)
		}
		if SanitizeSerial(value) != "" {
			t.Fatalf("SanitizeSerial(%q) should be empty", value)
		}
	}

	real := []string{"ABC123456", "PF1A2B3C", "SN-9F2K-441"}
	for _, value := range real {
		if IsPlaceholderSerial(value) {
			t.Fatalf("expected real serial %q", value)
		}
		if SanitizeSerial(value) != value {
			t.Fatalf("SanitizeSerial(%q) = %q", value, SanitizeSerial(value))
		}
	}
}

func TestHardwareSerialUsesEnvOverride(t *testing.T) {
	t.Setenv("LOCKHAVEN_SERIAL_NUMBER", "  CAB-SERIAL-99  ")
	if got := HardwareSerial(); got != "CAB-SERIAL-99" {
		t.Fatalf("got %q", got)
	}
	t.Setenv("LOCKHAVEN_SERIAL_NUMBER", "To be filled by O.E.M.")
	if got := HardwareSerial(); got != "" {
		t.Fatalf("placeholder env must be ignored, got %q", got)
	}
}
