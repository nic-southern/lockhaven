import "dart:io";

import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/labels/printer_store.dart";
import "package:lockhaven_field/labels/usb_printer_catalog.dart";
import "package:lockhaven_field/labels/usb_printers.dart";
import "package:lockhaven_field/screens/settings_screen.dart";

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
    expect(
      withSelectedPrinter({"PTOUCH_SERIAL": "old"}, null)["PTOUCH_SERIAL"],
      isNull,
    );
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

  testWidgets("Settings lists devices and persists a compatible printer", (
    tester,
  ) async {
    final storeFile = File("${Directory.systemTemp.path}/lh-printer-test.json");
    if (await storeFile.exists()) await storeFile.delete();
    final store = PrinterStore(fileOverride: storeFile);
    final catalog = _FakeCatalog(
      const PrinterScanResult(
        usbPrintSupported: true,
        devices: [
          UsbDeviceRow(
            id: "hub",
            title: "USB hub",
            subtitle: "Port 1 · 2",
            tapeCompatible: false,
          ),
          UsbDeviceRow(
            id: "serial:E75J012345",
            title: "PT-D460BT",
            subtitle: "Printer E75J012345",
            tapeCompatible: true,
            usbSerial: "E75J012345",
            model: "PT-D460BT",
          ),
        ],
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: SettingsScreen(
          config: const FieldConfig(hubBaseUrl: "http://127.0.0.1:3000"),
          store: store,
          catalog: catalog,
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text("Settings"), findsOneWidget);
    expect(find.text("Label printer"), findsOneWidget);
    expect(find.text("PT-D460BT"), findsOneWidget);
    expect(find.textContaining("USB hub"), findsOneWidget);

    await tester.tap(find.text("PT-D460BT"));
    await tester.pump();
    await tester.pump();

    final saved = await store.read();
    expect(saved?.usbSerial, "E75J012345");
    expect(find.textContaining("Selected"), findsWidgets);
  });
}

class _FakeCatalog extends UsbPrinterCatalog {
  _FakeCatalog(this.fixed)
    : super(
        config: const FieldConfig(hubBaseUrl: "http://127.0.0.1:3000"),
        isWindows: false,
      );

  final PrinterScanResult fixed;

  @override
  Future<PrinterScanResult> scan() async => fixed;
}
