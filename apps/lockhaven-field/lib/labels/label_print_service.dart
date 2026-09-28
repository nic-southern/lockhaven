import "dart:io";

import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/labels/label_payload.dart";
import "package:lockhaven_field/labels/label_renderer.dart";
import "package:path_provider/path_provider.dart";

enum LabelPrintPath {
  /// Dart-rendered PNG sent to `ptouch-print --image`.
  ptouch,
}

class LabelPrintResult {
  const LabelPrintResult({
    required this.path,
    required this.pngPath,
    this.message,
  });

  final LabelPrintPath path;
  final String pngPath;
  final String? message;
}

class LabelPrintException implements Exception {
  LabelPrintException(this.message, {this.detail});

  final String message;
  final String? detail;

  @override
  String toString() => detail == null || detail!.isEmpty
      ? message
      : "$message\n$detail";
}

/// Renders the label in-process and prints with `ptouch-print` over USB.
///
/// No Python / pillow / qrcode required. Brother mobile SDKs are not used
/// (Android/iOS only).
class LabelPrintService {
  LabelPrintService({
    required this.config,
    this.ptouchOverride,
  });

  final FieldConfig config;

  /// Injected for tests.
  final String? ptouchOverride;

  Future<LabelPrintResult> printAssetLabel({
    required AssetSummary asset,
    String? companyName,
    String? siteName,
  }) async {
    final tag = asset.tag.trim();
    if (tag.isEmpty) {
      throw LabelPrintException("Tracking tag is required to print a label.");
    }

    final pngBytes = renderAssetLabelPng(
      tag: tag,
      serial: asset.serial,
      companyName: companyName ?? asset.organizationName,
      qrText: assetLabelQrPayload(tag: tag, serial: asset.serial),
    );

    final dir = await getTemporaryDirectory();
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final safe = tag.replaceAll(RegExp(r"[^A-Za-z0-9._-]"), "_");
    final pngFile = File("${dir.path}/lockhaven-label-$stamp-$safe.png");
    await pngFile.writeAsBytes(pngBytes, flush: true);

    final ptouch = ptouchOverride ?? await resolvePtouchPrint(config);
    if (ptouch == null) {
      throw LabelPrintException(
        "ptouch-print not found.",
        detail:
            "Install ptouch-print and ensure it is on PATH "
            "(often ~/.local/bin). Or pass "
            "--dart-define=PTOUCH_PRINT=/path/to/ptouch-print.",
      );
    }

    final result = await Process.run(
      ptouch,
      ["--timeout=30", "--image", pngFile.path],
      runInShell: false,
      environment: printHelperEnvironment(Platform.environment),
    );

    if (result.exitCode == 0) {
      await _rememberPtouch(ptouch);
      return LabelPrintResult(
        path: LabelPrintPath.ptouch,
        pngPath: pngFile.path,
        message: "Sent to the label printer.",
      );
    }

    throw LabelPrintException(
      _humanizePtouchFailure(result),
      detail: _processDetail(result, tool: ptouch),
    );
  }

  static Future<String?> resolvePtouchPrint(FieldConfig config) async {
    final configured = config.ptouchPrintPath?.trim();
    if (configured != null && configured.isNotEmpty) {
      if (await File(configured).exists()) {
        return File(configured).absolute.path;
      }
    }

    final remembered = await _readRememberedPtouch();
    if (remembered != null && await File(remembered).exists()) {
      return File(remembered).absolute.path;
    }

    for (final candidate in ptouchSearchCandidates(
      home: Platform.environment["HOME"],
    )) {
      if (await File(candidate).exists()) {
        return File(candidate).absolute.path;
      }
    }

    try {
      final which = await Process.run(
        "which",
        ["ptouch-print"],
        environment: printHelperEnvironment(Platform.environment),
      );
      if (which.exitCode == 0) {
        final path = (which.stdout as String).trim();
        if (path.isNotEmpty && await File(path).exists()) return path;
      }
    } catch (_) {
      // Ignore.
    }
    return null;
  }

  static Future<String?> _readRememberedPtouch() async {
    try {
      final dir = await getApplicationSupportDirectory();
      final file = File("${dir.path}/ptouch_print.path");
      if (!await file.exists()) return null;
      final path = (await file.readAsString()).trim();
      return path.isEmpty ? null : path;
    } catch (_) {
      return null;
    }
  }

  static Future<void> _rememberPtouch(String path) async {
    try {
      final dir = await getApplicationSupportDirectory();
      final file = File("${dir.path}/ptouch_print.path");
      await file.parent.create(recursive: true);
      await file.writeAsString(path);
    } catch (_) {
      // Non-fatal.
    }
  }
}

String _humanizePtouchFailure(ProcessResult result) {
  final blob = "${result.stderr}\n${result.stdout}".toLowerCase();
  if (blob.contains("no printer") ||
      blob.contains("device not found") ||
      blob.contains("could not find") ||
      blob.contains("unable to find") ||
      blob.contains("access denied") ||
      blob.contains("permission denied") ||
      blob.contains("libusb")) {
    return "Printer not found. Turn it on and plug in the USB cable.";
  }
  if (blob.contains("timeout") || blob.contains("status")) {
    return "Printer did not respond in time. Wait a moment and try again.";
  }
  return "Could not print the label.";
}

String _processDetail(ProcessResult result, {required String tool}) {
  final stderr = (result.stderr as String).trim();
  final stdout = (result.stdout as String).trim();
  return [
    if (stderr.isNotEmpty) stderr,
    if (stdout.isNotEmpty) stdout,
    "Tool: $tool",
    "Exit ${result.exitCode}",
  ].join("\n");
}

/// Ensure `~/.local/bin` is on PATH for spawned tools.
Map<String, String> printHelperEnvironment(Map<String, String> base) {
  final env = Map<String, String>.from(base);
  final home = env["HOME"]?.trim();
  final extras = <String>[
    if (home != null && home.isNotEmpty) "$home/.local/bin",
    if (home != null && home.isNotEmpty) "$home/bin",
    "/usr/local/bin",
  ];
  final existing = env["PATH"] ?? "";
  final parts = <String>[
    ...extras.where((p) => p.isNotEmpty),
    ...existing.split(":").where((p) => p.isNotEmpty),
  ];
  final seen = <String>{};
  env["PATH"] = parts.where((p) => seen.add(p)).join(":");
  return env;
}

List<String> ptouchSearchCandidates({String? home}) {
  final out = <String>[];
  if (home != null && home.isNotEmpty) {
    out.add("$home/.local/bin/ptouch-print");
    out.add("$home/bin/ptouch-print");
  }
  out.add("/usr/local/bin/ptouch-print");
  out.add("/usr/bin/ptouch-print");
  return out;
}
