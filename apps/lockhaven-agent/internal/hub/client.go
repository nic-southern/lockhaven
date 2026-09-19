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

// CheckInError is returned when the Hub answers a check-in with an HTTP
// status >= 400. It carries the status plus whatever product-language
// message and machine-readable code the Hub included in its JSON body so
// callers (CLI, service loop) can show operators the actual reason.
type CheckInError struct {
	Status  int
	Code    string
	Message string
}

func (e *CheckInError) Error() string {
	label := fmt.Sprintf("%d", e.Status)
	if e.Code != "" {
		label += " " + e.Code
	}
	if e.Message == "" {
		return fmt.Sprintf("Check-in refused (%s)", label)
	}
	return fmt.Sprintf("Check-in refused (%s): %s", label, e.Message)
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
	Architecture   string          `json:"architecture,omitempty"`
	VPN            any             `json:"vpn"`
	Services       any             `json:"services"`
	Metrics        any             `json:"metrics,omitempty"`
	Packages       any             `json:"packages,omitempty"`
	Titles         any             `json:"titles,omitempty"`
	Modules        any             `json:"modules,omitempty"`
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

type ModuleCollector struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Process string `json:"process,omitempty"`
	Path    string `json:"path,omitempty"`
}

type ModuleDefinition struct {
	ID         string            `json:"id"`
	Kind       string            `json:"kind"`
	Name       string            `json:"name"`
	Collectors []ModuleCollector `json:"collectors"`
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

type CheckInResponse struct {
	OK                  bool               `json:"ok"`
	DesiredAgentVersion string             `json:"desired_agent_version"`
	DownloadURL         string             `json:"download_url"`
	SHA256              string             `json:"sha256"`
	Commands            []any              `json:"commands"`
	Modules             []ModuleDefinition `json:"modules"`
	AssignedServices    []AssignedService  `json:"assigned_services"`
}

type AssignedService struct {
	Name   string `json:"name"`
	Target string `json:"target"`
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
		body := decodeError(raw)
		return nil, &CheckInError{Status: status, Code: body.Code, Message: body.Error}
	}
	var out CheckInResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
