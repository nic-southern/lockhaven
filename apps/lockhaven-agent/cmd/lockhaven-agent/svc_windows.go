//go:build windows

package main

import (
	"fmt"
	"os"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/agent"   // pragma: allowlist secret
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/service" // pragma: allowlist secret
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
)

type agentService struct{}

// serviceLogger writes check-in failures to the Windows event log (the
// source is registered by install-service) and mirrors them to stderr.
func serviceLogger() func(string) {
	elog, err := eventlog.Open(service.Name)
	if err != nil {
		return nil
	}
	return func(msg string) {
		_ = elog.Warning(1, msg)
		fmt.Fprintln(os.Stderr, msg)
	}
}

func (m *agentService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	changes <- svc.Status{State: svc.StartPending}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		agent.RunLoop(stop, serviceLogger())
		close(done)
	}()
	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for c := range r {
		switch c.Cmd {
		case svc.Interrogate:
			changes <- c.CurrentStatus
		case svc.Stop, svc.Shutdown:
			changes <- svc.Status{State: svc.StopPending}
			close(stop)
			<-done
			return false, 0
		}
	}
	return false, 0
}

func runWindowsServiceIfNeeded() (bool, error) {
	isSvc, err := svc.IsWindowsService()
	if err != nil {
		return false, err
	}
	if !isSvc {
		return false, nil
	}
	return true, svc.Run(service.Name, &agentService{})
}
