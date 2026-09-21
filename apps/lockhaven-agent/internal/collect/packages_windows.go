//go:build windows

package collect

import (
	"context"
	"strings"
	"time"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/proc" // pragma: allowlist secret

	"golang.org/x/sys/windows/registry"
)

const maxWindowsPackages = 2000

const windowsUpdateScript = `
$ErrorActionPreference = 'Stop'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
} catch {
  exit 1
}
$count = 0
foreach ($update in @($result.Updates)) {
  if ($count -ge 200) { break }
  $names = New-Object System.Collections.Generic.List[string]
  if ($update.Categories) {
    foreach ($cat in @($update.Categories)) { [void]$names.Add([string]$cat.Name) }
  }
  $kb = ''
  if ($update.KBArticleIDs) {
    foreach ($article in @($update.KBArticleIDs)) { if (-not $kb) { $kb = [string]$article } }
  }
  $title = [string]$update.Title
  $joined = $names -join '|'
  foreach ($ch in @([char]9, [char]10, [char]13)) {
    $title = $title.Replace([string]$ch, ' ')
    $joined = $joined.Replace([string]$ch, ' ')
  }
  Write-Output ($title + [char]9 + $kb + [char]9 + $joined)
  $count++
}
`

func platformPackages() ([]Pkg, []PkgUpdate, bool) {
	installed := readUninstallPackages()
	return installed, collectWindowsUpdates(), windowsRebootRequired()
}

func collectWindowsUpdates() []PkgUpdate {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result := proc.Run(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", windowsUpdateScript)
	if result.Code != 0 {
		return []PkgUpdate{}
	}
	return ParseWindowsUpdateList(result.Stdout)
}

func windowsRebootRequired() bool {
	paths := []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`,
	}
	for _, path := range paths {
		key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
		if err == nil {
			key.Close()
			return true
		}
	}
	return false
}

func readUninstallPackages() []Pkg {
	roots := []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
		`SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
	}
	var pkgs []Pkg
	seen := map[string]struct{}{}
	for _, path := range roots {
		key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		names, err := key.ReadSubKeyNames(maxWindowsPackages)
		key.Close()
		if err != nil && len(names) == 0 {
			continue
		}
		for _, name := range names {
			if len(pkgs) >= maxWindowsPackages {
				return pkgs
			}
			sk, err := registry.OpenKey(registry.LOCAL_MACHINE, path+`\`+name, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			display, _, _ := sk.GetStringValue("DisplayName")
			version, _, _ := sk.GetStringValue("DisplayVersion")
			sk.Close()
			display = strings.TrimSpace(display)
			version = strings.TrimSpace(version)
			if display == "" {
				continue
			}
			if version == "" {
				version = "0"
			}
			id := display + "\x00" + version
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			pkgs = append(pkgs, Pkg{Name: display, Version: version, Source: "windows"})
		}
	}
	return pkgs
}
