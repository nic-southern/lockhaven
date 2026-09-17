package collect

func CollectPackages() Packages {
	installed, updates, reboot := platformPackages()
	return Packages{
		RebootRequired:   reboot,
		Installed:        nonempty(installed),
		AvailableUpdates: nonempty(updates),
	}
}
