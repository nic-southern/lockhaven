//go:build windows

package main

import (
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/agent"   // pragma: allowlist secret
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/service" // pragma: allowlist secret
	"golang.org/x/sys/windows/svc"
)

type agentService struct{}

func (m *agentService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	changes <- svc.Status{State: svc.StartPending}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		agent.RunLoop(stop)
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
