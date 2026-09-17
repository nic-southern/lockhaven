package hub

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ServiceIn struct {
	Type     string `json:"type"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	Password string `json:"password,omitempty"`
}

type EnrollRequest struct {
	Token              string      `json:"token"`
	Hostname           string      `json:"hostname"`
	OSFamily           string      `json:"os_family"`
	OSVersion          string      `json:"os_version"`
	Architecture       string      `json:"architecture"`
	SerialNumber       string      `json:"serial_number"`
	WireGuardPublicKey string      `json:"wireguard_public_key"`
	Services           []ServiceIn `json:"services"`
}

type AttachRequest struct {
	Token              string `json:"token"`
	Hostname           string `json:"hostname"`
	OSFamily           string `json:"os_family"`
	OSVersion          string `json:"os_version"`
	Architecture       string `json:"architecture"`
	SerialNumber       string `json:"serial_number"`
	DeviceID           string `json:"device_id,omitempty"`
	WireGuardPublicKey string `json:"wireguard_public_key,omitempty"`
}

type WireGuardSettings struct {
	ServerPublicKey     string   `json:"server_public_key"`
	Endpoint            string   `json:"endpoint"`
	AllowedIPs          []string `json:"allowed_ips"`
	PersistentKeepalive int      `json:"persistent_keepalive"`
}

type BindResponse struct {
	DeviceID      string            `json:"device_id"`
	VpnIPv4       string            `json:"vpn_ipv4"`
	CheckInSecret string            `json:"check_in_secret"`
	Attached      bool              `json:"attached"`
	TunnelReady   bool              `json:"tunnel_ready"`
	WireGuard     WireGuardSettings `json:"wireguard"`
}

type ErrorBody struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

type CommandResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type CheckInRequest struct {
	DeviceID       string          `json:"device_id"`
	CheckInSecret  string          `json:"check_in_secret"`
	AgentVersion   string          `json:"agent_version"`
	Hostname       string          `json:"hostname"`
	OSFamily       string          `json:"os_family"`
	OSVersion      string          `json:"os_version"`
	VPN            any             `json:"vpn"`
	Services       any             `json:"services"`
	Metrics        any             `json:"metrics,omitempty"`
	Packages       any             `json:"packages,omitempty"`
	Titles         any             `json:"titles,omitempty"`
	CommandResults []CommandResult `json:"command_results,omitempty"`
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

type CheckInResponse struct {
	OK                  bool   `json:"ok"`
	DesiredAgentVersion string `json:"desired_agent_version"`
	DownloadURL         string `json:"download_url"`
	Commands            []any  `json:"commands"`
}

type Client struct {
	HTTP    *http.Client
	BaseURL string
}

func New(baseURL string) *Client {
	return &Client{
		HTTP:    &http.Client{Timeout: 30 * time.Second},
		BaseURL: strings.TrimRight(baseURL, "/"),
	}
}

func (c *Client) postJSON(path string, body any) (int, []byte, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	resp, err := c.HTTP.Post(c.BaseURL+path, "application/json", bytes.NewReader(payload))
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, raw, nil
}

func decodeError(raw []byte) ErrorBody {
	var errBody ErrorBody
	_ = json.Unmarshal(raw, &errBody)
	return errBody
}

func (c *Client) Attach(req AttachRequest) (*BindResponse, ErrorBody, error) {
	status, raw, err := c.postJSON("/api/agent/attach", req)
	if err != nil {
		return nil, ErrorBody{}, err
	}
	if status >= 400 {
		return nil, decodeError(raw), fmt.Errorf("attach refused (%d)", status)
	}
	var out BindResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, ErrorBody{}, err
	}
	out.Attached = true
	return &out, ErrorBody{}, nil
}

func (c *Client) Enroll(req EnrollRequest) (*BindResponse, ErrorBody, error) {
	status, raw, err := c.postJSON("/api/enroll", req)
	if err != nil {
		return nil, ErrorBody{}, err
	}
	if status >= 400 {
		return nil, decodeError(raw), fmt.Errorf("enrollment refused (%d)", status)
	}
	var out BindResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, ErrorBody{}, err
	}
	return &out, ErrorBody{}, nil
}

func (c *Client) CheckIn(req CheckInRequest) (*CheckInResponse, error) {
	status, raw, err := c.postJSON("/api/agent/check-in", req)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("check-in was refused")
	}
	var out CheckInResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
