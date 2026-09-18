package agent

import (
	"encoding/json"
	"testing"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/collect" // pragma: allowlist secret
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/hub"     // pragma: allowlist secret
)

func marshalCheckIn(t *testing.T, titles *collect.Titles) map[string]any {
	t.Helper()
	raw, err := json.Marshal(hub.CheckInRequest{
		DeviceID:      "11111111-1111-4111-8111-111111111111",
		CheckInSecret: "secret",
		AgentVersion:  "0.2.1",
		Hostname:      "cabinet-01",
		OSFamily:      "linux",
		OSVersion:     "Debian GNU/Linux 13",
		VPN:           map[string]any{"interface_up": true, "vpn_ipv4": "10.80.30.11"},
		Services:      []any{},
		Titles:        titlesPayload(titles),
	})
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestCheckInRequestOmitsTitlesWhenNoWatchList(t *testing.T) {
	parsed := marshalCheckIn(t, nil)
	if value, present := parsed["titles"]; present {
		t.Fatalf("titles key must be omitted when the collector returns nil, got %v", value)
	}
}

func TestCheckInRequestKeepsTitlesWhenCollected(t *testing.T) {
	parsed := marshalCheckIn(t, &collect.Titles{Items: []collect.Title{{Title: "Cabinet A"}}})
	titles, ok := parsed["titles"].(map[string]any)
	if !ok {
		t.Fatalf("titles should be an object, got %v", parsed["titles"])
	}
	items, _ := titles["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one title item, got %v", titles["items"])
	}

	empty := marshalCheckIn(t, &collect.Titles{Items: []collect.Title{}})
	emptyTitles, ok := empty["titles"].(map[string]any)
	if !ok {
		t.Fatalf("an empty watch list should still send an object, got %v", empty["titles"])
	}
	if emptyItems, _ := emptyTitles["items"].([]any); len(emptyItems) != 0 {
		t.Fatalf("expected empty items, got %v", emptyTitles["items"])
	}
}
