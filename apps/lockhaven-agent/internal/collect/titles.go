package collect

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

const (
	maxTitleConfigFiles     = 256
	maxTitleConfigFileBytes = 1024 * 1024
)

type TitleWatch struct {
	Key        string
	Title      string
	Process    string
	Build      string
	BuildFile  string
	ConfigPath string
}

type ProcEntry struct {
	Comm    string
	Cmdline string
}

type Title struct {
	Key            string `json:"key,omitempty"`
	Title          string `json:"title"`
	Build          string `json:"build,omitempty"`
	ConfigHash     string `json:"config_hash,omitempty"`
	ProcessRunning *bool  `json:"process_running,omitempty"`
	ProcessName    string `json:"process_name,omitempty"`
}

type Titles struct {
	Items []Title `json:"items"`
}

func TitlesFileCandidates() []string {
	if override := strings.TrimSpace(os.Getenv("LOCKHAVEN_TITLES_FILE")); override != "" {
		return []string{override}
	}
	return []string{
		"/etc/lockhaven/titles.json",
		"/var/lib/lockhaven/titles.json",
	}
}

func ParseTitlesWatchList(raw string) []TitleWatch {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var asArray []map[string]any
	var asObject struct {
		Titles []map[string]any `json:"titles"`
	}
	rows := asArray
	if err := json.Unmarshal([]byte(raw), &asArray); err == nil {
		rows = asArray
	} else if err := json.Unmarshal([]byte(raw), &asObject); err == nil {
		rows = asObject.Titles
	} else {
		return nil
	}

	watches := make([]TitleWatch, 0, len(rows))
	for _, row := range rows {
		title := strings.TrimSpace(stringField(row, "title"))
		if title == "" {
			continue
		}
		watch := TitleWatch{Title: title}
		if value := strings.TrimSpace(stringField(row, "key")); value != "" {
			watch.Key = value
		}
		if value := strings.TrimSpace(stringField(row, "process")); value != "" {
			watch.Process = value
		}
		if value := strings.TrimSpace(stringField(row, "build")); value != "" {
			watch.Build = value
		}
		if value := strings.TrimSpace(stringField(row, "build_file")); value != "" {
			watch.BuildFile = value
		}
		if value := strings.TrimSpace(stringField(row, "config_path")); value != "" {
			watch.ConfigPath = value
		}
		watches = append(watches, watch)
	}
	return watches
}

func stringField(row map[string]any, key string) string {
	value, ok := row[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

func FirstCommandArg(cmdline string) string {
	first := cmdline
	if idx := strings.IndexByte(cmdline, 0); idx >= 0 {
		first = cmdline[:idx]
	} else if fields := strings.Fields(cmdline); len(fields) > 0 {
		first = fields[0]
	}
	return filepath.Base(strings.TrimSpace(first))
}

func ProcessNameMatches(processName string, entries []ProcEntry) bool {
	wanted := strings.ToLower(strings.TrimSpace(processName))
	if wanted == "" {
		return false
	}
	wantedBase := strings.ToLower(filepath.Base(wanted))
	for _, entry := range entries {
		comm := strings.ToLower(strings.TrimSpace(entry.Comm))
		arg := strings.ToLower(FirstCommandArg(entry.Cmdline))
		if comm == wanted || comm == wantedBase || arg == wanted || arg == wantedBase {
			return true
		}
	}
	return false
}

type ConfigPart struct {
	Path    string
	Content []byte
}

func HashConfigBytes(parts []ConfigPart) string {
	sorted := append([]ConfigPart(nil), parts...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Path < sorted[j].Path
	})
	sum := sha256.New()
	for _, part := range sorted {
		_, _ = io.WriteString(sum, part.Path)
		_, _ = sum.Write([]byte{0})
		content := part.Content
		if len(content) > maxTitleConfigFileBytes {
			content = content[:maxTitleConfigFileBytes]
		}
		_, _ = sum.Write(content)
		_, _ = sum.Write([]byte{0})
	}
	return hex.EncodeToString(sum.Sum(nil))
}

func TitlesFromWatches(
	watches []TitleWatch,
	readText func(string) (string, bool),
	configParts func(string) []ConfigPart,
	processes []ProcEntry,
) Titles {
	items := make([]Title, 0, len(watches))
	for _, watch := range watches {
		build := strings.TrimSpace(watch.Build)
		if watch.BuildFile != "" {
			if text, ok := readText(watch.BuildFile); ok {
				if trimmed := strings.TrimSpace(text); trimmed != "" {
					build = trimmed
				}
			}
		}
		item := Title{
			Key:   watch.Key,
			Title: watch.Title,
			Build: build,
		}
		if watch.Process != "" {
			running := ProcessNameMatches(watch.Process, processes)
			item.ProcessName = watch.Process
			item.ProcessRunning = &running
		}
		if watch.ConfigPath != "" {
			parts := configParts(watch.ConfigPath)
			if len(parts) > 0 {
				item.ConfigHash = HashConfigBytes(parts)
			}
		}
		items = append(items, item)
	}
	return Titles{Items: items}
}

func collectConfigParts(configPath string) []ConfigPart {
	info, err := os.Stat(configPath)
	if err != nil {
		return nil
	}
	if info.Mode().IsRegular() {
		content, err := os.ReadFile(configPath)
		if err != nil {
			return nil
		}
		return []ConfigPart{{Path: filepath.Base(configPath), Content: content}}
	}
	if !info.IsDir() {
		return nil
	}

	var parts []ConfigPart
	_ = filepath.WalkDir(configPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if name != filepath.Base(configPath) && strings.HasPrefix(name, ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		if len(parts) >= maxTitleConfigFiles {
			return fs.SkipAll
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		rel, relErr := filepath.Rel(configPath, path)
		if relErr != nil {
			rel = name
		}
		parts = append(parts, ConfigPart{
			Path:    filepath.ToSlash(rel),
			Content: content,
		})
		return nil
	})
	return parts
}

func collectProcEntries() []ProcEntry {
	dir, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	entries := make([]ProcEntry, 0, len(dir))
	for _, item := range dir {
		if !item.IsDir() || !isPIDName(item.Name()) {
			continue
		}
		base := filepath.Join("/proc", item.Name())
		comm := readTrimmed(filepath.Join(base, "comm"))
		cmdlineBytes, err := os.ReadFile(filepath.Join(base, "cmdline"))
		cmdline := ""
		if err == nil {
			cmdline = string(cmdlineBytes)
		}
		entries = append(entries, ProcEntry{Comm: comm, Cmdline: cmdline})
	}
	return entries
}

func isPIDName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func CollectTitles() *Titles {
	var raw []byte
	for _, candidate := range TitlesFileCandidates() {
		data, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		raw = data
		break
	}
	if raw == nil {
		return nil
	}
	watches := ParseTitlesWatchList(string(raw))
	titles := TitlesFromWatches(watches, func(path string) (string, bool) {
		text := readTrimmed(path)
		if text == "" {
			if _, err := os.Stat(path); err != nil {
				return "", false
			}
		}
		return text, true
	}, collectConfigParts, collectProcEntries())
	if titles.Items == nil {
		titles.Items = []Title{}
	}
	return &titles
}
