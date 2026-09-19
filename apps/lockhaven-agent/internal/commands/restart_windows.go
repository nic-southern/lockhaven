//go:build windows

package commands

import (
	"errors"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func platformRestartService(name string) error {
	if !validServiceTarget(name) {
		return errors.New("rejected")
	}
	manager, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	service, err := manager.OpenService(name)
	if err != nil {
		return err
	}
	defer service.Close()
	status, err := service.Query()
	if err != nil {
		return err
	}
	if status.State != svc.Stopped {
		if _, err := service.Control(svc.Stop); err != nil {
			return err
		}
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			status, err = service.Query()
			if err != nil {
				return err
			}
			if status.State == svc.Stopped {
				break
			}
			time.Sleep(250 * time.Millisecond)
		}
		if status.State != svc.Stopped {
			return errors.New("not stopped")
		}
	}
	return service.Start()
}
