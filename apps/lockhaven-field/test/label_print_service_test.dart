import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/labels/label_print_service.dart";
import "package:lockhaven_field/labels/label_renderer.dart";
import "package:image/image.dart" as img;

void main() {
  test("printHelperEnvironment prepends ~/.local/bin for ptouch-print", () {
    final env = printHelperEnvironment({
      "HOME": "/home/tech",
      "PATH": "/usr/bin:/bin",
    });
    expect(env["PATH"], startsWith("/home/tech/.local/bin:"));
    expect(env["PATH"], contains("/usr/bin"));
  });

  test("ptouchSearchCandidates covers common install paths", () {
    expect(
      ptouchSearchCandidates(home: "/home/tech"),
      contains("/home/tech/.local/bin/ptouch-print"),
    );
  });

  test("renderAssetLabelPng produces a 210×120 PNG with QR payload", () {
    final bytes = renderAssetLabelPng(
      tag: "LH-ABC123",
      serial: "SN-9",
      companyName: "NewMarketEntertainment",
    );
    final decoded = img.decodePng(bytes);
    expect(decoded, isNotNull);
    expect(decoded!.width, labelWidth);
    expect(decoded.height, labelHeight);
    // QR area should have some black pixels.
    var black = 0;
    for (var y = 14; y < 14 + 40; y += 1) {
      for (var x = 4; x < 4 + 40; x += 1) {
        final p = decoded.getPixel(x, y);
        if (p.r < 128) black += 1;
      }
    }
    expect(black, greaterThan(20));
  });
}
