import "dart:io";

import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/labels/label_print_service.dart";
import "package:lockhaven_field/labels/usb_printers.dart";

typedef CommandRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments, {
  Map<String, String>? environment,
});

class PrinterScanResult {
  const PrinterScanResult({
    required this.usbPrintSupported,
    required this.devices,
    this.helperMissing = false,
    this.permissionDenied = false,
    this.tapeStatus,
    this.message,
  });

  final bool usbPrintSupported;
  final bool helperMissing;
  final bool permissionDenied;
  final List<UsbDeviceRow> devices;
  final String? tapeStatus;
  final String? message;
}

class UsbPrinterCatalog {
  UsbPrinterCatalog({
    required this.config,
    CommandRunner? runner,
    bool? isWindows,
    this.lookOnDisk = true,
  }) : runner = runner ?? _defaultRun,
       isWindows = isWindows ?? Platform.isWindows;

  final FieldConfig config;
  final CommandRunner runner;
  final bool isWindows;
  final bool lookOnDisk;

  static Future<ProcessResult> _defaultRun(
    String executable,
    List<String> arguments, {
    Map<String, String>? environment,
  }) {
    return Process.run(
      executable,
      arguments,
      environment: environment,
      runInShell: false,
    );
  }

  Future<PrinterScanResult> scan() async {
    if (isWindows) {
      return const PrinterScanResult(
        usbPrintSupported: false,
        devices: [],
        message: "USB print is not available on this build.",
      );
    }

    final script = await LabelPrintService.resolvePrintScript(config);
    final extraBins = <String>[
      if (script != null) "${File(script).parent.path}/bin",
      if (script != null) File(script).parent.path,
    ];
    final env = printHelperEnvironment(
      Platform.environment,
      extraBinDirs: extraBins,
    );

    final peripherals = await _listPeripherals(env);
    final ptouch = await _resolvePtouch(env);
    if (ptouch == null) {
      return PrinterScanResult(
        usbPrintSupported: true,
        helperMissing: true,
        devices: peripherals,
        message: "Tape printer tools are missing from this install.",
      );
    }

    final help = await _run(ptouch, const ["--help"], env);
    final helpBlob = _blob(help);
    final supportsListConnected = helpBlob.contains("list-connected");
    var permissionDenied = looksLikePermissionError(helpBlob);

    final printers = <UsbDeviceRow>[];
    if (supportsListConnected) {
      final listed = await _run(ptouch, const ["--list-connected"], env);
      printers.addAll(parseListConnected(_blob(listed)));
      permissionDenied =
          permissionDenied || looksLikePermissionError(_blob(listed));
    }
    if (printers.isEmpty) {
      final info = await _run(ptouch, const ["--info"], env);
      printers.addAll(parseInfoPrinters(_blob(info)));
      permissionDenied =
          permissionDenied || looksLikePermissionError(_blob(info));
    }

    String? tapeStatus;
    final info = await _run(ptouch, const ["--info"], env);
    tapeStatus = _tapeStatus(_blob(info));
    permissionDenied =
        permissionDenied || looksLikePermissionError(_blob(info));

    final devices = mergeUsbInventory(
      peripherals: peripherals,
      printers: printers,
    );

    String? message;
    if (permissionDenied && printers.isEmpty) {
      message = "Field could not access the printer. Allow access if this computer asks, then try again.";
    } else if (devices.where((d) => d.tapeCompatible).isEmpty) {
      message = "No printer found. Turn it on and connect the cable.";
    }

    return PrinterScanResult(
      usbPrintSupported: true,
      helperMissing: false,
      permissionDenied: permissionDenied,
      devices: devices,
      tapeStatus: tapeStatus,
      message: message,
    );
  }

  Future<List<UsbDeviceRow>> _listPeripherals(Map<String, String> env) async {
    final lsusb = await _run("lsusb", const [], env);
    if (lsusb.exitCode == 0) {
      final parsed = parseLsusb(_blob(lsusb));
      if (parsed.isNotEmpty) return parsed;
    }
    final profiler = await _run("system_profiler", const [
      "SPUSBDataType",
    ], env);
    if (profiler.exitCode == 0) {
      return parseSystemProfilerUsb(_blob(profiler));
    }
    return const [];
  }

  Future<String?> _resolvePtouch(Map<String, String> env) async {
    final which = await _run("which", const ["ptouch-print"], env);
    if (which.exitCode == 0) {
      final path = (which.stdout as String).trim();
      if (path.isNotEmpty) return path;
    }
    final home = env["HOME"];
    if (!lookOnDisk) return null;
    final candidates = <String>[
      if (home != null && home.isNotEmpty) "$home/.local/bin/ptouch-print",
      "/opt/homebrew/bin/ptouch-print",
      "/usr/local/bin/ptouch-print",
    ];
    for (final path in candidates) {
      if (await File(path).exists()) return path;
    }
    return null;
  }

  Future<ProcessResult> _run(
    String executable,
    List<String> arguments,
    Map<String, String> env,
  ) async {
    try {
      return await runner(executable, arguments, environment: env);
    } catch (error) {
      return ProcessResult(0, 127, "", error.toString());
    }
  }

  String _blob(ProcessResult result) {
    return "${result.stdout}\n${result.stderr}";
  }

  String? _tapeStatus(String blob) {
    final width = RegExp(
      r"maximum printing width for this tape is\s+(\d+)px",
      caseSensitive: false,
    ).firstMatch(blob);
    final media = RegExp(r"media width\s*=\s*(.+)").firstMatch(blob);
    if (width == null && media == null) return null;
    final parts = <String>[
      if (media != null) media.group(1)!.trim(),
      if (width != null) "${width.group(1)} px",
    ];
    return parts.join(" · ");
  }
}
