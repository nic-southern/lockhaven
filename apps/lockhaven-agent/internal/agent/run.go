package agent

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config" // pragma: allowlist secret
)

const defaultInterval = time.Minute

func CheckInInterval() time.Duration {
	interval := defaultInterval
	if raw := os.Getenv("LOCKHAVEN_CHECK_IN_INTERVAL_MS"); raw != "" {
		if ms, err := strconv.Atoi(raw); err == nil && ms >= 5000 {
			interval = time.Duration(ms) * time.Millisecond
		}
	}
	return interval
}

func RunLoop(stop <-chan struct{}) {
	tick := func() {
		if _, err := CheckIn(nil); err != nil {
			fmt.Fprintln(os.Stderr, err.Error())
		}
	}
	tick()
	timer := time.NewTicker(CheckInInterval())
	defer timer.Stop()
	for {
		select {
		case <-stop:
			return
		case <-timer.C:
			tick()
		}
	}
}

func MustBeEnrolled() error {
	if _, _, err := config.Load(); err != nil {
		return fmt.Errorf("This device is not enrolled yet.")
	}
	return nil
}
