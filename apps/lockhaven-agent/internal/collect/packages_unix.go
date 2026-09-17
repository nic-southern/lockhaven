//go:build !windows

package collect

import (
	"os"
	"strings"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc" // pragma: allowlist secret
)

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func platformPackages() ([]Pkg, []PkgUpdate, bool) {
	installed := []Pkg{}
	updates := []PkgUpdate{}

	dpkg := proc.RunDefault("dpkg-query", "-W", "-f", "${Package}\\t${Version}\\n")
	if dpkg.Code == 0 && strings.TrimSpace(dpkg.Stdout) != "" {
		installed = ParseDpkgQuery(dpkg.Stdout, "apt")
		apt := proc.RunDefault("apt", "list", "--upgradable")
		if apt.Code == 0 {
			updates = ParseAptUpgradable(apt.Stdout)
		}
	} else {
		rpm := proc.RunDefault("rpm", "-qa", "--queryformat", "%{NAME}\\t%{VERSION}-%{RELEASE}\\n")
		if rpm.Code == 0 && strings.TrimSpace(rpm.Stdout) != "" {
			installed = ParseRpmQa(rpm.Stdout)
		}
	}

	return installed, updates, fileExists("/var/run/reboot-required")
}
