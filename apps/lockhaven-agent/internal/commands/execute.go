package commands

import (
	"os/exec"
	"runtime"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/service" // pragma: allowlist secret
)

type Command struct {
	ID   string
	Kind string
	Name string
}

type Result struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type Spec struct {
	File string
	Args []string
}

func RebootSpec(goos string) Spec {
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "windows" {
		return Spec{File: "shutdown.exe", Args: []string{"/r", "/t", "0"}}
	}
	return Spec{File: "/sbin/shutdown", Args: []string{"-r", "now"}}
}

func RestartSpec(goos string) Spec {
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "darwin" {
		return Spec{File: "/bin/launchctl", Args: []string{"kickstart", "-k", "system/com.lockhaven.agent"}}
	}
	if goos == "windows" {
		return Spec{
			File: "powershell.exe",
			Args: []string{
				"-NoProfile",
				"-NonInteractive",
				"-WindowStyle",
				"Hidden",
				"-Command",
				"Restart-Service -Name " + service.Name + " -Force",
			},
		}
	}
	return Spec{File: "/bin/systemctl", Args: []string{"restart", "lockhaven-agent.service"}}
}

type Runtime struct {
	GOOS           string
	SpawnDetached  func(file string, args []string) error
	Update         *UpdateOffer
	Services       []ServiceAllow
	RestartService func(target string) error
}

type ServiceAllow struct {
	Name   string
	Target string
}

func spawnDetached(file string, args []string) error {
	cmd := exec.Command(file, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	applySpawnAttr(cmd)
	return cmd.Start()
}

func DefaultRuntime() Runtime {
	return Runtime{
		GOOS:          runtime.GOOS,
		SpawnDetached: spawnDetached,
	}
}

func Execute(command Command, rt Runtime) Result {
	switch command.Kind {
	case "reboot":
		spec := RebootSpec(rt.GOOS)
		if err := rt.SpawnDetached(spec.File, spec.Args); err != nil {
			return Result{ID: command.ID, Status: "failed", Detail: err.Error()}
		}
		return Result{ID: command.ID, Status: "succeeded"}
	case "restart":
		spec := RestartSpec(rt.GOOS)
		if err := rt.SpawnDetached(spec.File, spec.Args); err != nil {
			return Result{ID: command.ID, Status: "failed", Detail: err.Error()}
		}
		return Result{ID: command.ID, Status: "succeeded"}
	case "update":
		return executeUpdate(command, rt)
	case "restart_service":
		return executeRestartService(command, rt)
	default:
		return Result{ID: command.ID, Status: "refused", Detail: "This command is not allowed."}
	}
}
