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

  test("scriptSearchCandidates includes monorepo and Nic checkout paths", () {
    final candidates = scriptSearchCandidates(
      cwd: "/home/nic/git/lockhaven/apps/lockhaven-field",
      home: "/home/nic",
      executable:
          "/home/nic/git/lockhaven/apps/lockhaven-field/build/linux/x64/debug/bundle/lockhaven_field",
    );
    expect(
      candidates,
      contains("/home/nic/git/lockhaven/scripts/print-asset-labels.sh"),
    );
  });
}
