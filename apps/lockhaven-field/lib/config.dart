/// Runtime config for the field app.
///
/// Override Hub base URL with `--dart-define=HUB_BASE_URL=https://console.example`.
/// Optional USB printer binary:
/// `--dart-define=PTOUCH_PRINT=/path/to/ptouch-print`.
class FieldConfig {
  const FieldConfig({
    required this.hubBaseUrl,
    this.ptouchPrintPath,
  });

  final String hubBaseUrl;

  /// Absolute path to `ptouch-print` when it is not on PATH.
  final String? ptouchPrintPath;

  static FieldConfig fromEnvironment() {
    const raw = String.fromEnvironment(
      "HUB_BASE_URL",
      defaultValue: "http://127.0.0.1:3000",
    );
    const ptouch = String.fromEnvironment("PTOUCH_PRINT");
    // Back-compat: older builds used LABEL_PRINT_SCRIPT; ignore for print path.
    return FieldConfig(
      hubBaseUrl: raw.replaceAll(RegExp(r"/$"), ""),
      ptouchPrintPath: ptouch.trim().isEmpty ? null : ptouch.trim(),
    );
  }
}
