package collect

import (
	"os"
	"runtime"
	"strings"
)

type HostIdentity struct {
	Hostname     string
	OSFamily     string
	OSVersion    string
	Architecture string
	SerialNumber string
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

func SerialNumber() string {
	if env := strings.TrimSpace(os.Getenv("LOCKHAVEN_SERIAL_NUMBER")); env != "" {
		return env
	}
	for _, path := range []string{"/sys/class/dmi/id/product_uuid", "/etc/machine-id"} {
		if value := readTrimmed(path); value != "" {
			return value
		}
	}
	host, _ := os.Hostname()
	return host
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
	pretty := parseOSReleasePretty(readTrimmed("/etc/os-release"))
	if pretty != "" {
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
	}
}
