package main

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/agent"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/config"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/service"
	"github.com/nic-southern/lockhaven/apps/lockhaven-agent/internal/version"
)

const defaultInterval = time.Minute

func argValue(args []string, name string) string {
	for i, arg := range args {
		if arg == name && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func usage() {
	fmt.Printf(`Lockhaven agent %s

Usage:
  lockhaven-agent enroll --token <token> --base-url <url>
  lockhaven-agent attach --token <token> --base-url <url>
  lockhaven-agent install [--token <token> --base-url <url>]
  lockhaven-agent check-in
  lockhaven-agent run
  lockhaven-agent install-service
  lockhaven-agent uninstall-service
  lockhaven-agent version
`, version.Version)
}

func bindOpts(args []string) agent.BindOptions {
	token := argValue(args, "--token")
	if token == "" {
		token = os.Getenv("LOCKHAVEN_TOKEN")
	}
	baseURL := argValue(args, "--base-url")
	if baseURL == "" {
		baseURL = os.Getenv("LOCKHAVEN_BASE_URL")
	}
	tunnel := argValue(args, "--tunnel-name")
	if tunnel == "" {
		tunnel = os.Getenv("LOCKHAVEN_TUNNEL_NAME")
	}
	if tunnel == "" {
		tunnel = "lockhaven"
	}
	deviceID := argValue(args, "--device-id")
	if deviceID == "" {
		deviceID = os.Getenv("LOCKHAVEN_DEVICE_ID")
	}
	return agent.BindOptions{Token: token, BaseURL: baseURL, TunnelName: tunnel, DeviceID: deviceID}
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	command := ""
	if len(args) > 0 {
		command = args[0]
	}
	rest := []string{}
	if len(args) > 1 {
		rest = args[1:]
	}

	switch command {
	case "", "help", "--help":
		usage()
		return nil
	case "version", "--version":
		fmt.Println(version.Version)
		return nil
	case "enroll":
		opts := bindOpts(rest)
		if opts.Token == "" || opts.BaseURL == "" {
			return fmt.Errorf("enroll requires --token and --base-url.")
		}
		state, path, err := agent.Enroll(opts)
		if err != nil {
			return err
		}
		fmt.Printf("Enrolled device %s\nState: %s\n", state.DeviceID, path)
		return nil
	case "attach":
		opts := bindOpts(rest)
		if opts.Token == "" || opts.BaseURL == "" {
			return fmt.Errorf("attach requires --token and --base-url.")
		}
		state, path, err := agent.Attach(opts)
		if err != nil {
			return err
		}
		fmt.Printf("Attached device %s\nState: %s\n", state.DeviceID, path)
		return nil
	case "install":
		opts := bindOpts(rest)
		path, unit, err := agent.Install(opts)
		if err != nil {
			return err
		}
		fmt.Printf("Agent ready.\nState: %s\nService: %s\n", path, unit)
		return nil
	case "check-in":
		result, err := agent.CheckIn(nil)
		if err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("This device is not enrolled yet.")
			}
			return err
		}
		fmt.Printf("Check-in complete (%d commands, %d refused).\n", result.Accepted, result.Refused)
		return nil
	case "run":
		if _, _, err := config.Load(); err != nil {
			return fmt.Errorf("This device is not enrolled yet.")
		}
		interval := defaultInterval
		if raw := os.Getenv("LOCKHAVEN_CHECK_IN_INTERVAL_MS"); raw != "" {
			if ms, err := strconv.Atoi(raw); err == nil && ms >= 5000 {
				interval = time.Duration(ms) * time.Millisecond
			}
		}
		tick := func() {
			if _, err := agent.CheckIn(nil); err != nil {
				fmt.Fprintln(os.Stderr, err.Error())
			}
		}
		tick()
		for {
			time.Sleep(interval)
			tick()
		}
	case "install-service":
		path, err := service.Install()
		if err != nil {
			return err
		}
		fmt.Printf("Service installed (%s).\n", path)
		return nil
	case "uninstall-service":
		if err := service.Uninstall(); err != nil {
			return err
		}
		fmt.Println("Service removed.")
		return nil
	default:
		usage()
		os.Exit(1)
		return nil
	}
}
