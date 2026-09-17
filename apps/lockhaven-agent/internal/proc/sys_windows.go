//go:build windows

package proc

import (
	"os/exec"
	"syscall"
)

func applyRunAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
