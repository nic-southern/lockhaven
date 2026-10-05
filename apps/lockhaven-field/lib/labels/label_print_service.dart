import "dart:io";

import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/labels/label_payload.dart";
import "package:lockhaven_field/labels/printer_store.dart";
import "package:lockhaven_field/labels/usb_printers.dart";
import "package:path_provider/path_provider.dart";

typedef CommandRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments, {
  Map<String, String>? environment,
});

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
  String toString() =>
      detail == null || detail!.isEmpty ? message : "$message\n$detail";
}

/// Writes `lockhaven-label-<stamp>.csv` for the label helper.
///
/// [getTemporaryDirectory] is not created for us. On macOS that path is
/// `Library/Caches/<bundle id>`; on Linux the temp parent can be missing
/// too. [File.writeAsString] does not create it, so Print fails with
/// [PathNotFoundException] until the parent exists.
Future<File> writeAssetLabelCsvFile({
  required Directory directory,
  required String contents,
  required int stamp,
}) async {
  final csvFile = File("${directory.path}/lockhaven-label-$stamp.csv");
  await csvFile.parent.create(recursive: true);
  await csvFile.writeAsString(contents);
  return csvFile;
}

/// Prints via the proven laptop helper (DejaVu text + QR), not Dart bitmaps.
///
/// The helper creates `scripts/.venv-labels` with pillow/qrcode on first run.
class LabelPrintService {
  LabelPrintService({
    required this.config,
    this.scriptOverride,
    this.printerStore,
    this.runner,
  });

  final FieldConfig config;

  /// Injected for tests.
  final String? scriptOverride;
  final PrinterStore? printerStore;
  final CommandRunner? runner;

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
    final csvFile = await writeAssetLabelCsvFile(
      directory: dir,
      contents: formatAssetLabelCsv([row]),
      stamp: stamp,
    );

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

    final selection = await (printerStore ?? PrinterStore()).read();
    final baseEnv = printHelperEnvironment(
      Platform.environment,
      extraBinDirs: [
        "${File(script).parent.path}/bin",
        File(script).parent.path,
      ],
    );
    final ptouch = await resolvePtouchPrint(
      env: baseEnv,
      runner: runner ?? runCommand,
      scriptPath: script,
    );
    final env = withSelectedPrinter(baseEnv, selection, ptouchPrint: ptouch);
    final launch = labelPrintLaunch(script: script, csvPath: csvFile.path);
    final ProcessResult result;
    try {
      result = await (runner ?? runCommand)(
        launch.executable,
        launch.arguments,
        environment: env,
      );
    } catch (error) {
      throw LabelPrintException(formatPrintError(error));
    }

    if (result.exitCode == 0) {
      await _rememberScript(script);
      return LabelPrintResult(
        path: LabelPrintPath.helper,
        csvPath: csvFile.path,
        message: "Sent to the label printer.",
      );
    }

    throw LabelPrintException(labelHelperFailureText(result, tool: script));
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
      final which = await Process.run("which", [
        "print-asset-labels.sh",
      ], environment: printHelperEnvironment(Platform.environment));
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

/// Text shown when printing fails. Helper stderr/stdout is the message;
/// a generic sentence is only the fallback when the helper said nothing.
String formatPrintError(Object error) {
  final text = error.toString().trim();
  if (text.isEmpty) return "Could not print the label.";
  return text;
}

String labelHelperFailureText(ProcessResult result, {String? tool}) {
  final stderr = _processText(result.stderr);
  final stdout = _processText(result.stdout);
  final parts = <String>[
    if (stderr.isNotEmpty) stderr,
    if (stdout.isNotEmpty && stdout != stderr) stdout,
  ];
  if (parts.isEmpty) {
    parts.add("Could not print the label.");
  }
  if (tool != null && tool.isNotEmpty) {
    parts.add(tool);
  }
  parts.add("Exit ${result.exitCode}");
  var text = parts.join("\n").trim();
  const maxChars = 2000;
  if (text.length > maxChars) {
    text = "${text.substring(0, maxChars).trim()}\n…";
  }
  return text;
}

String _processText(Object? value) {
  if (value == null) return "";
  return value.toString().trim();
}

/// How Field starts the helper. `/bin/bash` runs the script even when the
/// download lost the executable bit or `env` cannot see `bash` on PATH.
class LabelPrintLaunch {
  const LabelPrintLaunch({required this.executable, required this.arguments});

  final String executable;
  final List<String> arguments;
}

LabelPrintLaunch labelPrintLaunch({
  required String script,
  required String csvPath,
}) {
  if (!Platform.isWindows && File("/bin/bash").existsSync()) {
    return LabelPrintLaunch(
      executable: "/bin/bash",
      arguments: [script, csvPath],
    );
  }
  return LabelPrintLaunch(executable: script, arguments: [csvPath]);
}

Future<ProcessResult> runCommand(
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

/// Absolute `ptouch-print` Settings and Print both invoke.
///
/// Prefers a binary whose `--help` actually runs. A bundled copy that fails
/// to start (missing library, not executable) is skipped in favor of the
/// next candidate, including `~/.local/bin` and Homebrew.
Future<String?> resolvePtouchPrint({
  required Map<String, String> env,
  CommandRunner? runner,
  bool lookOnDisk = true,
  String? scriptPath,
  bool probe = true,
}) async {
  final run = runner ?? runCommand;
  final candidates = <String>[];
  void add(String? path) {
    final trimmed = path?.trim() ?? "";
    if (trimmed.isEmpty || candidates.contains(trimmed)) return;
    candidates.add(trimmed);
  }

  final which = await _tryRun(run, "which", const ["ptouch-print"], env);
  if (which.exitCode == 0) {
    add(_processText(which.stdout).split("\n").first);
  }
  if (lookOnDisk) {
    for (final path in ptouchDiskCandidates(
      home: env["HOME"],
      scriptPath: scriptPath,
    )) {
      if (await isRunnableFile(path)) add(path);
    }
  }

  if (!probe) {
    return candidates.isEmpty ? null : candidates.first;
  }
  for (final path in candidates) {
    final help = await _tryRun(run, path, const ["--help"], env);
    if (_ptouchHelpOk(help)) return path;
  }
  return null;
}

/// Disk locations checked when `which ptouch-print` misses the binary
/// Settings can still run (app bundle, user install, Homebrew).
List<String> ptouchDiskCandidates({String? home, String? scriptPath}) {
  final out = <String>[];
  final script = scriptPath?.trim();
  if (script != null && script.isNotEmpty) {
    final parent = File(script).parent.path;
    final sep = Platform.pathSeparator;
    out.add("$parent${sep}bin${sep}ptouch-print");
  }
  final homeDir = home?.trim();
  if (homeDir != null && homeDir.isNotEmpty) {
    out.add(
      "$homeDir${Platform.pathSeparator}.local${Platform.pathSeparator}bin${Platform.pathSeparator}ptouch-print",
    );
  }
  out.add("/opt/homebrew/bin/ptouch-print");
  out.add("/usr/local/bin/ptouch-print");
  return out;
}

Future<bool> isRunnableFile(String path) async {
  final file = File(path);
  if (!await file.exists()) return false;
  if (Platform.isWindows) return true;
  try {
    return (await file.stat()).mode & 0x49 != 0;
  } catch (_) {
    return false;
  }
}

bool _ptouchHelpOk(ProcessResult result) {
  if (result.exitCode == 0) return true;
  final blob = "${_processText(result.stdout)}\n${_processText(result.stderr)}"
      .toLowerCase();
  return blob.contains("list-connected") || blob.contains("--serial");
}

Future<ProcessResult> _tryRun(
  CommandRunner runner,
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
  // Finder-launched apps often have a short PATH. Keep system bins at the
  // end so `bash`, `python3`, and `which` still resolve after the prepends.
  final systemTail = Platform.isWindows
      ? const <String>[]
      : const <String>["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  final existing = env["PATH"] ?? "";
  final parts = <String>[
    ...extras.where((p) => p.isNotEmpty),
    ...existing
        .split(Platform.isWindows ? ";" : ":")
        .where((p) => p.isNotEmpty),
    ...systemTail,
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
  for (var i = 0; i < 12; i += 1) {
    add(_posixJoin(dir, "scripts/print-asset-labels.sh"));
    final parent = _posixDirname(dir);
    if (parent == dir) break;
    dir = parent;
  }

  if (executable != null && executable.isNotEmpty) {
    var exeDir = _posixDirname(executable);
    for (var i = 0; i < 14; i += 1) {
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
