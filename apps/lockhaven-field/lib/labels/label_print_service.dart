import "dart:io";

import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/labels/label_payload.dart";
import "package:path_provider/path_provider.dart";
import "package:url_launcher/url_launcher.dart";

enum LabelPrintPath {
  /// Local `print-asset-labels.sh` (Brother USB helper) ran successfully.
  helper,
  /// Opened Hub browser labels page as fallback.
  browser,
  /// Wrote CSV only (dry-run / helper missing and browser failed).
  csvOnly,
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

/// Prepares a one-row label CSV and prints via the laptop helper when present,
/// otherwise opens Hub `/assets/labels?ids=…` in the system browser.
///
/// Does not talk to USB printers from Flutter — the helper owns that path.
class LabelPrintService {
  LabelPrintService({required this.config});

  final FieldConfig config;

  Future<LabelPrintResult> printAssetLabel({
    required AssetSummary asset,
    String? companyName,
    String? siteName,
    bool preferBrowser = false,
  }) async {
    final row = AssetLabelCsvRow.build(
      tag: asset.tag,
      serial: asset.serial,
      companyName: companyName ?? asset.organizationName,
      siteName: siteName ?? asset.siteName,
    );
    if (row == null) {
      throw StateError("Tracking tag is required to print a label.");
    }

    final dir = await getTemporaryDirectory();
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final csvFile = File("${dir.path}/lockhaven-label-$stamp.csv");
    await csvFile.writeAsString(formatAssetLabelCsv([row]));

    if (!preferBrowser) {
      final script = await _resolvePrintScript();
      if (script != null) {
        final result = await Process.run(
          script,
          [csvFile.path],
          runInShell: false,
        );
        if (result.exitCode == 0) {
          return LabelPrintResult(
            path: LabelPrintPath.helper,
            csvPath: csvFile.path,
            message: "Sent to the label printer.",
          );
        }
        // Fall through to browser if helper fails (missing ptouch, etc.).
      }
    }

    final labelsUrl = Uri.parse(
      "${config.hubBaseUrl}/assets/labels?ids=${Uri.encodeComponent(asset.id)}",
    );
    final launched = await launchUrl(
      labelsUrl,
      mode: LaunchMode.externalApplication,
    );
    if (launched) {
      return LabelPrintResult(
        path: LabelPrintPath.browser,
        csvPath: csvFile.path,
        message: "Opened the labels page to print.",
      );
    }

    return LabelPrintResult(
      path: LabelPrintPath.csvOnly,
      csvPath: csvFile.path,
      message: "Label CSV saved at ${csvFile.path}",
    );
  }

  Future<String?> _resolvePrintScript() async {
    final configured = config.labelPrintScript?.trim();
    if (configured != null && configured.isNotEmpty) {
      final file = File(configured);
      if (await file.exists()) return file.absolute.path;
    }

    // When developing from the monorepo checkout.
    final candidates = <String>[
      "scripts/print-asset-labels.sh",
      "../scripts/print-asset-labels.sh",
      "../../scripts/print-asset-labels.sh",
      "../../../scripts/print-asset-labels.sh",
    ];
    for (final relative in candidates) {
      final file = File(relative);
      if (await file.exists()) return file.absolute.path;
    }

    // PATH lookup for a packaged install of the helper.
    try {
      final which = await Process.run("which", ["print-asset-labels.sh"]);
      if (which.exitCode == 0) {
        final path = (which.stdout as String).trim();
        if (path.isNotEmpty) return path;
      }
    } catch (_) {
      // Ignore.
    }
    return null;
  }
}
