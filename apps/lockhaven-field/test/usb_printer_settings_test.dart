import "dart:io";

import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/labels/printer_store.dart";
import "package:lockhaven_field/labels/usb_printer_catalog.dart";
import "package:lockhaven_field/labels/usb_printers.dart";

void main() {
  test("parseListConnected reads model and USB serial", () {
    const blob = "PT-D460BT\tserial E75J012345\t(USB bus 1, device 8)\n";
    final rows = parseListConnected(blob);
    expect(rows, hasLength(1));
    expect(rows.first.model, "PT-D460BT");
    expect(rows.first.usbSerial, "E75J012345");
    expect(rows.first.tapeCompatible, isTrue);
    expect(rows.first.canPassSerial, isTrue);
  });

  test("parseLsusb highlights tape vendor 04f9", () {
    const blob = """
Bus 001 Device 005: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 001 Device 008: ID 04f9:20e0 Brother Industries, Ltd PT-D460BT
""";
    final rows = parseLsusb(blob);
    expect(rows, hasLength(2));
    expect(rows[0].tapeCompatible, isFalse);
    expect(rows[1].tapeCompatible, isTrue);
    expect(rows[1].vendorId, "04f9");
    expect(rows[1].productId, "20e0");
  });

  test("parseInfoPrinters reads --info open line", () {
    const blob =
        "PT-D460BT found on USB bus 1, device 8, serial E75J012345\n"
        "maximum printing width for this tape is 120px\n";
    final rows = parseInfoPrinters(blob);
    expect(rows.single.usbSerial, "E75J012345");
    expect(rows.single.title, "PT-D460BT");
  });

  test("parseSystemProfilerUsb reads Product/Vendor/Serial blocks", () {
    const blob = """
USB:

    USB 3.1 Bus:

          Host Controller Driver: AppleUSBXHCITR

            PT-D460BT:

              Product ID: 0x20e0
              Vendor ID: 0x04f9  (Brother Industries, Ltd)
              Version: 1.00
              Serial Number: E75J012345
              Speed: Up to 12 Mb/s

            USB 2.0 Hub:

              Product ID: 0x3431
              Vendor ID: 0x2109
""";
    final rows = parseSystemProfilerUsb(blob);
    expect(rows.length, greaterThanOrEqualTo(1));
    final printer = rows.firstWhere((r) => r.tapeCompatible);
    expect(printer.title, "PT-D460BT");
    expect(printer.usbSerial, "E75J012345");
    expect(printer.vendorId, "04f9");
    expect(printer.productId, "20e0");
  });

  test("mergeUsbInventory sorts compatible printers first", () {
    final merged = mergeUsbInventory(
      peripherals: parseLsusb(
        "Bus 001 Device 005: ID 1d6b:0002 Linux Foundation 2.0 root hub\n"
        "Bus 001 Device 008: ID 04f9:20e0 Brother Industries, Ltd PT-D460BT\n",
      ),
      printers: parseListConnected(
        "PT-D460BT\tserial E75J012345\t(USB bus 1, device 8)\n",
      ),
    );
    expect(merged.first.tapeCompatible, isTrue);
    expect(merged.first.usbSerial, "E75J012345");
    expect(merged.first.id, "serial:E75J012345");
  });

  test("withSelectedPrinter sets PTOUCH_SERIAL for ptouch-print --serial", () {
    final env = withSelectedPrinter(
      {"PATH": "/usr/bin"},
      const PrinterSelection(id: "serial:E75J012345", usbSerial: "E75J012345"),
    );
    expect(env["PTOUCH_SERIAL"], "E75J012345");
    expect(env["PTOUCH_PRINT"], isNull);
    expect(
      withSelectedPrinter({"PTOUCH_SERIAL": "old"}, null)["PTOUCH_SERIAL"],
      isNull,
    );
  });

  test("withSelectedPrinter passes the same ptouch-print binary Settings used", () {
    final env = withSelectedPrinter(
      {"PATH": "/usr/bin", "PTOUCH_PRINT": "/broken/ptouch-print"},
      const PrinterSelection(id: "serial:E75J012345", usbSerial: "E75J012345"),
      ptouchPrint: "/opt/homebrew/bin/ptouch-print",
    );
    expect(env["PTOUCH_SERIAL"], "E75J012345");
    expect(env["PTOUCH_PRINT"], "/opt/homebrew/bin/ptouch-print");
  });

  test("catalog Windows build is honest about USB print", () async {
    final catalog = UsbPrinterCatalog(
      config: const FieldConfig(hubBaseUrl: "http://127.0.0.1:3000"),
      isWindows: true,
      runner: (exe, args, {environment}) async {
        fail("should not probe printers on Windows");
      },
    );
    final result = await catalog.scan();
    expect(result.usbPrintSupported, isFalse);
    expect(result.message, "USB print is not available on this build.");
    expect(result.devices, isEmpty);
  });

  test("catalog lists with the ptouch-print binary that starts", () async {
    const tool = "/opt/homebrew/bin/ptouch-print";
    final calls = <String>[];
    final catalog = UsbPrinterCatalog(
      config: const FieldConfig(hubBaseUrl: "http://127.0.0.1:3000"),
      isWindows: false,
      lookOnDisk: false,
      runner: (exe, args, {environment}) async {
        calls.add("$exe ${args.join(" ")}");
        if (exe == "which") {
          return ProcessResult(1, 0, tool, "");
        }
        if (exe == tool && args.contains("--help")) {
          return ProcessResult(1, 0, "--list-connected --serial\n", "");
        }
        if (exe == tool && args.contains("--list-connected")) {
          return ProcessResult(
            1,
            0,
            "PT-D460BT\tserial E75J012345\t(USB bus 1, device 8)\n",
            "",
          );
        }
        if (exe == tool && args.contains("--info")) {
          return ProcessResult(
            1,
            0,
            "maximum printing width for this tape is 120px\n",
            "",
          );
        }
        return ProcessResult(1, 127, "", "");
      },
    );
    final result = await catalog.scan();
    expect(
      result.devices.any((row) => row.usbSerial == "E75J012345"),
      isTrue,
    );
    expect(
      calls.where((call) => call.contains("--list-connected")).single,
      "$tool --list-connected",
    );
  });

  test("catalog helper-missing uses product-neutral copy", () async {
    final catalog = UsbPrinterCatalog(
      config: const FieldConfig(hubBaseUrl: "http://127.0.0.1:3000"),
      isWindows: false,
      lookOnDisk: false,
      runner: (exe, args, {environment}) async {
        if (exe == "lsusb") {
          return ProcessResult(
            1,
            0,
            "Bus 001 Device 008: ID 04f9:20e0 PT-D460BT\n",
            "",
          );
        }
        return ProcessResult(1, 127, "", "not found");
      },
    );
    final result = await catalog.scan();
    expect(result.helperMissing, isTrue);
    expect(result.message, contains("Tape printer tools are missing"));
    expect(result.devices.where((d) => d.tapeCompatible), isNotEmpty);
  });

  test("PrinterStore persists USB serial for the print path", () async {
    final storeFile = File(
      "${Directory.systemTemp.path}/lh-printer-test-${DateTime.now().microsecondsSinceEpoch}.json",
    );
    addTearDown(() {
      if (storeFile.existsSync()) storeFile.deleteSync();
    });
    final store = PrinterStore(fileOverride: storeFile);
    const selection = PrinterSelection(
      id: "serial:E75J012345",
      usbSerial: "E75J012345",
      model: "PT-D460BT",
      title: "PT-D460BT",
    );
    await store.write(selection);
    final saved = await store.read();
    expect(saved?.usbSerial, "E75J012345");
    expect(
      withSelectedPrinter({"PATH": "/usr/bin"}, saved)["PTOUCH_SERIAL"],
      "E75J012345",
    );
  });
}
