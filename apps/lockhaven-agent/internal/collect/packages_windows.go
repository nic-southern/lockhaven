//go:build windows

package collect

import (
	"strings"

	"golang.org/x/sys/windows/registry"
)

const maxWindowsPackages = 2000

func platformPackages() ([]Pkg, []PkgUpdate, bool) {
	installed := readUninstallPackages()
	return installed, []PkgUpdate{}, windowsRebootRequired()
}

func windowsRebootRequired() bool {
	paths := []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`,
	}
	for _, path := range paths {
		key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
		if err == nil {
			key.Close()
			return true
		}
	}
	return false
}

func readUninstallPackages() []Pkg {
	roots := []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
		`SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
	}
	var pkgs []Pkg
	seen := map[string]struct{}{}
	for _, path := range roots {
		key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		names, err := key.ReadSubKeyNames(maxWindowsPackages)
		key.Close()
		if err != nil && len(names) == 0 {
			continue
		}
		for _, name := range names {
			if len(pkgs) >= maxWindowsPackages {
				return pkgs
			}
			sk, err := registry.OpenKey(registry.LOCAL_MACHINE, path+`\`+name, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			display, _, _ := sk.GetStringValue("DisplayName")
			version, _, _ := sk.GetStringValue("DisplayVersion")
			sk.Close()
			display = strings.TrimSpace(display)
			version = strings.TrimSpace(version)
			if display == "" {
				continue
			}
			if version == "" {
				version = "0"
			}
			id := display + "\x00" + version
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			pkgs = append(pkgs, Pkg{Name: display, Version: version, Source: "windows"})
		}
	}
	return pkgs
}
