import "dart:io";

import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/labels/label_payload.dart";
import "package:path_provider/path_provider.dart";

enum LabelPrintPath {
  /// CSV → `print-asset-labels.sh` (Python/Pillow layout) → `ptouch-print`.
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

/// Prints via the proven laptop helper (DejaVu text + QR), not Dart bitmaps.
///
/// The helper creates `scripts/.venv-labels` with pillow/qrcode on first run.
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
            "Use a Field download (helper is inside the app), run from a "
            "Lockhaven checkout, or pass "
            "--dart-define=LABEL_PRINT_SCRIPT=/path/to/"
            "print-asset-labels.sh. Needs the tape printer tool on PATH "
            "or inside the app (often ~/.local/bin).",
      );
    }

    final result = await Process.run(
      script,
      [csvFile.path],
      runInShell: false,
      environment: printHelperEnvironment(
        Platform.environment,
        extraBinDirs: [
          "${File(script).parent.path}/bin",
          File(script).parent.path,
        ],
      ),
    );

    if (result.exitCode == 0) {
      await _rememberScript(script);
      return LabelPrintResult(
        path: LabelPrintPath.helper,
        csvPath: csvFile.path,
        message: "Sent to the label printer.",
      );
    }

    throw LabelPrintException(
      _humanizeHelperFailure(result),
      detail: _processDetail(result, tool: script),
    );
  }

  static Future<String?> resolvePrintScript(FieldConfig config) async {
    final configured = config.labelPrintScript?.trim();
    if (configured != null && configured.isNotEmpty) {
      if (await File(configured).exists()) {
        return File(configured).absolute.path;
      }
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

String _humanizeHelperFailure(ProcessResult result) {
  final blob = "${result.stderr}\n${result.stdout}".toLowerCase();
  if (blob.contains("missing required command: ptouch-print") ||
      blob.contains("ptouch-print")) {
    if (blob.contains("no printer") ||
        blob.contains("device not found") ||
        blob.contains("libusb") ||
        blob.contains("permission denied") ||
        blob.contains("timeout")) {
      // fall through to more specific checks below
    } else if (blob.contains("missing required command")) {
      return "Tape printer tool not found. Install it once (install-ptouch-print.sh) or keep it on PATH (~/.local/bin).";
    }
  }
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
  if (blob.contains("pillow") || blob.contains("qrcode") || blob.contains("venv")) {
    return "Label helper could not prepare layout tools. Reinstall Field or see detail below.";
  }
  return "Label helper failed.";
}

String _processDetail(ProcessResult result, {required String tool}) {
  final stderr = (result.stderr as String).trim();
  final stdout = (result.stdout as String).trim();
  return [
    if (stderr.isNotEmpty) stderr,
    if (stdout.isNotEmpty) stdout,
    "Helper: $tool",
    "Exit ${result.exitCode}",
  ].join("\n");
}

/// Ensure label tools are on PATH for spawned helper + `ptouch-print`.
///
/// Covers bundled `label-tools/bin` inside the Field app, `~/.local/bin`
/// (install-ptouch-print.sh), Homebrew on Apple Silicon (`/opt/homebrew/bin`)
/// and Intel (`/usr/local/bin`), and `~/bin`.
Map<String, String> printHelperEnvironment(
  Map<String, String> base, {
  List<String> extraBinDirs = const [],
}) {
  final env = Map<String, String>.from(base);
  final home = env["HOME"]?.trim();
  final extras = <String>[
    ...extraBinDirs,
    if (home != null && home.isNotEmpty) "$home/.local/bin",
    if (home != null && home.isNotEmpty) "$home/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
  ];
  final existing = env["PATH"] ?? "";
  final parts = <String>[
    ...extras.where((p) => p.isNotEmpty),
    ...existing.split(Platform.isWindows ? ";" : ":").where((p) => p.isNotEmpty),
  ];
  final seen = <String>{};
  final sep = Platform.isWindows ? ";" : ":";
  env["PATH"] = parts.where((p) => seen.add(p)).join(sep);
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

  for (final path in bundledScriptCandidates(executable)) {
    add(path);
  }

  add(_posixJoin(cwd, "scripts/print-asset-labels.sh"));
  add(_posixJoin(_posixDirname(cwd), "scripts/print-asset-labels.sh"));
  add(
    _posixJoin(
      _posixDirname(_posixDirname(cwd)),
      "scripts/print-asset-labels.sh",
    ),
  );
  add(
    _posixJoin(
      _posixDirname(_posixDirname(_posixDirname(cwd))),
      "scripts/print-asset-labels.sh",
    ),
  );

  var dir = _posixNormalize(cwd);
  for (var i = 0; i < 8; i += 1) {
    add(_posixJoin(dir, "scripts/print-asset-labels.sh"));
    final parent = _posixDirname(dir);
    if (parent == dir) break;
    dir = parent;
  }

  if (executable != null && executable.isNotEmpty) {
    var exeDir = _posixDirname(executable);
    for (var i = 0; i < 10; i += 1) {
      add(_posixJoin(exeDir, "scripts/print-asset-labels.sh"));
      final parent = _posixDirname(exeDir);
      if (parent == exeDir) break;
      exeDir = parent;
    }
  }

  if (home != null && home.isNotEmpty) {
    add(_posixJoin(home, ".local/bin/print-asset-labels.sh"));
    add(_posixJoin(home, "bin/print-asset-labels.sh"));
    add(_posixJoin(home, "lockhaven/scripts/print-asset-labels.sh"));
    add(_posixJoin(home, "git/lockhaven/scripts/print-asset-labels.sh"));
    add(_posixJoin(home, "src/lockhaven/scripts/print-asset-labels.sh"));
    add(_posixJoin(home, "Developer/lockhaven/scripts/print-asset-labels.sh"));
    add(_posixJoin(home, "Projects/lockhaven/scripts/print-asset-labels.sh"));
    add(_posixJoin(home, "code/lockhaven/scripts/print-asset-labels.sh"));
  }

  final seen = <String>{};
  return out.where((p) => seen.add(p)).toList();
}

/// Helper next to a shipped Field binary (macOS .app Resources, Linux bundle).
///
/// Paths are walked as POSIX strings so Windows CI can still assert Mac/Linux
/// layouts without [File.absolute] prefixing the runner drive.
List<String> bundledScriptCandidates(String? executable) {
  if (executable == null || executable.isEmpty) return const [];
  final out = <String>[];
  var dir = _posixDirname(executable);

  if (_posixEndsWithSegment(dir, "MacOS")) {
    final contents = _posixDirname(dir);
    out.add(
      _posixJoin(contents, "Resources/label-tools/print-asset-labels.sh"),
    );
  }
  out.add(_posixJoin(dir, "label-tools/print-asset-labels.sh"));
  out.add(
    _posixJoin(dir, "Contents/Resources/label-tools/print-asset-labels.sh"),
  );

  for (var i = 0; i < 6; i += 1) {
    out.add(_posixJoin(dir, "label-tools/print-asset-labels.sh"));
    final parent = _posixDirname(dir);
    if (parent == dir) break;
    dir = parent;
  }
  final seen = <String>{};
  return out.where((p) => seen.add(p)).toList();
}

String _posixNormalize(String path) {
  var n = path.replaceAll(r"\", "/");
  if (n.length > 1 && n.endsWith("/")) {
    n = n.substring(0, n.length - 1);
  }
  return n;
}

String _posixDirname(String path) {
  final n = _posixNormalize(path);
  if (n.isEmpty || n == "/") return n;
  if (n.length == 2 && n[1] == ":") return n;
  if (n.length == 3 && n[1] == ":" && n[2] == "/") return n;
  final i = n.lastIndexOf("/");
  if (i <= 0) return "";
  if (i == 2 && n[1] == ":") return n.substring(0, 3);
  return n.substring(0, i);
}

String _posixJoin(String dir, String rel) {
  final a = _posixNormalize(dir);
  final b = rel.replaceAll(r"\", "/").replaceFirst(RegExp(r"^/+"), "");
  if (a.isEmpty) return b;
  if (a.endsWith("/")) return "$a$b";
  return "$a/$b";
}

bool _posixEndsWithSegment(String path, String segment) {
  final n = _posixNormalize(path);
  return n == segment || n.endsWith("/$segment");
}
