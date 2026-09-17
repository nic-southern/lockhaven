package collect

import (
	"os"
	"strings"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc"
)

type Packages struct {
	RebootRequired   bool        `json:"reboot_required"`
	Installed        []Pkg       `json:"installed"`
	AvailableUpdates []PkgUpdate `json:"available_updates"`
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func CollectPackages() Packages {
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

	return Packages{
		RebootRequired:   fileExists("/var/run/reboot-required"),
		Installed:        installed,
		AvailableUpdates: updates,
	}
}
