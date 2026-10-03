import "dart:io";

import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/labels/label_print_service.dart";
import "package:lockhaven_field/labels/usb_printers.dart";

void main() {
  test("printHelperEnvironment prepends extra bin dirs then ~/.local/bin", () {
    final env = printHelperEnvironment(
      {"HOME": "/home/tech", "PATH": "/usr/bin:/bin"},
      extraBinDirs: [
        "/Applications/Lockhaven Field.app/Contents/Resources/label-tools/bin",
      ],
    );
    final sep = Platform.isWindows ? ";" : ":";
    expect(
      env["PATH"],
      startsWith(
        "/Applications/Lockhaven Field.app/Contents/Resources/label-tools/bin$sep",
      ),
    );
    expect(env["PATH"], contains("/home/tech/.local/bin"));
    expect(env["PATH"], contains("/opt/homebrew/bin"));
    expect(env["PATH"], contains("/usr/local/bin"));
    expect(env["PATH"], contains("/usr/bin"));
    expect(env["PATH"], contains("/bin"));
  });

  test("printHelperEnvironment keeps system bins when PATH is empty", () {
    final env = printHelperEnvironment({"HOME": "/Users/nic", "PATH": ""});
    expect(env["PATH"], contains("/Users/nic/.local/bin"));
    expect(env["PATH"], contains("/opt/homebrew/bin"));
    if (!Platform.isWindows) {
      expect(env["PATH"], contains("/usr/bin"));
      expect(env["PATH"], contains("/bin"));
    }
  });

  test("scriptSearchCandidates includes monorepo and Nic checkout paths", () {
    final candidates = scriptSearchCandidates(
      cwd: "/home/nic/git/lockhaven/apps/lockhaven-field",
      home: "/home/nic",
      executable: "/home/nic/git/lockhaven/apps/lockhaven-field/build/linux/x64/debug/bundle/lockhaven_field",
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
      executable: "/Users/nic/Developer/lockhaven/apps/lockhaven-field/build/macos/Build/Products/Debug/lockhaven_field.app/Contents/MacOS/lockhaven_field",
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

  test("scriptSearchCandidates reaches repo scripts from a macOS flutter build", () {
    const executable =
        "/Users/nic/Developer/lockhaven/apps/lockhaven-field/build/macos/Build/Products/Debug/lockhaven_field.app/Contents/MacOS/lockhaven_field";
    final candidates = scriptSearchCandidates(
      cwd: "/private/tmp",
      home: null,
      executable: executable,
    );
    expect(
      candidates,
      contains("/Users/nic/Developer/lockhaven/scripts/print-asset-labels.sh"),
    );
    expect(
      candidates.first,
      "/Users/nic/Developer/lockhaven/apps/lockhaven-field/build/macos/Build/Products/Debug/lockhaven_field.app/Contents/Resources/label-tools/print-asset-labels.sh",
    );
  });

  test(
    "bundledScriptCandidates walks a Windows install next to label-tools",
    () {
      final bundled = bundledScriptCandidates(
        r"C:\Program Files\Lockhaven Field\lockhaven_field.exe",
      );
      expect(
        bundled,
        contains(
          "C:/Program Files/Lockhaven Field/label-tools/print-asset-labels.sh",
        ),
      );
    },
  );

  test("label helper failure shows stderr instead of a generic sentence", () {
    const stderr =
        "No P-Touch printer with serial E75J012345 found\n"
        "interface claim error: LIBUSB_ERROR_BUSY\n";
    final text = labelHelperFailureText(
      ProcessResult(
        1,
        5,
        "Working directory: /tmp\n+ /opt/homebrew/bin/ptouch-print --timeout=30 --serial E75J012345 --image label.png\n",
        stderr,
      ),
      tool: "/Applications/Lockhaven Field.app/Contents/Resources/label-tools/print-asset-labels.sh",
    );
    expect(text, startsWith("No P-Touch printer with serial E75J012345 found"));
    expect(text, contains("LIBUSB_ERROR_BUSY"));
    expect(text, contains("ptouch-print --timeout=30 --serial E75J012345"));
    expect(text, contains("Exit 5"));
    expect(text, isNot(contains("Printer not found. Turn it on")));
    expect(text, isNot(contains("Label helper failed")));
  });

  test("empty helper output still says the label could not print", () {
    final text = labelHelperFailureText(ProcessResult(1, 1, "", "  "));
    expect(text, contains("Could not print the label."));
    expect(text, contains("Exit 1"));
  });

  test("labelPrintLaunch uses bash so a non-executable helper still starts", () {
    const script =
        "/Applications/Lockhaven Field.app/Contents/Resources/label-tools/print-asset-labels.sh";
    final launch = labelPrintLaunch(script: script, csvPath: "/tmp/label.csv");
    if (Platform.isWindows) {
      expect(launch.executable, script);
      expect(launch.arguments, ["/tmp/label.csv"]);
      return;
    }
    expect(launch.executable, "/bin/bash");
    expect(launch.arguments, [script, "/tmp/label.csv"]);
  });

  test(
    "resolvePtouchPrint skips a broken which hit and uses the runnable binary",
    () async {
      final dir = Directory.systemTemp.createTempSync("lh-ptouch-");
      addTearDown(() {
        if (dir.existsSync()) dir.deleteSync(recursive: true);
      });
      final sep = Platform.pathSeparator;
      final script = File("${dir.path}${sep}print-asset-labels.sh")
        ..writeAsStringSync("#!/bin/bash\n");
      final bundled = File("${dir.path}${sep}bin${sep}ptouch-print");
      bundled.parent.createSync(recursive: true);
      bundled.writeAsStringSync("#!/bin/sh\nexit 1\n");
      if (!Platform.isWindows) {
        Process.runSync("chmod", ["+x", bundled.path]);
      }
      final working = File(
        "${dir.path}$sep.local${sep}bin${sep}ptouch-print",
      );
      working.parent.createSync(recursive: true);
      working.writeAsStringSync("#!/bin/sh\nexit 0\n");
      if (!Platform.isWindows) {
        Process.runSync("chmod", ["+x", working.path]);
      }

      // Windows disk candidates use backslashes; File.path may keep the
      // separators used to create the temp file. Compare the path identity.
      String slash(String path) => path.replaceAll("\\", "/");
      bool samePath(String a, String b) => slash(a) == slash(b);

      final resolved = await resolvePtouchPrint(
        env: {"HOME": dir.path, "PATH": "/usr/bin:/bin"},
        lookOnDisk: true,
        scriptPath: script.path,
        runner: (exe, args, {environment}) async {
          if (exe == "which") {
            return ProcessResult(1, 0, bundled.path, "");
          }
          if (samePath(exe, bundled.path)) {
            return ProcessResult(
              1,
              127,
              "",
              "dyld: Library not loaded: libusb\n",
            );
          }
          if (samePath(exe, working.path) && args.contains("--help")) {
            return ProcessResult(
              1,
              0,
              "usage: ptouch-print --list-connected --serial\n",
              "",
            );
          }
          return ProcessResult(1, 127, "", "not found");
        },
      );
      expect(resolved, isNotNull);
      expect(slash(resolved!), slash(working.path));

      final env = withSelectedPrinter(
        {"PATH": "/usr/bin"},
        const PrinterSelection(
          id: "serial:E75J012345",
          usbSerial: "E75J012345",
        ),
        ptouchPrint: resolved,
      );
      expect(slash(env["PTOUCH_PRINT"]!), slash(working.path));
      expect(env["PTOUCH_SERIAL"], "E75J012345");
    },
  );
}
