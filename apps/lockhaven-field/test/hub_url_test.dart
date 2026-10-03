import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/auth/auth_service.dart";

void main() {
  test("normalizeHubBaseUrl trims and strips a trailing slash", () {
    expect(
      normalizeHubBaseUrl(" https://console.example/ "),
      "https://console.example",
    );
    expect(normalizeHubBaseUrl(""), "");
  });
}
