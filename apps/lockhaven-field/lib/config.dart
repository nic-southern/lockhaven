/// Runtime config for the field app.
///
/// Override Hub base URL with `--dart-define=HUB_BASE_URL=https://console.example`.
class FieldConfig {
  const FieldConfig({required this.hubBaseUrl});

  final String hubBaseUrl;

  static FieldConfig fromEnvironment() {
    const raw = String.fromEnvironment(
      "HUB_BASE_URL",
      defaultValue: "http://127.0.0.1:3000",
    );
    return FieldConfig(hubBaseUrl: raw.replaceAll(RegExp(r"/$"), ""));
  }
}
