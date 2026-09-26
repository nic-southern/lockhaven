//go:build windows

package collect

import (
	"strings"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc" // pragma: allowlist secret
	"golang.org/x/sys/windows/registry"
)

func platformSerial() string {
	result := proc.RunDefault(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle",
		"Hidden",
		"-Command",
		"(Get-CimInstance -ClassName Win32_BIOS).SerialNumber",
	)
	return strings.TrimSpace(result.Stdout)
}

func platformManufacturer() string {
	result := proc.RunDefault(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle",
		"Hidden",
		"-Command",
		"(Get-CimInstance -ClassName Win32_ComputerSystem).Manufacturer",
	)
	return strings.TrimSpace(result.Stdout)
}

func platformModel() string {
	result := proc.RunDefault(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle",
		"Hidden",
		"-Command",
		"(Get-CimInstance -ClassName Win32_ComputerSystem).Model",
	)
	return strings.TrimSpace(result.Stdout)
}

func platformOSVersion() string {
	key, err := registry.OpenKey(
		registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion`,
		registry.QUERY_VALUE,
	)
	if err != nil {
		return ""
	}
	defer key.Close()
	productName, _, _ := key.GetStringValue("ProductName")
	displayVersion, _, _ := key.GetStringValue("DisplayVersion")
	major, _, _ := key.GetIntegerValue("CurrentMajorVersionNumber")
	return FormatWindowsNTVersion(productName, major, displayVersion)
}
