package commands

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestUpdateHashMismatchLeavesBinary(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "lockhaven-agent")
	if err := os.WriteFile(exe, []byte("running"), 0o755); err != nil {
		t.Fatal(err)
	}
	fetched := 0
	rt := Runtime{
		GOOS: "linux",
		SpawnDetached: func(file string, args []string) error {
			t.Fatal("must not restart")
			return nil
		},
		Update: &UpdateOffer{
			BaseURL:     "https://hub.example",
			DownloadURL: "https://hub.example/install/lockhaven-agent-linux-amd64",
			SHA256:      hex.EncodeToString(bytesOf("not-the-payload")),
			Executable:  exe,
			Fetch: func(url string) ([]byte, error) {
				fetched++
				if url != "https://hub.example/install/lockhaven-agent-linux-amd64" {
					t.Fatalf("url %s", url)
				}
				return []byte("payload"), nil
			},
		},
	}
	result := Execute(Command{ID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", Kind: "update"}, rt)
	if result.Status != "failed" || fetched != 1 {
		t.Fatalf("result %+v fetched %d", result, fetched)
	}
	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "running" {
		t.Fatalf("binary replaced: %q", got)
	}
	if _, err := os.Stat(exe + ".new"); !os.IsNotExist(err) {
		t.Fatalf("staged file left behind: %v", err)
	}
}

func TestUpdateHashMatchStagesFile(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "lockhaven-agent")
	if err := os.WriteFile(exe, []byte("running"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte("replacement-binary")
	sum := sha256.Sum256(payload)
	var spawned []Spec
	rt := Runtime{
		GOOS: "linux",
		SpawnDetached: func(file string, args []string) error {
			spawned = append(spawned, Spec{File: file, Args: append([]string{}, args...)})
			return nil
		},
		Update: &UpdateOffer{
			BaseURL:     "https://hub.example",
			DownloadURL: "https://hub.example/install/lockhaven-agent-linux-amd64",
			SHA256:      hex.EncodeToString(sum[:]),
			Executable:  exe,
			Fetch: func(url string) ([]byte, error) {
				return payload, nil
			},
		},
	}
	result := Execute(Command{ID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", Kind: "update"}, rt)
	if result.Status != "succeeded" {
		t.Fatalf("result %+v", result)
	}
	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("staged contents %q", got)
	}
	if len(spawned) != 1 || spawned[0].File != "/bin/systemctl" {
		t.Fatalf("spawned %#v", spawned)
	}
	joined := stringsJoin(spawned[0].Args)
	if joined != "restart lockhaven-agent.service" {
		t.Fatalf("args %q", joined)
	}
}

func TestUpdateRejectsForeignURL(t *testing.T) {
	fetched := 0
	rt := Runtime{
		SpawnDetached: func(file string, args []string) error {
			t.Fatal("must not spawn")
			return nil
		},
		Update: &UpdateOffer{
			BaseURL:     "https://hub.example",
			DownloadURL: "https://evil.example/install/lockhaven-agent-linux-amd64",
			SHA256:      "ab" + hex.EncodeToString(make([]byte, 31)),
			Fetch: func(url string) ([]byte, error) {
				fetched++
				return []byte("nope"), nil
			},
		},
	}
	// 31 zero bytes + "ab" is not 64 hex. Use a real checksum so refusal is the host, not the hash.
	sum := sha256.Sum256([]byte("nope"))
	rt.Update.SHA256 = hex.EncodeToString(sum[:])
	result := Execute(Command{ID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", Kind: "update"}, rt)
	if result.Status != "refused" || fetched != 0 {
		t.Fatalf("result %+v fetched %d", result, fetched)
	}
}

func TestUpdateRefusesMissingChecksum(t *testing.T) {
	fetched := 0
	rt := Runtime{
		Update: &UpdateOffer{
			BaseURL:     "https://hub.example",
			DownloadURL: "https://hub.example/install/lockhaven-agent-linux-amd64",
			Fetch: func(url string) ([]byte, error) {
				fetched++
				return nil, nil
			},
		},
	}
	result := Execute(Command{ID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", Kind: "update"}, rt)
	if result.Status != "refused" || fetched != 0 {
		t.Fatalf("result %+v fetched %d", result, fetched)
	}
}

func bytesOf(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

func stringsJoin(parts []string) string {
	out := ""
	for i, part := range parts {
		if i > 0 {
			out += " "
		}
		out += part
	}
	return out
}
