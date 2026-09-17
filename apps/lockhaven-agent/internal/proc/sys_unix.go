//go:build !windows

package proc

import "os/exec"

func applyRunAttr(cmd *exec.Cmd) {}
