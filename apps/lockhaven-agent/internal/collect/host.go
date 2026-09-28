package collect

import (
	"os"
	"runtime"
	"strings"
	"unicode"
)

type HostIdentity struct {
	Hostname     string
	OSFamily     string
	OSVersion    string
	Architecture string
	SerialNumber string
	Manufacturer string
	Model        string
}

func OSFamily() string {
	switch runtime.GOOS {
	case "windows":
		return "windows"
	case "darwin":
		return "macos"
	default:
		return "linux"
	}
}

func readTrimmed(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// SMBIOS / DMI / WMI strings that are not unique chassis serials.
var placeholderSerialKeys = map[string]struct{}{
	"none":                {},
	"na":                  {},
	"null":                {},
	"nil":                 {},
	"unknown":             {},
	"notspecified":        {},
	"notavailable":        {},
	"notapplicable":       {},
	"defaultstring":       {},
	"systemserialnumber":  {},
	"chassisserialnumber": {},
	"tobefilledbyoem":     {},
	"oem":                 {},
	"0":                   {},
	"00000000":            {},
	"0000000000000000":    {},
	"123456789":           {},
	"1234567890":          {},
	"xxxxxxxxxxxx":        {},
	"xxxxxxxx":            {},
}

func serialDenylistKey(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsSpace(r) || r == '.' || r == '-' || r == '/' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// IsPlaceholderSerial reports empty or known BIOS/DMI placeholder serials.
func IsPlaceholderSerial(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return true
	}
	key := serialDenylistKey(trimmed)
	if key == "" {
		return true
	}
	if _, ok := placeholderSerialKeys[key]; ok {
		return true
	}
	if len(key) >= 4 && strings.Trim(key, "x") == "" {
		return true
	}
	if strings.Trim(key, "0") == "" {
		return true
	}
	return false
}

// SanitizeSerial returns a trimmed real serial, or "" when empty/placeholder.
func SanitizeSerial(value string) string {
	trimmed := strings.TrimSpace(value)
	if IsPlaceholderSerial(trimmed) {
		return ""
	}
	if len(trimmed) > 120 {
		return trimmed[:120]
	}
	return trimmed
}

// HardwareSerial is the chassis / DMI product serial when it looks real.
// Empty when unavailable or a BIOS placeholder. Never falls back to hostname.
func HardwareSerial() string {
	if env := SanitizeSerial(os.Getenv("LOCKHAVEN_SERIAL_NUMBER")); env != "" {
		return env
	}
	return SanitizeSerial(platformSerial())
}

// SerialNumber is used for attach/enroll (Hub requires a non-empty value).
// Prefers a real hardware serial; otherwise falls back to hostname.
func SerialNumber() string {
	if value := HardwareSerial(); value != "" {
		return value
	}
	host, _ := os.Hostname()
	return host
}

func Manufacturer() string {
	if env := strings.TrimSpace(os.Getenv("LOCKHAVEN_MANUFACTURER")); env != "" {
		return env
	}
	return platformManufacturer()
}

func Model() string {
	if env := strings.TrimSpace(os.Getenv("LOCKHAVEN_MODEL")); env != "" {
		return env
	}
	return platformModel()
}

func Hostname() string {
	if env := strings.TrimSpace(os.Getenv("LOCKHAVEN_HOSTNAME")); env != "" {
		return env
	}
	host, _ := os.Hostname()
	return host
}

func OSVersion() string {
	if env := strings.TrimSpace(os.Getenv("LOCKHAVEN_OS_VERSION")); env != "" {
		return env
	}
	if pretty := platformOSVersion(); pretty != "" {
		return pretty
	}
	return runtime.GOOS + " " + runtime.GOARCH
}

func parseOSReleasePretty(content string) string {
	for _, line := range strings.Split(content, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok || key != "PRETTY_NAME" {
			continue
		}
		return strings.Trim(value, `"`)
	}
	return ""
}

func FormatWindowsNTVersion(productName string, major uint64, displayVersion string) string {
	name := strings.TrimSpace(productName)
	if major >= 11 {
		name = "Windows 11"
	}
	displayVersion = strings.TrimSpace(displayVersion)
	if name == "" {
		return displayVersion
	}
	if displayVersion == "" {
		return name
	}
	return name + " " + displayVersion
}

func Architecture() string {
	if env := strings.TrimSpace(os.Getenv("LOCKHAVEN_ARCHITECTURE")); env != "" {
		return env
	}
	return runtime.GOARCH
}

func Host() HostIdentity {
	return HostIdentity{
		Hostname:     Hostname(),
		OSFamily:     OSFamily(),
		OSVersion:    OSVersion(),
		Architecture: Architecture(),
		SerialNumber: SerialNumber(),
		Manufacturer: Manufacturer(),
		Model:        Model(),
	}
}
