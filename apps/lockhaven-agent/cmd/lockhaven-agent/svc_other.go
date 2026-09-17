//go:build !windows

package main

func runWindowsServiceIfNeeded() (bool, error) {
	return false, nil
}
