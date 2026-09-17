package collect

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config" // pragma: allowlist secret
)

func TestSafeCollectorPathRejectsTraversalAndUNC(t *testing.T) {
	if !safeCollectorPath("/var/lib/game/build.txt") {
		t.Fatal("unix path should be allowed")
	}
	if !safeCollectorPath(`C:\Games\build.txt`) {
		t.Fatal("windows path should be allowed")
	}
	if safeCollectorPath("build.txt") {
		t.Fatal("relative path must be refused")
	}
	if safeCollectorPath("/var/lib/../etc/passwd") {
		t.Fatal("parent traversal must be refused")
	}
	if safeCollectorPath("//server/share/file.txt") {
		t.Fatal("UNC path must be refused")
	}
}

func TestCollectModulesReadsTextWithoutExec(t *testing.T) {
	dir := t.TempDir()
	build := filepath.Join(dir, "build.txt")
	if err := os.WriteFile(build, []byte("1.4.2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(dir, "game.exe")
	if err := os.WriteFile(exe, []byte("MZ"), 0o700); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho hi\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	reports := CollectModules([]config.AssignedModule{{
		ID:   "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		Kind: "observations",
		Name: "Cabinet facts",
		Collectors: []config.AssignedCollector{
			{ID: "11111111-1111-4111-8111-111111111111", Type: "file_text", Path: build},
			{ID: "22222222-2222-4222-8222-222222222222", Type: "file_text", Path: exe},
			{ID: "33333333-3333-4333-8333-333333333333", Type: "file_text", Path: script},
			{ID: "44444444-4444-4444-8444-444444444444", Type: "file_exists", Path: build},
			{ID: "55555555-5555-4555-8555-555555555555", Type: "shell", Path: build},
		},
	}})
	if len(reports) != 1 {
		t.Fatalf("reports=%d", len(reports))
	}
	got := map[string]ModuleObservation{}
	for _, obs := range reports[0].Observations {
		got[obs.ID] = obs
	}
	text := got["11111111-1111-4111-8111-111111111111"]
	if text.Value != "1.4.2" || text.Exists == nil || !*text.Exists {
		t.Fatalf("text observation %+v", text)
	}
	if _, ok := got["22222222-2222-4222-8222-222222222222"]; ok {
		t.Fatal("executable file_text must be skipped")
	}
	if _, ok := got["33333333-3333-4333-8333-333333333333"]; ok {
		t.Fatal("script-like file_text must be skipped")
	}
	exists := got["44444444-4444-4444-8444-444444444444"]
	if exists.Exists == nil || !*exists.Exists {
		t.Fatalf("exists observation %+v", exists)
	}
	if _, ok := got["55555555-5555-4555-8555-555555555555"]; ok {
		t.Fatal("unknown collector types must be skipped")
	}
}

func TestCollectModulesEmptyAssigned(t *testing.T) {
	got := CollectModules(nil)
	if got == nil || len(got) != 0 {
		t.Fatalf("got %#v", got)
	}
}
