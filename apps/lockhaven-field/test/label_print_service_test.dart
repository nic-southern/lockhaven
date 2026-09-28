import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/labels/label_print_service.dart";

void main() {
  test("printHelperEnvironment prepends ~/.local/bin for ptouch-print", () {
    final env = printHelperEnvironment({
      "HOME": "/home/tech",
      "PATH": "/usr/bin:/bin",
    });
    expect(env["PATH"], startsWith("/home/tech/.local/bin:"));
    expect(env["PATH"], contains("/usr/bin"));
  });

  test("scriptSearchCandidates includes monorepo relative paths", () {
    final candidates = scriptSearchCandidates(
      cwd: "/home/tech/lockhaven/apps/lockhaven-field",
      home: "/home/tech",
      executable: "/home/tech/lockhaven/apps/lockhaven-field/build/linux/x64/debug/bundle/lockhaven_field",
    );
    expect(
      candidates,
      contains(
        "/home/tech/lockhaven/apps/lockhaven-field/../../scripts/print-asset-labels.sh",
      ),
    );
    expect(
      candidates,
      contains("/home/tech/lockhaven/scripts/print-asset-labels.sh"),
    );
    expect(
      candidates,
      contains("/home/tech/.local/bin/print-asset-labels.sh"),
    );
  });
}
