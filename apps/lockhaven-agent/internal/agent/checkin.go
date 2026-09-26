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

// titlesPayload keeps the `titles` key out of the request when no watch list
// exists. A typed-nil *collect.Titles stored in an `any` field is not empty
// to encoding/json, so it would otherwise serialize as `"titles": null`.
func titlesPayload(titles *collect.Titles) any {
	if titles == nil {
		return nil
	}
	return titles
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
	titles := collect.CollectTitles()
	moduleReports := collect.CollectModules(state.AssignedModules)

	client := hub.New(state.BaseURL)
	response, err := client.CheckIn(hub.CheckInRequest{
		DeviceID:       state.DeviceID,
		CheckInSecret:  state.CheckInSecret,
		AgentVersion:   version.Version,
		Hostname:       state.Hostname,
		OSFamily:       host.OSFamily,
		OSVersion:      host.OSVersion,
		Architecture:   host.Architecture,
		Manufacturer:   host.Manufacturer,
		Model:          host.Model,
		VPN:            vpn,
		Services:       services,
		Metrics:        metrics,
		Packages:       packages,
		Titles:         titlesPayload(titles),
		Modules:        moduleReports,
		CommandResults: toHubResults(state.PendingCommandResults),
	})
	if err != nil {
		return CheckInResult{}, err
	}

	accepted, refused := commands.ResolveAll(response.Commands)
	results := append([]commands.Result{}, refused...)
	var later []commands.Command
	rt := commands.DefaultRuntime()
	rt.Update = &commands.UpdateOffer{
		BaseURL:      state.BaseURL,
		DownloadURL:  response.DownloadURL,
		SHA256:       response.SHA256,
		DeferRestart: true,
	}
	rt.Services = servicesFromHub(response.AssignedServices)
	restartAfterUpdate := false
	for _, command := range accepted {
		if command.Kind == "reboot" || command.Kind == "restart" || commands.DeferOwnServiceRestart(command, rt) {
			later = append(later, command)
			results = append(results, commands.Result{ID: command.ID, Status: "succeeded"})
			continue
		}
		result := commands.Execute(command, rt)
		results = append(results, result)
		if command.Kind == "update" && result.Status == "succeeded" {
			restartAfterUpdate = true
		}
	}

	next := *state
	next.PendingCommandResults = fromCommandResults(results)
	next.AssignedModules = assignedModulesFromHub(response.Modules)
	if _, err := config.Save(next); err != nil {
		return CheckInResult{}, err
	}

	if restartAfterUpdate {
		spec := commands.RestartSpec(rt.GOOS)
		_ = rt.SpawnDetached(spec.File, spec.Args)
	}
	for _, command := range later {
		_ = commands.Execute(command, rt)
	}

	return CheckInResult{Accepted: len(accepted), Refused: len(refused)}, nil
}

func servicesFromHub(rows []hub.AssignedService) []commands.ServiceAllow {
	out := make([]commands.ServiceAllow, 0, len(rows))
	for _, row := range rows {
		if row.Name == "" || row.Target == "" {
			continue
		}
		out = append(out, commands.ServiceAllow{Name: row.Name, Target: row.Target})
	}
	return out
}

func assignedModulesFromHub(rows []hub.ModuleDefinition) []config.AssignedModule {
	out := make([]config.AssignedModule, 0, len(rows))
	for _, row := range rows {
		if row.ID == "" || row.Kind != "observations" {
			continue
		}
		module := config.AssignedModule{
			ID:   row.ID,
			Kind: row.Kind,
			Name: row.Name,
		}
		for _, collector := range row.Collectors {
			module.Collectors = append(module.Collectors, config.AssignedCollector{
				ID:      collector.ID,
				Type:    collector.Type,
				Process: collector.Process,
				Path:    collector.Path,
			})
		}
		if len(module.Collectors) == 0 {
			continue
		}
		out = append(out, module)
	}
	return out
}
