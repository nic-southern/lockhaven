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
	if value := platformSerial(); value != "" {
		return value
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
	}
}
