//go:build windows

package commands

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

func applySpawnAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
	}
}
