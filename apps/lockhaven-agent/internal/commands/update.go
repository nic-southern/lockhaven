package commands

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxUpdateBytes = 64 << 20

// UpdateOffer is the download the Hub returned on this check-in.
// The command payload itself stays {id, kind}.
type UpdateOffer struct {
	BaseURL      string
	DownloadURL  string
	SHA256       string
	Executable   string
	Fetch        func(downloadURL string) ([]byte, error)
	DeferRestart bool
}

func executeUpdate(command Command, rt Runtime) Result {
	offer := rt.Update
	if offer == nil {
		return Result{ID: command.ID, Status: "refused", Detail: "No signed update is available."}
	}
	checksum, ok := normalizeSHA256(offer.SHA256)
	downloadURL := strings.TrimSpace(offer.DownloadURL)
	if !ok || downloadURL == "" {
		return Result{ID: command.ID, Status: "refused", Detail: "No signed update is available."}
	}
	resolved, err := allowedDownloadURL(offer.BaseURL, downloadURL)
	if err != nil {
		return Result{ID: command.ID, Status: "refused", Detail: "This update is not available from this Hub."}
	}

	fetch := offer.Fetch
	if fetch == nil {
		base := resolved.base
		fetch = func(target string) ([]byte, error) {
			return fetchSameOrigin(base, target)
		}
	}
	body, err := fetch(resolved.target)
	if err != nil {
		return Result{ID: command.ID, Status: "failed", Detail: "The update could not be downloaded."}
	}
	if len(body) == 0 || len(body) > maxUpdateBytes {
		return Result{ID: command.ID, Status: "failed", Detail: "The update could not be downloaded."}
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != checksum {
		return Result{ID: command.ID, Status: "failed", Detail: "The update could not be verified."}
	}

	exe, err := updateExecutable(offer.Executable)
	if err != nil {
		return Result{ID: command.ID, Status: "failed", Detail: "The update could not be installed."}
	}
	if err := stageAndPromote(exe, body); err != nil {
		return Result{ID: command.ID, Status: "failed", Detail: "The update could not be installed."}
	}

	if offer.DeferRestart {
		return Result{ID: command.ID, Status: "succeeded"}
	}
	spec := RestartSpec(rt.GOOS)
	spawn := rt.SpawnDetached
	if spawn == nil {
		spawn = spawnDetached
	}
	if err := spawn(spec.File, spec.Args); err != nil {
		return Result{ID: command.ID, Status: "failed", Detail: "The agent could not restart."}
	}
	return Result{ID: command.ID, Status: "succeeded"}
}

func normalizeSHA256(value string) (string, bool) {
	checksum := strings.ToLower(strings.TrimSpace(value))
	if len(checksum) != 64 {
		return "", false
	}
	for _, char := range checksum {
		switch {
		case char >= '0' && char <= '9':
		case char >= 'a' && char <= 'f':
		default:
			return "", false
		}
	}
	return checksum, true
}

type resolvedDownload struct {
	base   *url.URL
	target string
}

func allowedDownloadURL(baseRaw, downloadRaw string) (resolvedDownload, error) {
	baseRaw = strings.TrimSpace(baseRaw)
	base, err := url.Parse(baseRaw)
	if err != nil || base.Scheme == "" || base.Hostname() == "" {
		return resolvedDownload{}, errors.New("missing hub")
	}
	if base.Scheme != "https" && base.Scheme != "http" {
		return resolvedDownload{}, errors.New("unsupported hub")
	}
	if base.User != nil {
		return resolvedDownload{}, errors.New("unsupported hub")
	}

	raw := strings.TrimSpace(downloadRaw)
	if raw == "" || strings.Contains(raw, "..") || strings.Contains(raw, "\\") || strings.ContainsAny(raw, "\r\n") {
		return resolvedDownload{}, errors.New("rejected")
	}
	target, err := url.Parse(raw)
	if err != nil {
		return resolvedDownload{}, err
	}
	if target.User != nil {
		return resolvedDownload{}, errors.New("rejected")
	}
	if !target.IsAbs() {
		if !strings.HasPrefix(raw, "/install/") || strings.HasPrefix(raw, "//") {
			return resolvedDownload{}, errors.New("rejected")
		}
		target = base.ResolveReference(target)
	}
	if target.Scheme != base.Scheme || !strings.EqualFold(target.Hostname(), base.Hostname()) || portOrDefault(target) != portOrDefault(base) {
		return resolvedDownload{}, errors.New("rejected")
	}
	if !strings.HasPrefix(target.EscapedPath(), "/install/") {
		return resolvedDownload{}, errors.New("rejected")
	}
	return resolvedDownload{base: base, target: target.String()}, nil
}

func portOrDefault(value *url.URL) string {
	if port := value.Port(); port != "" {
		return port
	}
	if value.Scheme == "https" {
		return "443"
	}
	if value.Scheme == "http" {
		return "80"
	}
	return ""
}

func fetchSameOrigin(base *url.URL, target string) ([]byte, error) {
	client := &http.Client{
		Timeout: 2 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != base.Scheme || !strings.EqualFold(req.URL.Hostname(), base.Hostname()) || portOrDefault(req.URL) != portOrDefault(base) {
				return errors.New("redirect left the hub")
			}
			if !strings.HasPrefix(req.URL.EscapedPath(), "/install/") {
				return errors.New("redirect left the hub")
			}
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("download refused")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUpdateBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxUpdateBytes {
		return nil, errors.New("download too large")
	}
	return body, nil
}

func updateExecutable(explicit string) (string, error) {
	exe := strings.TrimSpace(explicit)
	if exe == "" {
		var err error
		exe, err = os.Executable()
		if err != nil {
			return "", err
		}
	}
	resolved, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return filepath.Clean(exe), nil
	}
	return resolved, nil
}

func stageAndPromote(executable string, body []byte) error {
	staged := executable + ".new"
	file, err := os.OpenFile(staged, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := file.Write(body); err != nil {
		file.Close()
		_ = os.Remove(staged)
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		_ = os.Remove(staged)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(staged)
		return err
	}
	if err := os.Chmod(staged, 0o755); err != nil {
		_ = os.Remove(staged)
		return err
	}

	backup := executable + ".previous"
	_ = os.Remove(backup)
	if err := os.Rename(executable, backup); err != nil {
		_ = os.Remove(staged)
		return err
	}
	if err := os.Rename(staged, executable); err != nil {
		_ = os.Rename(backup, executable)
		_ = os.Remove(staged)
		return err
	}
	return nil
}
