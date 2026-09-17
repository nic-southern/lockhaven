package commands

import (
	"reflect"
	"testing"
)

func TestRebootUsesHardcodedArgv(t *testing.T) {
	var spawned []Spec
	rt := Runtime{
		GOOS: "linux",
		SpawnDetached: func(file string, args []string) error {
			spawned = append(spawned, Spec{File: file, Args: args})
			return nil
		},
	}
	result := Execute(Command{ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", Kind: "reboot"}, rt)
	if result.Status != "succeeded" {
		t.Fatalf("status %s", result.Status)
	}
	want := Spec{File: "/sbin/shutdown", Args: []string{"-r", "now"}}
	if !reflect.DeepEqual(spawned, []Spec{want}) {
		t.Fatalf("spawned %#v", spawned)
	}
}

func TestRestartUsesUnitName(t *testing.T) {
	var spawned []Spec
	rt := Runtime{
		GOOS: "linux",
		SpawnDetached: func(file string, args []string) error {
			spawned = append(spawned, Spec{File: file, Args: args})
			return nil
		},
	}
	result := Execute(Command{ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", Kind: "restart"}, rt)
	if result.Status != "succeeded" {
		t.Fatalf("status %s", result.Status)
	}
	want := Spec{File: "/bin/systemctl", Args: []string{"restart", "lockhaven-agent.service"}}
	if !reflect.DeepEqual(spawned, []Spec{want}) {
		t.Fatalf("spawned %#v", spawned)
	}
}

func TestWindowsRebootUsesShutdownExe(t *testing.T) {
	var spawned []Spec
	rt := Runtime{
		GOOS: "windows",
		SpawnDetached: func(file string, args []string) error {
			spawned = append(spawned, Spec{File: file, Args: args})
			return nil
		},
	}
	result := Execute(Command{ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", Kind: "reboot"}, rt)
	if result.Status != "succeeded" {
		t.Fatalf("status %s", result.Status)
	}
	want := Spec{File: "shutdown.exe", Args: []string{"/r", "/t", "0"}}
	if !reflect.DeepEqual(spawned, []Spec{want}) {
		t.Fatalf("spawned %#v", spawned)
	}
}

func TestWindowsRestartUsesServiceName(t *testing.T) {
	var spawned []Spec
	rt := Runtime{
		GOOS: "windows",
		SpawnDetached: func(file string, args []string) error {
			spawned = append(spawned, Spec{File: file, Args: args})
			return nil
		},
	}
	result := Execute(Command{ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", Kind: "restart"}, rt)
	if result.Status != "succeeded" {
		t.Fatalf("status %s", result.Status)
	}
	if len(spawned) != 1 || spawned[0].File != "powershell.exe" {
		t.Fatalf("spawned %#v", spawned)
	}
	foundName := false
	for _, arg := range spawned[0].Args {
		if arg == "Restart-Service -Name LockhavenAgent -Force" {
			foundName = true
		}
	}
	if !foundName {
		t.Fatalf("missing service restart argv: %#v", spawned[0].Args)
	}
}

func TestUpdateDoesNotSpawn(t *testing.T) {
	var spawned int
	rt := Runtime{
		SpawnDetached: func(file string, args []string) error {
			spawned++
			return nil
		},
	}
	result := Execute(Command{ID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", Kind: "update"}, rt)
	if result.Status != "failed" || spawned != 0 {
		t.Fatalf("result %+v spawned %d", result, spawned)
	}
}

func TestUnknownKindRefused(t *testing.T) {
	var spawned int
	rt := Runtime{
		SpawnDetached: func(file string, args []string) error {
			spawned++
			return nil
		},
	}
	result := Execute(Command{ID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", Kind: "ssh"}, rt)
	if result.Status != "refused" || spawned != 0 {
		t.Fatalf("result %+v spawned %d", result, spawned)
	}
}
