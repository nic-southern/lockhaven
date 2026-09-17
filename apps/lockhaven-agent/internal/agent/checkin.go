package agent

import (
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/collect"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/commands"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/hub"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/version"
)

type CheckInResult struct {
	Accepted int
	Refused  int
}

func toHubResults(rows []config.CommandResult) []hub.CommandResult {
	out := make([]hub.CommandResult, 0, len(rows))
	for _, row := range rows {
		out = append(out, hub.CommandResult{ID: row.ID, Status: row.Status, Detail: row.Detail})
	}
	return out
}

func fromCommandResults(rows []commands.Result) []config.CommandResult {
	out := make([]config.CommandResult, 0, len(rows))
	for _, row := range rows {
		out = append(out, config.CommandResult{ID: row.ID, Status: row.Status, Detail: row.Detail})
	}
	return out
}

func CheckIn(state *config.State) (CheckInResult, error) {
	if state == nil {
		loaded, _, err := config.Load()
		if err != nil {
			return CheckInResult{}, err
		}
		state = loaded
	}
	host := collect.Host()
	vpn := collect.CollectVPN(state.TunnelName, state.VpnIPv4)
	services := collect.CollectServices(host.OSFamily)
	metrics := collect.CollectMetrics(state.TunnelName)
	packages := collect.CollectPackages()

	client := hub.New(state.BaseURL)
	response, err := client.CheckIn(hub.CheckInRequest{
		DeviceID:       state.DeviceID,
		CheckInSecret:  state.CheckInSecret,
		AgentVersion:   version.Version,
		Hostname:       state.Hostname,
		OSFamily:       host.OSFamily,
		OSVersion:      host.OSVersion,
		VPN:            vpn,
		Services:       services,
		Metrics:        metrics,
		Packages:       packages,
		CommandResults: toHubResults(state.PendingCommandResults),
	})
	if err != nil {
		return CheckInResult{}, err
	}

	accepted, refused := commands.ResolveAll(response.Commands)
	results := append([]commands.Result{}, refused...)
	var later []commands.Command
	rt := commands.DefaultRuntime()
	for _, command := range accepted {
		if command.Kind == "reboot" || command.Kind == "restart" {
			later = append(later, command)
			results = append(results, commands.Result{ID: command.ID, Status: "succeeded"})
			continue
		}
		results = append(results, commands.Execute(command, rt))
	}

	next := *state
	next.PendingCommandResults = fromCommandResults(results)
	if _, err := config.Save(next); err != nil {
		return CheckInResult{}, err
	}

	for _, command := range later {
		_ = commands.Execute(command, rt)
	}

	return CheckInResult{Accepted: len(accepted), Refused: len(refused)}, nil
}
