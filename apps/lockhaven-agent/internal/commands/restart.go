package commands

import (
	"errors"
	"os/exec"
	"runtime"
	"strings"
)

func validServiceName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 64 {
		return false
	}
	if strings.Contains(name, "..") || strings.ContainsAny(name, "/\\") {
		return false
	}
	for _, char := range name {
		if char < 0x20 || char == 0x7f {
			return false
		}
	}
	return true
}

func validServiceTarget(target string) bool {
	if target == "" || len(target) > 64 || strings.Contains(target, "..") {
		return false
	}
	for index, char := range target {
		alnum := (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if index == 0 && !alnum {
			return false
		}
		if alnum || char == '_' || char == '.' || char == '@' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func executeRestartService(command Command, rt Runtime) Result {
	target := lookupServiceTarget(command, rt)
	if target == "" {
		return Result{ID: command.ID, Status: "refused", Detail: "This service is not assigned."}
	}
	if err := restartService(target, rt); err != nil {
		return Result{ID: command.ID, Status: "failed", Detail: "The service could not be restarted."}
	}
	return Result{ID: command.ID, Status: "succeeded"}
}

func lookupServiceTarget(command Command, rt Runtime) string {
	if !validServiceName(command.Name) {
		return ""
	}
	for _, service := range rt.Services {
		if service.Name == strings.TrimSpace(command.Name) && validServiceTarget(service.Target) {
			return service.Target
		}
	}
	return ""
}

func restartService(target string, rt Runtime) error {
	if rt.RestartService != nil {
		return rt.RestartService(target)
	}
	goos := rt.GOOS
	if goos == "" {
		goos = runtime.GOOS
	}
	return defaultRestartService(goos, target)
}

// DeferOwnServiceRestart is true when restarting the agent itself. The
// caller must record the result before the process exits.
func DeferOwnServiceRestart(command Command, rt Runtime) bool {
	target := lookupServiceTarget(command, rt)
	if target == "" {
		return false
	}
	goos := rt.GOOS
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "windows" {
		return strings.EqualFold(target, "LockhavenAgent")
	}
	return target == "lockhaven-agent.service"
}

func defaultRestartService(goos, target string) error {
	if !validServiceTarget(target) {
		return errors.New("rejected")
	}
	if goos == "windows" {
		return platformRestartService(target)
	}
	if goos != "linux" {
		return errors.New("unsupported")
	}
	cmd := exec.Command("/bin/systemctl", "restart", target)
	return cmd.Run()
}
