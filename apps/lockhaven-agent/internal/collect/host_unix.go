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

func platformManufacturer() string {
	return readTrimmed("/sys/class/dmi/id/sys_vendor")
}

func platformModel() string {
	return readTrimmed("/sys/class/dmi/id/product_name")
}

func platformOSVersion() string {
	return parseOSReleasePretty(readTrimmed("/etc/os-release"))
}
