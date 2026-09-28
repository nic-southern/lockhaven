import "dart:io";

import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/labels/label_payload.dart";
import "package:path_provider/path_provider.dart";

enum LabelPrintPath {
  /// Local `print-asset-labels.sh` + `ptouch-print` succeeded.
  helper,
}

class LabelPrintResult {
  const LabelPrintResult({
    required this.path,
    required this.csvPath,
    this.message,
  });

  final LabelPrintPath path;
  final String csvPath;
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

/// Prints via the laptop helper (`scripts/print-asset-labels.sh` →
/// `ptouch-print`). Linux USB path for PT-D460BT — not Brother's mobile SDK.
class LabelPrintService {
  LabelPrintService({
    required this.config,
    this.scriptOverride,
  });

  final FieldConfig config;

  /// Injected for tests.
  final String? scriptOverride;

  Future<LabelPrintResult> printAssetLabel({
    required AssetSummary asset,
    String? companyName,
    String? siteName,
  }) async {
    final row = AssetLabelCsvRow.build(
      tag: asset.tag,
      serial: asset.serial,
      companyName: companyName ?? asset.organizationName,
      siteName: siteName ?? asset.siteName,
    );
    if (row == null) {
      throw LabelPrintException("Tracking tag is required to print a label.");
    }

    final dir = await getTemporaryDirectory();
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final csvFile = File("${dir.path}/lockhaven-label-$stamp.csv");
    await csvFile.writeAsString(formatAssetLabelCsv([row]));

    final script = scriptOverride ?? await resolvePrintScript(config);
    if (script == null) {
      throw LabelPrintException(
        "Label helper not found.",
        detail:
            "Install/run from the Lockhaven repo so "
            "scripts/print-asset-labels.sh is reachable, or pass "
            "--dart-define=LABEL_PRINT_SCRIPT=/absolute/path/to/"
            "print-asset-labels.sh. Requires ptouch-print on PATH "
            "(often ~/.local/bin).",
      );
    }

    final result = await Process.run(
      script,
      [csvFile.path],
      runInShell: false,
      environment: printHelperEnvironment(Platform.environment),
    );

    if (result.exitCode == 0) {
      await _rememberScript(script);
      return LabelPrintResult(
        path: LabelPrintPath.helper,
        csvPath: csvFile.path,
        message: "Sent to the label printer.",
      );
    }

    final stderr = (result.stderr as String).trim();
    final stdout = (result.stdout as String).trim();
    final detail = [
      if (stderr.isNotEmpty) stderr,
      if (stdout.isNotEmpty) stdout,
      "Helper: $script",
      "Exit ${result.exitCode}",
    ].join("\n");

    throw LabelPrintException(
      "Label helper failed. Is the printer on and plugged in over USB?",
      detail: detail,
    );
  }

  /// Prefer configured path, remembered path, then walk common locations.
  static Future<String?> resolvePrintScript(FieldConfig config) async {
    final configured = config.labelPrintScript?.trim();
    if (configured != null && configured.isNotEmpty) {
      if (await File(configured).exists()) return File(configured).absolute.path;
    }

    final remembered = await _readRememberedScript();
    if (remembered != null && await File(remembered).exists()) {
      return File(remembered).absolute.path;
    }

    for (final candidate in scriptSearchCandidates(
      cwd: Directory.current.path,
      home: Platform.environment["HOME"],
      executable: Platform.resolvedExecutable,
    )) {
      final file = File(candidate);
      if (await file.exists()) return file.absolute.path;
    }

    try {
      final which = await Process.run(
        "which",
        ["print-asset-labels.sh"],
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

  static Future<String?> _readRememberedScript() async {
    try {
      final dir = await getApplicationSupportDirectory();
      final file = File("${dir.path}/label_print_script.path");
      if (!await file.exists()) return null;
      final path = (await file.readAsString()).trim();
      return path.isEmpty ? null : path;
    } catch (_) {
      return null;
    }
  }

  static Future<void> _rememberScript(String path) async {
    try {
      final dir = await getApplicationSupportDirectory();
      final file = File("${dir.path}/label_print_script.path");
      await file.parent.create(recursive: true);
      await file.writeAsString(path);
    } catch (_) {
      // Non-fatal.
    }
  }
}

/// Ensure `~/.local/bin` (and similar) are on PATH for spawned helpers.
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
  // Dedupe preserving order.
  final seen = <String>{};
  env["PATH"] = parts.where((p) => seen.add(p)).join(":");
  return env;
}

/// Ordered candidate paths for `print-asset-labels.sh`.
List<String> scriptSearchCandidates({
  required String cwd,
  String? home,
  String? executable,
}) {
  final out = <String>[];
  void add(String path) {
    if (path.isNotEmpty) out.add(path);
  }

  // Relative to process cwd (flutter run from apps/lockhaven-field).
  add("$cwd/scripts/print-asset-labels.sh");
  add("$cwd/../scripts/print-asset-labels.sh");
  add("$cwd/../../scripts/print-asset-labels.sh");
  add("$cwd/../../../scripts/print-asset-labels.sh");

  // Walk up from cwd looking for a monorepo root.
  var dir = Directory(cwd).absolute;
  for (var i = 0; i < 8; i += 1) {
    add("${dir.path}/scripts/print-asset-labels.sh");
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }

  // Walk up from the Flutter binary (release bundle).
  if (executable != null && executable.isNotEmpty) {
    var exeDir = File(executable).absolute.parent;
    for (var i = 0; i < 10; i += 1) {
      add("${exeDir.path}/scripts/print-asset-labels.sh");
      final parent = exeDir.parent;
      if (parent.path == exeDir.path) break;
      exeDir = parent;
    }
  }

  if (home != null && home.isNotEmpty) {
    add("$home/.local/bin/print-asset-labels.sh");
    add("$home/bin/print-asset-labels.sh");
    add("$home/lockhaven/scripts/print-asset-labels.sh");
    add("$home/src/lockhaven/scripts/print-asset-labels.sh");
  }

  final seen = <String>{};
  return out.where((p) => seen.add(p)).toList();
}
