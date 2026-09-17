//go:build windows

package collect

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

func platformLoadavg() (float64, float64, float64) {
	return 0, 0, 0
}

func platformUptime() int64 {
	return int64(windows.DurationSinceBoot().Seconds())
}

type memoryStatusEx struct {
	length               uint32
	memoryLoad           uint32
	totalPhys            uint64
	availPhys            uint64
	totalPageFile        uint64
	availPageFile        uint64
	totalVirtual         uint64
	availVirtual         uint64
	availExtendedVirtual uint64
}

var procGlobalMemoryStatusEx = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")

func platformMemory() Memory {
	var status memoryStatusEx
	status.length = uint32(unsafe.Sizeof(status))
	r1, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&status)))
	if r1 == 0 {
		return Memory{}
	}
	total := int64(status.totalPhys)
	available := int64(status.availPhys)
	used := total - available
	if used < 0 {
		used = 0
	}
	return Memory{TotalBytes: total, AvailableBytes: available, UsedBytes: used}
}

func platformDisks() []Disk {
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return []Disk{}
	}
	var disks []Disk
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		root := fmt.Sprintf("%c:\\", 'A'+i)
		rootPtr, err := windows.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		if windows.GetDriveType(rootPtr) != windows.DRIVE_FIXED {
			continue
		}
		var freeBytesAvailable, totalBytes, totalFree uint64
		if err := windows.GetDiskFreeSpaceEx(rootPtr, &freeBytesAvailable, &totalBytes, &totalFree); err != nil {
			continue
		}
		used := int64(totalBytes - totalFree)
		if used < 0 {
			used = 0
		}
		disks = append(disks, Disk{
			Mount:          root,
			Filesystem:     "ntfs",
			TotalBytes:     int64(totalBytes),
			UsedBytes:      used,
			AvailableBytes: int64(totalFree),
		})
	}
	return disks
}

func platformNetwork() []NetworkIface {
	return []NetworkIface{}
}
