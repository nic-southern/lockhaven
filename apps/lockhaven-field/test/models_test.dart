import "package:flutter_test/flutter_test.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/hub/tracking_tag.dart";

void main() {
  test("scanQueryCandidates trims and splits multiline QR payloads", () {
    expect(scanQueryCandidates("  TAG-1  "), ["TAG-1"]);
    expect(
      scanQueryCandidates("TAG-1\nSN-99"),
      ["TAG-1", "SN-99", "TAG-1 SN-99"],
    );
    expect(scanQueryCandidates("\n\n"), isEmpty);
  });

  test("statusLabel uses product language", () {
    expect(statusLabel("in_service"), "In service");
    expect(statusLabel("stock"), "Stock");
  });

  test("AssetSummary prefers isContainer and falls back during Hub migration",
      () {
    final modern = AssetSummary.fromJson({
      "id": "11111111-1111-1111-1111-111111111111",
      "organizationId": "22222222-2222-2222-2222-222222222222",
      "tag": "LH-BOX1",
      "name": "Front cabinet",
      "isContainer": true,
    });
    expect(modern.isContainer, isTrue);
    expect(modern.title, "Front cabinet");
    expect(modern.subtitle, contains("Container"));

    final legacy = AssetSummary.fromJson({
      "id": "11111111-1111-1111-1111-111111111111",
      "organizationId": "22222222-2222-2222-2222-222222222222",
      "tag": "LH-OLD",
      "folderKind": "cabinet",
      "isFolder": true,
      "folderLabel": "Cabinet",
    });
    expect(legacy.isContainer, isTrue);
    expect(legacy.title, "LH-OLD");
  });

  test("suggestAssetTrackingTag matches Hub shared helper", () {
    expect(
      suggestAssetTrackingTag(
        deviceId: "11111111-1111-4111-8111-111111111111",
        hostname: "kiosk-01",
        serialNumber: "SN-LONG-SMBIOS-VALUE",
      ),
      "LH-679BVP",
    );
    expect(
      suggestAssetTrackingTag(
        deviceId: "11111111-1111-4111-8111-111111111111",
        hostname: "kiosk-01",
        serialNumber: "SN-100",
        prefix: "nme",
      ),
      "NME-QV8ZZJ",
    );
  });

  test("humanizeHubError unwraps Zod issue arrays", () {
    const raw = '''
[
  {
    "expected": "string",
    "code": "invalid_type",
    "path": ["id"],
    "message": "Invalid input: expected string, received undefined"
  }
]
''';
    expect(
      humanizeHubError(raw),
      "Invalid input: expected string, received undefined",
    );
  });
}
