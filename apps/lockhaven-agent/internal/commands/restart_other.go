//go:build !windows

package commands

import "errors"

func platformRestartService(string) error {
	return errors.New("unsupported")
}
