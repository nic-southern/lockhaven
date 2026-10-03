import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/labels/label_print_service.dart";

void main() {
  test("printHelperEnvironment prepends extra bin dirs then ~/.local/bin", () {
    final env = printHelperEnvironment(
      {
        "HOME": "/home/tech",
        "PATH": "/usr/bin:/bin",
      },
      extraBinDirs: ["/Applications/Lockhaven Field.app/Contents/Resources/label-tools/bin"],
    );
    expect(
      env["PATH"],
      startsWith(
        "/Applications/Lockhaven Field.app/Contents/Resources/label-tools/bin:",
      ),
    );
    expect(env["PATH"], contains("/home/tech/.local/bin"));
    expect(env["PATH"], contains("/opt/homebrew/bin"));
    expect(env["PATH"], contains("/usr/local/bin"));
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

  test("scriptSearchCandidates includes macOS checkout layouts", () {
    final candidates = scriptSearchCandidates(
      cwd: "/Users/nic/Developer/lockhaven/apps/lockhaven-field",
      home: "/Users/nic",
      executable:
          "/Users/nic/Developer/lockhaven/apps/lockhaven-field/build/macos/Build/Products/Debug/lockhaven_field.app/Contents/MacOS/lockhaven_field",
    );
    expect(
      candidates,
      contains("/Users/nic/Developer/lockhaven/scripts/print-asset-labels.sh"),
    );
    expect(
      candidates,
      contains("/Users/nic/Projects/lockhaven/scripts/print-asset-labels.sh"),
    );
    expect(
      candidates.first,
      "/Users/nic/Developer/lockhaven/apps/lockhaven-field/build/macos/Build/Products/Debug/lockhaven_field.app/Contents/Resources/label-tools/print-asset-labels.sh",
    );
  });

  test("bundledScriptCandidates prefers macOS Resources label-tools", () {
    final bundled = bundledScriptCandidates(
      "/Applications/Lockhaven Field.app/Contents/MacOS/lockhaven_field",
    );
    expect(
      bundled,
      contains(
        "/Applications/Lockhaven Field.app/Contents/Resources/label-tools/print-asset-labels.sh",
      ),
    );
  });
}
