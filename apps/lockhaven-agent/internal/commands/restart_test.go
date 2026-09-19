package commands

import "testing"

func TestRestartServiceUsesAllowlistedArgv(t *testing.T) {
	var got []string
	rt := Runtime{
		GOOS: "linux",
		Services: []ServiceAllow{
			{Name: "Web", Target: "nginx.service"},
		},
		RestartService: func(target string) error {
			got = append(got, target)
			return nil
		},
	}
	result := Execute(Command{
		ID:   "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		Kind: "restart_service",
		Name: "Web",
	}, rt)
	if result.Status != "succeeded" || len(got) != 1 || got[0] != "nginx.service" {
		t.Fatalf("result %+v got %#v", result, got)
	}
}

func TestRestartServiceRefusesUnknownName(t *testing.T) {
	called := 0
	rt := Runtime{
		Services: []ServiceAllow{{Name: "Web", Target: "nginx.service"}},
		RestartService: func(target string) error {
			called++
			return nil
		},
	}
	result := Execute(Command{
		ID:   "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		Kind: "restart_service",
		Name: "Database",
	}, rt)
	if result.Status != "refused" || called != 0 {
		t.Fatalf("result %+v called %d", result, called)
	}
}

func TestRestartServiceRefusesUnsafeTarget(t *testing.T) {
	called := 0
	rt := Runtime{
		Services: []ServiceAllow{{Name: "Web", Target: "nginx.service;id"}},
		RestartService: func(target string) error {
			called++
			return nil
		},
	}
	result := Execute(Command{
		ID:   "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		Kind: "restart_service",
		Name: "Web",
	}, rt)
	if result.Status != "refused" || called != 0 {
		t.Fatalf("result %+v called %d", result, called)
	}
}

func TestDeferOwnServiceRestart(t *testing.T) {
	rt := Runtime{
		GOOS: "linux",
		Services: []ServiceAllow{
			{Name: "Agent", Target: "lockhaven-agent.service"},
			{Name: "Web", Target: "nginx.service"},
		},
	}
	if !DeferOwnServiceRestart(Command{Kind: "restart_service", Name: "Agent"}, rt) {
		t.Fatal("expected agent restart to be deferred")
	}
	if DeferOwnServiceRestart(Command{Kind: "restart_service", Name: "Web"}, rt) {
		t.Fatal("expected other services to run immediately")
	}
}

func TestResolveRestartServiceRequiresName(t *testing.T) {
	command, _, ok := Resolve(map[string]any{
		"id":   "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		"kind": "restart_service",
		"name": "Web",
	})
	if !ok || command.Name != "Web" {
		t.Fatalf("command %+v ok %v", command, ok)
	}
	_, result, ok := Resolve(map[string]any{
		"id":      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		"kind":    "restart_service",
		"name":    "Web",
		"command": "systemctl restart nginx",
	})
	if ok || result.Status != "refused" {
		t.Fatalf("expected refusal, %+v", result)
	}
	_, result, ok = Resolve(map[string]any{
		"id":   "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		"kind": "format_disk",
	})
	if ok || result.Status != "refused" {
		t.Fatalf("unknown kind %+v", result)
	}
}
