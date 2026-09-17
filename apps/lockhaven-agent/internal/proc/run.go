package proc

import (
	"bytes"
	"context"
	"os/exec"
	"time"
)

type Result struct {
	Code   int
	Stdout string
	Stderr string
}

func Run(ctx context.Context, file string, args ...string) Result {
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, file, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	applyRunAttr(cmd)
	err := cmd.Run()
	code := 0
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			code = exit.ExitCode()
		} else {
			code = 127
		}
	}
	return Result{Code: code, Stdout: stdout.String(), Stderr: stderr.String()}
}

func RunDefault(file string, args ...string) Result {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	return Run(ctx, file, args...)
}
