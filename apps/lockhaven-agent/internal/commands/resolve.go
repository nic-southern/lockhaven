package commands

import "encoding/json"

var allowedKinds = map[string]struct{}{
	"reboot":  {},
	"restart": {},
	"update":  {},
}

func Resolve(input any) (Command, Result, bool) {
	raw, err := json.Marshal(input)
	if err != nil {
		return Command{}, Result{ID: "00000000-0000-0000-0000-000000000000", Status: "refused", Detail: "This command was not recognized."}, false
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return Command{}, Result{ID: "00000000-0000-0000-0000-000000000000", Status: "refused", Detail: "This command was not recognized."}, false
	}
	id, _ := obj["id"].(string)
	if id == "" {
		id = "00000000-0000-0000-0000-000000000000"
	}
	if len(obj) != 2 {
		return Command{}, Result{ID: id, Status: "refused", Detail: "This command included unsupported fields."}, false
	}
	kind, _ := obj["kind"].(string)
	if _, ok := allowedKinds[kind]; !ok {
		return Command{}, Result{ID: id, Status: "refused", Detail: "This command is not allowed."}, false
	}
	if _, hasID := obj["id"]; !hasID {
		return Command{}, Result{ID: id, Status: "refused", Detail: "This command was not recognized."}, false
	}
	return Command{ID: id, Kind: kind}, Result{}, true
}

func ResolveAll(inputs []any) (accepted []Command, refused []Result) {
	for _, input := range inputs {
		command, result, ok := Resolve(input)
		if ok {
			accepted = append(accepted, command)
		} else {
			refused = append(refused, result)
		}
	}
	return accepted, refused
}
