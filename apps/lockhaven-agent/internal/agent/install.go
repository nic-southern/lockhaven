package agent

import (
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/service"
)

func Install(opts BindOptions) (string, string, error) {
	path, _, err := AttachOrEnroll(opts)
	if err != nil {
		return "", "", err
	}
	unit, err := service.Install()
	if err != nil {
		return path, "", err
	}
	return path, unit, nil
}
