package service

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const unitPath = "/etc/systemd/system/lockhaven-agent.service"

func Unit(execPath string) string {
	return `[Unit]
Description=Lockhaven endpoint agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=` + execPath + ` run
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
`
}

func Install() (string, error) {
	execPath, err := os.Executable()
	if err != nil {
		return "", err
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(unitPath, []byte(Unit(execPath)), 0o644); err != nil {
		return "", err
	}
	_ = exec.Command("systemctl", "daemon-reload").Run()
	cmd := exec.Command("systemctl", "enable", "--now", "lockhaven-agent.service")
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", wrap(err, out)
	}
	return unitPath, nil
}

func Uninstall() error {
	_ = exec.Command("systemctl", "disable", "--now", "lockhaven-agent.service").Run()
	_ = os.Remove(unitPath)
	_ = exec.Command("systemctl", "daemon-reload").Run()
	return nil
}

func wrap(err error, out []byte) error {
	msg := strings.TrimSpace(string(out))
	if msg == "" {
		return err
	}
	return &cmdError{err: err, out: msg}
}

type cmdError struct {
	err error
	out string
}

func (e *cmdError) Error() string {
	return e.out
}
