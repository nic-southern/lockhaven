/// Runtime config for the field app.
///
/// Override Hub base URL with `--dart-define=HUB_BASE_URL=https://console.example`.
/// Optional label helper:
/// `--dart-define=LABEL_PRINT_SCRIPT=/path/to/print-asset-labels.sh`.
class FieldConfig {
  const FieldConfig({
    required this.hubBaseUrl,
    this.labelPrintScript,
  });

  final String hubBaseUrl;

  /// Absolute path to `print-asset-labels.sh` when not discovered automatically.
  final String? labelPrintScript;

  static FieldConfig fromEnvironment() {
    const raw = String.fromEnvironment(
      "HUB_BASE_URL",
      defaultValue: "http://127.0.0.1:3000",
    );
    const script = String.fromEnvironment("LABEL_PRINT_SCRIPT");
    return FieldConfig(
      hubBaseUrl: raw.replaceAll(RegExp(r"/$"), ""),
      labelPrintScript: script.trim().isEmpty ? null : script.trim(),
    );
  }
}
