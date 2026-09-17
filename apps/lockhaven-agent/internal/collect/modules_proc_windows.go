//go:build windows

package collect

import (
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

func collectModuleProcEntries() []moduleProcEntry {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snapshot)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return nil
	}
	entries := make([]moduleProcEntry, 0, 64)
	for {
		name := windows.UTF16ToString(entry.ExeFile[:])
		base := filepath.Base(name)
		entries = append(entries, moduleProcEntry{Comm: base, Cmdline: name})
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			break
		}
	}
	return entries
}
