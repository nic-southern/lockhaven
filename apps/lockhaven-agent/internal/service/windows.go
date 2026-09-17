//go:build windows

package service

import (
	"io"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

const displayName = "Lockhaven Agent"
const description = "Lockhaven endpoint agent"

func preferredPath() string {
	base := os.Getenv("ProgramFiles")
	if base == "" {
		base = `C:\Program Files`
	}
	return filepath.Join(base, "Lockhaven", "lockhaven-agent.exe")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func Install() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		exe, err = os.Executable()
		if err != nil {
			return "", err
		}
	}

	dest := preferredPath()
	if !sameFile(exe, dest) {
		if err := copyFile(exe, dest); err != nil {
			return "", err
		}
		exe = dest
	}

	m, err := mgr.Connect()
	if err != nil {
		return "", err
	}
	defer m.Disconnect()

	s, err := m.OpenService(Name)
	if err == nil {
		s.Close()
		_ = eventlog.InstallAsEventCreate(Name, eventlog.Error|eventlog.Warning|eventlog.Info)
		return startService()
	}

	s, err = m.CreateService(Name, exe, mgr.Config{
		StartType:        mgr.StartAutomatic,
		DisplayName:      displayName,
		Description:      description,
		ErrorControl:     mgr.ErrorNormal,
		DelayedAutoStart: true,
	})
	if err != nil {
		return "", err
	}
	defer s.Close()

	_ = s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
	}, uint32((24 * time.Hour).Seconds()))
	_ = eventlog.InstallAsEventCreate(Name, eventlog.Error|eventlog.Warning|eventlog.Info)

	if err := s.Start(); err != nil {
		return "", err
	}
	return Name, nil
}

func startService() (string, error) {
	m, err := mgr.Connect()
	if err != nil {
		return "", err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return "", err
	}
	defer s.Close()
	status, err := s.Query()
	if err == nil && status.State == svc.Running {
		return Name, nil
	}
	if err := s.Start(); err != nil {
		return "", err
	}
	return Name, nil
}

func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return nil
	}
	defer s.Close()
	_, _ = s.Control(svc.Stop)
	for i := 0; i < 20; i++ {
		status, qerr := s.Query()
		if qerr != nil || status.State == svc.Stopped {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if err := s.Delete(); err != nil {
		return err
	}
	_ = eventlog.Remove(Name)
	return nil
}

func sameFile(a, b string) bool {
	left, err := filepath.Abs(a)
	if err != nil {
		return false
	}
	right, err := filepath.Abs(b)
	if err != nil {
		return false
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
