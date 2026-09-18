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

// RunLoop checks in immediately and then on every interval until stop is
// closed. Failures are reported through logf (stderr when nil) so the
// service log shows the Hub's refusal reason, never the request payload.
func RunLoop(stop <-chan struct{}, logf func(string)) {
	if logf == nil {
		logf = func(msg string) { fmt.Fprintln(os.Stderr, msg) }
	}
	tick := func() {
		if _, err := CheckIn(nil); err != nil {
			logf(err.Error())
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
