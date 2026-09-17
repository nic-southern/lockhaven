package collect

import (
	"encoding/json"
	"testing"
)

func TestParseDfKp(t *testing.T) {
	disks := ParseDfKp(`Filesystem     1024-blocks    Used Available Capacity Mounted on
/dev/sda1           100000   40000     60000      40% /
tmpfs                16000       0     16000       0% /dev/shm
/dev/sdb1           200000   50000    150000      25% /var
`)
	if len(disks) != 2 {
		t.Fatalf("got %d disks", len(disks))
	}
	if disks[0].Mount != "/" || disks[0].TotalBytes != 100000*1024 {
		t.Fatalf("root disk: %+v", disks[0])
	}
	if disks[1].Mount != "/var" {
		t.Fatalf("var mount: %s", disks[1].Mount)
	}
}

func TestParseProcNetDev(t *testing.T) {
	ifaces := ParseProcNetDev(`Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 100 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0
  eth0: 1234 10 0 0 0 0 0 0 5678 20 0 0 0 0 0 0
`)
	if len(ifaces) != 1 {
		t.Fatalf("got %d ifaces", len(ifaces))
	}
	if ifaces[0].Name != "eth0" || ifaces[0].RxBytes != 1234 || ifaces[0].TxBytes != 5678 {
		t.Fatalf("iface: %+v", ifaces[0])
	}
}

func TestParseProcMeminfo(t *testing.T) {
	memory := ParseProcMeminfo(`MemTotal:        8000 kB
MemFree:         1000 kB
MemAvailable:    3000 kB
`)
	if memory.TotalBytes != 8000*1024 || memory.AvailableBytes != 3000*1024 || memory.UsedBytes != 5000*1024 {
		t.Fatalf("memory: %+v", memory)
	}
}

func TestParseDpkgAndApt(t *testing.T) {
	pkgs := ParseDpkgQuery("curl\t8.0.0\nbash\t5.2\n", "apt")
	if len(pkgs) != 2 || pkgs[0].Name != "curl" {
		t.Fatalf("dpkg: %+v", pkgs)
	}
	updates := ParseAptUpgradable("curl/stable 8.1.0 amd64 [upgradable from: 8.0.0]\nWARNING: apt does not have a stable CLI interface.\n")
	if len(updates) != 1 || updates[0].AvailableVersion != "8.1.0" || updates[0].CurrentVersion != "8.0.0" {
		t.Fatalf("apt: %+v", updates)
	}
}

func TestParseAptUpgradableNoneMarshalsAsEmptyArray(t *testing.T) {
	updates := ParseAptUpgradable("Listing...\nWARNING: apt does not have a stable CLI interface.\n")
	if updates == nil {
		t.Fatal("nil slice encodes as JSON null and Hub rejects check-in")
	}
	if len(updates) != 0 {
		t.Fatalf("len %d", len(updates))
	}
	raw, err := json.Marshal(Packages{
		Installed:        []Pkg{},
		AvailableUpdates: updates,
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"reboot_required":false,"installed":[],"available_updates":[]}` {
		t.Fatalf("json %s", raw)
	}
}

func TestParseListeningPorts(t *testing.T) {
	ports := ParseListeningPorts(`State  Recv-Q Send-Q Local Address:Port  Peer Address:Port
LISTEN 0      128          0.0.0.0:22         0.0.0.0:*
LISTEN 0      5            0.0.0.0:5900       0.0.0.0:*
`)
	if _, ok := ports[22]; !ok {
		t.Fatal("missing 22")
	}
	if _, ok := ports[5900]; !ok {
		t.Fatal("missing 5900")
	}
	if _, ok := ports[3389]; ok {
		t.Fatal("unexpected 3389")
	}
}

func TestParseWindowsNetstatListeningPorts(t *testing.T) {
	ports := ParseListeningPorts(`
  TCP    0.0.0.0:3389           0.0.0.0:0              LISTENING
  TCP    [::]:5986            [::]:0                 LISTENING
`)
	if _, ok := ports[3389]; !ok {
		t.Fatal("missing 3389")
	}
	if _, ok := ports[5986]; !ok {
		t.Fatal("missing 5986")
	}
}

func TestServiceQueryRunning(t *testing.T) {
	if !ServiceQueryRunning("STATE              : 4  RUNNING") {
		t.Fatal("expected running")
	}
	if ServiceQueryRunning("STATE              : 1  STOPPED") {
		t.Fatal("stopped is not running")
	}
}
