//go:build !windows

package collect

// platformSerial reads the DMI product serial from sysfs (no shell).
// Callers must run SanitizeSerial / HardwareSerial — placeholders stay raw here.
func platformSerial() string {
	return readTrimmed("/sys/class/dmi/id/product_serial")
}

func platformManufacturer() string {
	return readTrimmed("/sys/class/dmi/id/sys_vendor")
}

func platformModel() string {
	return readTrimmed("/sys/class/dmi/id/product_name")
}

func platformOSVersion() string {
	return parseOSReleasePretty(readTrimmed("/etc/os-release"))
}
