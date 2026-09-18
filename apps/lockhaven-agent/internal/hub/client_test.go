package hub

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func checkInServer(t *testing.T, status int, body string) (*Client, *[]byte) {
	t.Helper()
	var seen []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/check-in" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		seen, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return New(server.URL), &seen
}

func TestCheckInRefusedWithCode(t *testing.T) {
	client, _ := checkInServer(t, http.StatusConflict, `{"error":"This device reported a different hostname than the one on record.","code":"hostname_mismatch"}`)
	resp, err := client.CheckIn(CheckInRequest{DeviceID: "dev", CheckInSecret: "top-secret"})
	if resp != nil {
		t.Fatalf("expected nil response, got %+v", resp)
	}
	var refused *CheckInError
	if !errors.As(err, &refused) {
		t.Fatalf("expected *CheckInError, got %T: %v", err, err)
	}
	if refused.Status != 409 || refused.Code != "hostname_mismatch" {
		t.Fatalf("unexpected fields: %+v", refused)
	}
	want := "Check-in refused (409 hostname_mismatch): This device reported a different hostname than the one on record."
	if err.Error() != want {
		t.Fatalf("message:\n got %q\nwant %q", err.Error(), want)
	}
	if strings.Contains(err.Error(), "top-secret") {
		t.Fatalf("error must not leak the check-in secret: %q", err.Error())
	}
}

func TestCheckInRefusedWithoutCode(t *testing.T) {
	client, _ := checkInServer(t, http.StatusUnauthorized, `{"error":"Unauthorized"}`)
	_, err := client.CheckIn(CheckInRequest{DeviceID: "dev", CheckInSecret: "top-secret"})
	var refused *CheckInError
	if !errors.As(err, &refused) {
		t.Fatalf("expected *CheckInError, got %T: %v", err, err)
	}
	if refused.Status != 401 || refused.Code != "" || refused.Message != "Unauthorized" {
		t.Fatalf("unexpected fields: %+v", refused)
	}
	if got, want := err.Error(), "Check-in refused (401): Unauthorized"; got != want {
		t.Fatalf("message:\n got %q\nwant %q", got, want)
	}
}

func TestCheckInRefusedWithoutBody(t *testing.T) {
	client, _ := checkInServer(t, http.StatusTooManyRequests, "")
	_, err := client.CheckIn(CheckInRequest{DeviceID: "dev"})
	var refused *CheckInError
	if !errors.As(err, &refused) {
		t.Fatalf("expected *CheckInError, got %T: %v", err, err)
	}
	if got, want := err.Error(), "Check-in refused (429)"; got != want {
		t.Fatalf("message:\n got %q\nwant %q", got, want)
	}
}

func TestCheckInAccepted(t *testing.T) {
	client, seen := checkInServer(t, http.StatusOK, `{"ok":true,"desired_agent_version":"0.2.1","commands":[],"modules":[]}`)
	resp, err := client.CheckIn(CheckInRequest{
		DeviceID:      "11111111-1111-4111-8111-111111111111",
		CheckInSecret: "secret",
		AgentVersion:  "0.2.1",
		Hostname:      "cabinet-01",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || !resp.OK || resp.DesiredAgentVersion != "0.2.1" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	var sent map[string]any
	if err := json.Unmarshal(*seen, &sent); err != nil {
		t.Fatal(err)
	}
	if sent["device_id"] != "11111111-1111-4111-8111-111111111111" || sent["hostname"] != "cabinet-01" {
		t.Fatalf("request payload: %s", *seen)
	}
}

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
