package collect

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestParseTitlesWatchList(t *testing.T) {
	watches := ParseTitlesWatchList(`{
		"titles": [
			{
				"key": "cabinet-a",
				"title": "Cabinet A",
				"process": "game-bin",
				"build_file": "/opt/game/BUILD",
				"config_path": "/opt/game/config.json"
			}
		]
	}`)
	if len(watches) != 1 || watches[0].Title != "Cabinet A" || watches[0].Process != "game-bin" {
		t.Fatalf("object parse: %+v", watches)
	}

	fromArray := ParseTitlesWatchList(`[{"title":"Cabinet B","build":"1.2.3"}]`)
	if len(fromArray) != 1 || fromArray[0].Build != "1.2.3" {
		t.Fatalf("array parse: %+v", fromArray)
	}

	if got := ParseTitlesWatchList("{"); got != nil {
		t.Fatalf("invalid json: %+v", got)
	}
	if got := ParseTitlesWatchList(`[{"process":"game-bin"}]`); len(got) != 0 {
		t.Fatalf("missing title: %+v", got)
	}
}

func TestProcessNameMatches(t *testing.T) {
	entries := []ProcEntry{
		{Comm: "game-bin", Cmdline: "/opt/game/game-bin\x00--kiosk"},
		{Comm: "sshd", Cmdline: "/usr/sbin/sshd"},
	}
	if !ProcessNameMatches("game-bin", entries) {
		t.Fatal("expected comm match")
	}
	if !ProcessNameMatches("GAME-BIN", entries) {
		t.Fatal("expected case-insensitive match")
	}
	if !ProcessNameMatches("/opt/game/game-bin", entries) {
		t.Fatal("expected path basename match")
	}
	if ProcessNameMatches("other", entries) {
		t.Fatal("unexpected match")
	}
}

func TestHashConfigBytesStable(t *testing.T) {
	left := HashConfigBytes([]ConfigPart{
		{Path: "b.txt", Content: []byte("b")},
		{Path: "a.txt", Content: []byte("a")},
	})
	right := HashConfigBytes([]ConfigPart{
		{Path: "a.txt", Content: []byte("a")},
		{Path: "b.txt", Content: []byte("b")},
	})
	if left != right || len(left) != 64 {
		t.Fatalf("hash mismatch: %s %s", left, right)
	}
}

func TestTitlesFromWatches(t *testing.T) {
	payload := TitlesFromWatches([]TitleWatch{{
		Key:        "cabinet-a",
		Title:      "Cabinet A",
		Process:    "game-bin",
		BuildFile:  "/opt/game/BUILD",
		ConfigPath: "/opt/game/config.json",
	}}, func(path string) (string, bool) {
		if path == "/opt/game/BUILD" {
			return "2026.04.11\n", true
		}
		return "", false
	}, func(string) []ConfigPart {
		return []ConfigPart{{Path: "config.json", Content: []byte(`{"theme":"dark"}`)}}
	}, []ProcEntry{{Comm: "game-bin", Cmdline: "/opt/game/game-bin"}})

	if len(payload.Items) != 1 {
		t.Fatalf("items: %+v", payload.Items)
	}
	item := payload.Items[0]
	if item.Key != "cabinet-a" || item.Build != "2026.04.11" {
		t.Fatalf("item: %+v", item)
	}
	if item.ProcessRunning == nil || !*item.ProcessRunning {
		t.Fatalf("expected running: %+v", item.ProcessRunning)
	}
	if len(item.ConfigHash) != 64 {
		t.Fatalf("hash: %s", item.ConfigHash)
	}
}

func TestCollectTitlesOmitsWhenNoWatchFile(t *testing.T) {
	t.Setenv("LOCKHAVEN_TITLES_FILE", filepath.Join(t.TempDir(), "missing.json"))
	if got := CollectTitles(); got != nil {
		t.Fatalf("expected omit, got %+v", got)
	}
}

func TestCollectTitlesEmptyWatchList(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "titles.json")
	if err := os.WriteFile(path, []byte(`{"titles":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOCKHAVEN_TITLES_FILE", path)
	got := CollectTitles()
	if got == nil {
		t.Fatal("expected empty titles payload")
	}
	if got.Items == nil {
		t.Fatal("expected empty items slice, not null")
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"items":[]}` {
		t.Fatalf("json: %s", raw)
	}
}
