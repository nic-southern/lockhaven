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
			updates = collectRpmSecurityUpdates()
		}
	}

	return installed, updates, fileExists("/var/run/reboot-required")
}

func commandRan(code int) bool {
	return code == 0 || code == 100
}

func collectRpmSecurityUpdates() []PkgUpdate {
	for _, bin := range []string{"dnf", "yum"} {
		result := proc.RunDefault(bin, "-q", "updateinfo", "list", "security")
		if commandRan(result.Code) {
			return ParseDnfSecurityUpdates(result.Stdout)
		}
	}
	for _, bin := range []string{"dnf", "yum"} {
		result := proc.RunDefault(bin, "-q", "check-update", "--security")
		if commandRan(result.Code) {
			return ParseDnfCheckUpdate(result.Stdout)
		}
	}
	return []PkgUpdate{}
}
