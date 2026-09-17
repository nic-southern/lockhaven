package collect

type Packages struct {
	RebootRequired   bool        `json:"reboot_required"`
	Installed        []Pkg       `json:"installed"`
	AvailableUpdates []PkgUpdate `json:"available_updates"`
}
