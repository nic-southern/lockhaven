package hub

import (
	"encoding/json"
	"testing"
)

func TestCheckInRequestTitlesJSON(t *testing.T) {
	running := false
	raw, err := json.Marshal(CheckInRequest{
		DeviceID:      "11111111-1111-4111-8111-111111111111",
		CheckInSecret: "secret",
		AgentVersion:  "0.2.0",
		Hostname:      "cabinet-01",
		OSFamily:      "linux",
		OSVersion:     "Debian GNU/Linux 12",
		VPN:           map[string]any{"interface_up": true, "vpn_ipv4": "10.80.30.11"},
		Services:      []any{},
		Titles: &Titles{
			Items: []Title{{
				Key:            "cabinet-a",
				Title:          "Cabinet A",
				Build:          "2026.04.11",
				ConfigHash:     "abc",
				ProcessRunning: &running,
				ProcessName:    "game-bin",
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	titles, ok := parsed["titles"].(map[string]any)
	if !ok {
		t.Fatalf("missing titles: %s", raw)
	}
	items, _ := titles["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items: %s", raw)
	}
	item := items[0].(map[string]any)
	if item["title"] != "Cabinet A" || item["build"] != "2026.04.11" || item["config_hash"] != "abc" {
		t.Fatalf("item: %+v", item)
	}
	if item["process_running"] != false {
		t.Fatalf("process_running should serialize false: %+v", item)
	}
}
