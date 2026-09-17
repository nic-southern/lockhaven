package collect

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config" // pragma: allowlist secret
)

const (
	maxModuleTextBytes = 256
	maxModuleReadBytes = 4096
	maxModulePathLen   = 512
	maxModuleProcess   = 128
)

var (
	controlChars     = regexp.MustCompile(`[\x00-\x1f\x7f]`)
	processForbidden = regexp.MustCompile(`[\\/:*?"<>|;&=` + "`" + `$()]`)
	executableSuffix = regexp.MustCompile(`(?i)\.(exe|bat|cmd|com|ps1|psm1|sh|bash|dll|sys|msi|scr|vbs|js|wsf)$`)
	scriptishValue   = regexp.MustCompile(`(?i)^\s*(?:#!|MZ|\x7fELF|<\?php|<script\b|javascript:|vbscript:|powershell(?:\.exe)?(?:\s|-)|cmd(?:\.exe)?\s|/bin/(?:ba)?sh\b)`)
)

type moduleProcEntry struct {
	Comm    string
	Cmdline string
}

type ModuleObservation struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Running *bool  `json:"running,omitempty"`
	Exists  *bool  `json:"exists,omitempty"`
	Value   string `json:"value,omitempty"`
	Bytes   *int64 `json:"bytes,omitempty"`
}

type ModuleReport struct {
	ModuleID     string              `json:"module_id"`
	Kind         string              `json:"kind"`
	Observations []ModuleObservation `json:"observations"`
}

// CollectModules reads local process and file state for Hub-issued collectors.
// It never executes a path, evaluates a script, or runs an uploaded blob.
func CollectModules(assigned []config.AssignedModule) []ModuleReport {
	if len(assigned) == 0 {
		return []ModuleReport{}
	}
	processes := collectModuleProcEntries()
	reports := make([]ModuleReport, 0, len(assigned))
	for _, module := range assigned {
		if module.ID == "" || module.Kind != "observations" {
			continue
		}
		report := ModuleReport{
			ModuleID:     module.ID,
			Kind:         module.Kind,
			Observations: make([]ModuleObservation, 0, len(module.Collectors)),
		}
		for _, collector := range module.Collectors {
			if observation, ok := collectObservation(collector, processes); ok {
				report.Observations = append(report.Observations, observation)
			}
		}
		reports = append(reports, report)
	}
	return reports
}

func collectObservation(collector config.AssignedCollector, processes []moduleProcEntry) (ModuleObservation, bool) {
	if collector.ID == "" {
		return ModuleObservation{}, false
	}
	switch collector.Type {
	case "process_running":
		if !safeProcessName(collector.Process) {
			return ModuleObservation{}, false
		}
		running := processNameMatches(collector.Process, processes)
		return ModuleObservation{ID: collector.ID, Type: "process_running", Running: &running}, true
	case "file_exists":
		if !safeCollectorPath(collector.Path) {
			return ModuleObservation{}, false
		}
		exists := moduleFileExists(collector.Path)
		return ModuleObservation{ID: collector.ID, Type: "file_exists", Exists: &exists}, true
	case "file_text":
		if !safeCollectorPath(collector.Path) || executableCollectorPath(collector.Path) {
			return ModuleObservation{}, false
		}
		text, exists, ok := readModuleText(collector.Path)
		if !ok {
			return ModuleObservation{}, false
		}
		obs := ModuleObservation{ID: collector.ID, Type: "file_text", Exists: &exists}
		if exists {
			obs.Value = text
		}
		return obs, true
	case "file_size":
		if !safeCollectorPath(collector.Path) {
			return ModuleObservation{}, false
		}
		size, exists, ok := fileSize(collector.Path)
		if !ok {
			return ModuleObservation{}, false
		}
		obs := ModuleObservation{ID: collector.ID, Type: "file_size", Exists: &exists}
		if exists {
			obs.Bytes = &size
		}
		return obs, true
	default:
		return ModuleObservation{}, false
	}
}

func safeProcessName(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || len(trimmed) > maxModuleProcess {
		return false
	}
	if trimmed == "." || trimmed == ".." {
		return false
	}
	if controlChars.MatchString(trimmed) || processForbidden.MatchString(trimmed) {
		return false
	}
	return true
}

func safeCollectorPath(value string) bool {
	if len(value) < 2 || len(value) > maxModulePathLen {
		return false
	}
	if controlChars.MatchString(value) {
		return false
	}
	normalized := strings.ReplaceAll(value, "\\", "/")
	for _, part := range strings.Split(normalized, "/") {
		if part == ".." {
			return false
		}
	}
	if strings.HasPrefix(normalized, "//") {
		return false
	}
	if len(normalized) >= 3 && unicode.IsLetter(rune(normalized[0])) && normalized[1] == ':' && normalized[2] == '/' {
		return true
	}
	return strings.HasPrefix(normalized, "/") && !strings.HasPrefix(normalized, "//")
}

func executableCollectorPath(value string) bool {
	base := filepath.Base(strings.ReplaceAll(value, "\\", "/"))
	return executableSuffix.MatchString(base)
}

func moduleFileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func fileSize(path string) (int64, bool, bool) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, true
		}
		return 0, false, false
	}
	if !info.Mode().IsRegular() {
		return 0, false, false
	}
	size := info.Size()
	if size < 0 {
		return 0, false, false
	}
	return size, true, true
}

func readModuleText(path string) (string, bool, bool) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, true
		}
		return "", false, false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return "", false, false
	}
	raw, err := io.ReadAll(io.LimitReader(file, maxModuleReadBytes))
	if err != nil {
		return "", false, false
	}
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return "", true, false
	}
	if looksLikeScriptOrBinary(text) {
		return "", false, false
	}
	runes := []rune(text)
	if len(runes) > maxModuleTextBytes {
		text = string(runes[:maxModuleTextBytes])
	}
	return text, true, true
}

func looksLikeScriptOrBinary(value string) bool {
	if controlChars.MatchString(value) {
		return true
	}
	if scriptishValue.MatchString(value) {
		return true
	}
	if len(value) < 8 {
		return false
	}
	nonText := 0
	for i := 0; i < len(value); i++ {
		code := value[i]
		if code < 32 || code == 127 || code > 126 {
			nonText++
		}
	}
	return float64(nonText)/float64(len(value)) > 0.3
}

func processNameMatches(processName string, entries []moduleProcEntry) bool {
	wanted := strings.ToLower(strings.TrimSpace(processName))
	if wanted == "" {
		return false
	}
	wantedBase := strings.ToLower(filepath.Base(wanted))
	for _, entry := range entries {
		comm := strings.ToLower(strings.TrimSpace(entry.Comm))
		arg := strings.ToLower(firstCommandArg(entry.Cmdline))
		if comm == wanted || comm == wantedBase || arg == wanted || arg == wantedBase {
			return true
		}
	}
	return false
}

func firstCommandArg(cmdline string) string {
	first := cmdline
	if idx := strings.IndexByte(cmdline, 0); idx >= 0 {
		first = cmdline[:idx]
	} else if fields := strings.Fields(cmdline); len(fields) > 0 {
		first = fields[0]
	}
	return filepath.Base(strings.TrimSpace(first))
}
