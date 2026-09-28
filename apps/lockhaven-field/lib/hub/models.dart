class FieldUser {
  const FieldUser({
    required this.id,
    required this.email,
    required this.name,
  });

  final String id;
  final String email;
  final String name;

  factory FieldUser.fromJson(Map<String, dynamic> json) {
    return FieldUser(
      id: json["id"] as String,
      email: json["email"] as String? ?? "",
      name: json["name"] as String? ?? "",
    );
  }
}

class SiteSummary {
  const SiteSummary({
    required this.id,
    required this.organizationId,
    required this.name,
    this.address,
    this.notes,
  });

  final String id;
  final String organizationId;
  final String name;
  final String? address;
  final String? notes;

  factory SiteSummary.fromJson(Map<String, dynamic> json) {
    return SiteSummary(
      id: json["id"] as String,
      organizationId: json["organizationId"] as String,
      name: json["name"] as String? ?? "Site",
      address: json["address"] as String?,
      notes: json["notes"] as String?,
    );
  }
}

class OrganizationSummary {
  const OrganizationSummary({
    required this.id,
    required this.name,
    required this.trackingTagPrefix,
  });

  final String id;
  final String name;
  final String trackingTagPrefix;

  factory OrganizationSummary.fromJson(Map<String, dynamic> json) {
    return OrganizationSummary(
      id: json["id"] as String,
      name: json["name"] as String? ?? "Organization",
      trackingTagPrefix: (json["trackingTagPrefix"] as String?) ?? "LH",
    );
  }
}

/// Hub device-model catalog entry (`deviceModels.list`).
class DeviceModelSummary {
  const DeviceModelSummary({
    required this.id,
    required this.organizationId,
    required this.name,
    required this.model,
    this.manufacturer,
    this.label,
  });

  final String id;
  final String organizationId;
  final String name;
  final String model;
  final String? manufacturer;
  final String? label;

  /// Operator-facing label used in search/dropdowns.
  String get displayLabel {
    final provided = label?.trim();
    if (provided != null && provided.isNotEmpty) return provided;
    final maker = manufacturer?.trim();
    if (maker != null && maker.isNotEmpty) {
      return "$name · $maker $model";
    }
    return "$name · $model";
  }

  factory DeviceModelSummary.fromJson(Map<String, dynamic> json) {
    return DeviceModelSummary(
      id: json["id"] as String,
      organizationId: json["organizationId"] as String,
      name: json["name"] as String? ?? "",
      model: json["model"] as String? ?? "",
      manufacturer: json["manufacturer"] as String?,
      label: json["label"] as String?,
    );
  }

  bool matchesQuery(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return displayLabel.toLowerCase().contains(q) ||
        name.toLowerCase().contains(q) ||
        model.toLowerCase().contains(q) ||
        (manufacturer?.toLowerCase().contains(q) ?? false);
  }
}

class AssetSummary {
  const AssetSummary({
    required this.id,
    required this.organizationId,
    required this.tag,
    this.name,
    this.siteId,
    this.siteName,
    this.organizationName,
    this.serial,
    this.hostname,
    this.vendor,
    this.model,
    this.deviceModelId,
    this.deviceModelName,
    this.deviceModelManufacturer,
    this.deviceModelCode,
    this.status,
    this.notes,
    this.parentAssetId,
    this.parentTag,
    this.parentName,
    this.isContainer = false,
    this.deviceId,
    this.deviceName,
  });

  final String id;
  final String organizationId;
  final String tag;
  /// Operator-facing name when Hub provides one; otherwise [title] falls back.
  final String? name;
  final String? siteId;
  final String? siteName;
  final String? organizationName;
  final String? serial;
  final String? hostname;
  final String? vendor;
  final String? model;
  final String? deviceModelId;
  final String? deviceModelName;
  final String? deviceModelManufacturer;
  final String? deviceModelCode;
  final String? status;
  final String? notes;
  final String? parentAssetId;
  final String? parentTag;
  final String? parentName;
  /// True when this asset can contain other assets (not a typed folder kind).
  final bool isContainer;
  final String? deviceId;
  final String? deviceName;

  factory AssetSummary.fromJson(Map<String, dynamic> json) {
    // Prefer Hub `isContainer`. Fall back while older payloads still send
    // `isFolder` / `folderKind` during the Hub migration.
    final isContainer = json["isContainer"] == true ||
        json["isFolder"] == true ||
        (json["folderKind"] is String &&
            (json["folderKind"] as String).trim().isNotEmpty);

    return AssetSummary(
      id: json["id"] as String,
      organizationId: json["organizationId"] as String,
      tag: json["tag"] as String? ?? "",
      name: json["name"] as String?,
      siteId: json["siteId"] as String?,
      siteName: json["siteName"] as String?,
      organizationName: json["organizationName"] as String?,
      serial: json["serial"] as String?,
      hostname: json["hostname"] as String?,
      vendor: json["vendor"] as String?,
      model: json["model"] as String?,
      deviceModelId: json["deviceModelId"] as String?,
      deviceModelName: json["deviceModelName"] as String?,
      deviceModelManufacturer: json["deviceModelManufacturer"] as String?,
      deviceModelCode: json["deviceModelCode"] as String?,
      status: json["status"] as String?,
      notes: json["notes"] as String?,
      parentAssetId: json["parentAssetId"] as String?,
      parentTag: json["parentTag"] as String?,
      parentName: json["parentName"] as String?,
      isContainer: isContainer,
      deviceId: json["deviceId"] as String?,
      deviceName: json["deviceName"] as String?,
    );
  }

  /// Primary label: name, then hostname, serial, or tag.
  String get title {
    if (name != null && name!.trim().isNotEmpty) return name!.trim();
    if (hostname != null && hostname!.trim().isNotEmpty) return hostname!;
    if (serial != null && serial!.trim().isNotEmpty) return serial!;
    return tag;
  }

  String get subtitle {
    final catalog = deviceModelName?.trim();
    final catalogCode = deviceModelCode?.trim();
    final parts = <String>[
      if (isContainer) "Container",
      if (!isContainer && parentTag != null)
        "In ${parentName ?? parentTag}",
      if (catalog != null && catalog.isNotEmpty)
        catalog
      else ...[
        if (vendor != null && vendor!.isNotEmpty) vendor!,
        if (model != null && model!.isNotEmpty) model!,
      ],
      if (catalog != null &&
          catalog.isNotEmpty &&
          catalogCode != null &&
          catalogCode.isNotEmpty &&
          catalogCode != catalog)
        catalogCode,
      if (status != null) statusLabel(status!),
    ];
    return parts.join(" · ");
  }
}

String statusLabel(String status) {
  switch (status) {
    case "in_service":
      return "In service";
    case "stock":
      return "Stock";
    case "repair":
      return "Repair";
    case "retired":
      return "Retired";
    case "lost":
      return "Lost";
    case "disposed":
      return "Disposed";
    default:
      return status;
  }
}

/// Normalize a scanner payload (plain tag, serial, or tag\\nserial).
List<String> scanQueryCandidates(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return const [];
  final lines = trimmed
      .split(RegExp(r"[\r\n]+"))
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .toList();
  if (lines.isEmpty) return const [];
  if (lines.length == 1) return [lines.first];
  return [lines.first, lines[1], lines.join(" ")];
}
