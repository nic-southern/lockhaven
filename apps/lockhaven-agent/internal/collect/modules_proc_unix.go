//go:build !windows

package collect

import (
	"os"
	"path/filepath"
	"unicode"
)

func collectModuleProcEntries() []moduleProcEntry {
	dir, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	entries := make([]moduleProcEntry, 0, len(dir))
	for _, item := range dir {
		if !item.IsDir() || !isModulePIDName(item.Name()) {
			continue
		}
		base := filepath.Join("/proc", item.Name())
		comm := readTrimmed(filepath.Join(base, "comm"))
		cmdlineBytes, err := os.ReadFile(filepath.Join(base, "cmdline"))
		cmdline := ""
		if err == nil {
			cmdline = string(cmdlineBytes)
		}
		entries = append(entries, moduleProcEntry{Comm: comm, Cmdline: cmdline})
	}
	return entries
}

func isModulePIDName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
