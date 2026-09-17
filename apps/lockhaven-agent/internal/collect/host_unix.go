//go:build !windows

package collect

func platformSerial() string {
	for _, path := range []string{"/sys/class/dmi/id/product_uuid", "/etc/machine-id"} {
		if value := readTrimmed(path); value != "" {
			return value
		}
	}
	return ""
}

func platformOSVersion() string {
	return parseOSReleasePretty(readTrimmed("/etc/os-release"))
}
