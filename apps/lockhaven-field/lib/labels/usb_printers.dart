/// Parsed USB / tape-printer inventory for Field Settings.
///
/// Listing uses `ptouch-print --list-connected` (and `--info` as fallback)
/// plus a one-line OS USB inventory (`lsusb` or `system_profiler`).
library;

const brotherUsbVendorId = "04f9";

class UsbDeviceRow {
  const UsbDeviceRow({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.tapeCompatible,
    this.usbSerial,
    this.model,
    this.bus,
    this.deviceAddress,
    this.vendorId,
    this.productId,
    this.detail,
  });

  /// Stable id for selection (USB serial, else bus:addr, else vid:pid).
  final String id;
  final String title;
  final String subtitle;
  final bool tapeCompatible;
  final String? usbSerial;
  final String? model;
  final int? bus;
  final int? deviceAddress;
  final String? vendorId;
  final String? productId;
  final String? detail;

  bool get canPassSerial =>
      usbSerial != null && usbSerial!.isNotEmpty && usbSerial != "-";

  UsbDeviceRow copyWith({
    String? id,
    String? title,
    String? subtitle,
    bool? tapeCompatible,
    String? usbSerial,
    String? model,
    int? bus,
    int? deviceAddress,
    String? vendorId,
    String? productId,
    String? detail,
  }) {
    return UsbDeviceRow(
      id: id ?? this.id,
      title: title ?? this.title,
      subtitle: subtitle ?? this.subtitle,
      tapeCompatible: tapeCompatible ?? this.tapeCompatible,
      usbSerial: usbSerial ?? this.usbSerial,
      model: model ?? this.model,
      bus: bus ?? this.bus,
      deviceAddress: deviceAddress ?? this.deviceAddress,
      vendorId: vendorId ?? this.vendorId,
      productId: productId ?? this.productId,
      detail: detail ?? this.detail,
    );
  }
}

class PrinterSelection {
  const PrinterSelection({
    required this.id,
    this.usbSerial,
    this.model,
    this.title,
  });

  final String id;
  final String? usbSerial;
  final String? model;
  final String? title;

  Map<String, String> toJson() => {
    "id": id,
    if (usbSerial != null && usbSerial!.isNotEmpty) "usbSerial": usbSerial!,
    if (model != null && model!.isNotEmpty) "model": model!,
    if (title != null && title!.isNotEmpty) "title": title!,
  };

  static PrinterSelection? fromJson(Map<String, dynamic> json) {
    final id = (json["id"] as String?)?.trim() ?? "";
    if (id.isEmpty) return null;
    return PrinterSelection(
      id: id,
      usbSerial: (json["usbSerial"] as String?)?.trim(),
      model: (json["model"] as String?)?.trim(),
      title: (json["title"] as String?)?.trim(),
    );
  }

  factory PrinterSelection.fromDevice(UsbDeviceRow row) {
    return PrinterSelection(
      id: row.id,
      usbSerial: row.canPassSerial ? row.usbSerial : null,
      model: row.model,
      title: row.title,
    );
  }
}

bool isTapeVendor(String? vendorId) {
  return (vendorId ?? "").toLowerCase() == brotherUsbVendorId;
}

bool looksLikeTapeModel(String text) {
  final t = text.toLowerCase();
  return t.contains("pt-") ||
      t.contains("p-touch") ||
      t.contains("ptouch") ||
      t.contains("ql-");
}

String? normalizeHexId(String? raw) {
  if (raw == null) return null;
  var s = raw.trim().toLowerCase();
  if (s.startsWith("0x")) s = s.substring(2);
  s = s.replaceAll(RegExp(r"[^0-9a-f]"), "");
  if (s.isEmpty) return null;
  return s.padLeft(4, "0");
}

/// `lsusb` one-line form: `Bus 001 Device 008: ID 04f9:20e0 Brother Industries, Ltd PT-D460BT`
List<UsbDeviceRow> parseLsusb(String output) {
  final re = RegExp(
    r"^Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+([0-9a-fA-F]{4}):([0-9a-fA-F]{4})\s+(.*)$",
    multiLine: true,
  );
  final out = <UsbDeviceRow>[];
  for (final match in re.allMatches(output)) {
    final bus = int.parse(match.group(1)!);
    final addr = int.parse(match.group(2)!);
    final vid = match.group(3)!.toLowerCase();
    final pid = match.group(4)!.toLowerCase();
    final rest = match.group(5)!.trim();
    final compatible = isTapeVendor(vid) || looksLikeTapeModel(rest);
    out.add(
      UsbDeviceRow(
        id: "usb:$vid:$pid:$bus:$addr",
        title: rest.isEmpty ? "Unknown device" : rest,
        subtitle: "Port $bus · $addr",
        tapeCompatible: compatible,
        bus: bus,
        deviceAddress: addr,
        vendorId: vid,
        productId: pid,
      ),
    );
  }
  return out;
}

/// `ptouch-print --list-connected`:
/// `PT-D460BT	serial E75J012345	(USB bus 1, device 8)`
List<UsbDeviceRow> parseListConnected(String output) {
  final re = RegExp(
    r"^(.+?)\tserial\s+(\S+)\t\(USB bus\s+(\d+),\s+device\s+(\d+)\)(.*)$",
    multiLine: true,
  );
  final out = <UsbDeviceRow>[];
  for (final match in re.allMatches(output)) {
    final model = match.group(1)!.trim();
    final serial = match.group(2)!.trim();
    final bus = int.parse(match.group(3)!);
    final addr = int.parse(match.group(4)!);
    final extra = match.group(5)!.trim();
    final unsupported = extra.toLowerCase().contains("unsupported");
    final id = (serial.isNotEmpty && serial != "-")
        ? "serial:$serial"
        : "bus:$bus:$addr";
    out.add(
      UsbDeviceRow(
        id: id,
        title: model,
        subtitle: serial.isNotEmpty && serial != "-"
            ? "Printer $serial · port $bus · $addr"
            : "Port $bus · $addr",
        tapeCompatible: !unsupported,
        usbSerial: serial,
        model: model,
        bus: bus,
        deviceAddress: addr,
        vendorId: brotherUsbVendorId,
        detail: extra.isEmpty ? null : extra,
      ),
    );
  }
  return out;
}

/// `ptouch-print --info` / open: `PT-D460BT found on USB bus 1, device 8, serial E75J…`
List<UsbDeviceRow> parseInfoPrinters(String output) {
  final withSerial = RegExp(
    r"([A-Za-z0-9][A-Za-z0-9\- ]*?)\s+found on USB bus\s+(\d+),\s+device\s+(\d+),\s+serial\s+(\S+)",
  );
  final withoutSerial = RegExp(
    r"([A-Za-z0-9][A-Za-z0-9\- ]*?)\s+found on USB bus\s+(\d+),\s+device\s+(\d+)\s*$",
    multiLine: true,
  );
  final out = <UsbDeviceRow>[];
  final seen = <String>{};
  for (final match in withSerial.allMatches(output)) {
    final model = match.group(1)!.trim();
    final bus = int.parse(match.group(2)!);
    final addr = int.parse(match.group(3)!);
    final serial = match.group(4)!.trim();
    final id = (serial.isNotEmpty && serial != "-")
        ? "serial:$serial"
        : "bus:$bus:$addr";
    if (!seen.add(id)) continue;
    out.add(
      UsbDeviceRow(
        id: id,
        title: model,
        subtitle: serial.isNotEmpty && serial != "-"
            ? "Printer $serial · port $bus · $addr"
            : "Port $bus · $addr",
        tapeCompatible: true,
        usbSerial: serial,
        model: model,
        bus: bus,
        deviceAddress: addr,
        vendorId: brotherUsbVendorId,
      ),
    );
  }
  if (out.isEmpty) {
    for (final match in withoutSerial.allMatches(output)) {
      final model = match.group(1)!.trim();
      final bus = int.parse(match.group(2)!);
      final addr = int.parse(match.group(3)!);
      final id = "bus:$bus:$addr";
      if (!seen.add(id)) continue;
      out.add(
        UsbDeviceRow(
          id: id,
          title: model,
          subtitle: "Port $bus · $addr",
          tapeCompatible: true,
          model: model,
          bus: bus,
          deviceAddress: addr,
          vendorId: brotherUsbVendorId,
        ),
      );
    }
  }
  return out;
}

Set<String> parseListSupported(String output) {
  final names = <String>{};
  for (final raw in output.split(RegExp(r"\r?\n"))) {
    final line = raw.trim();
    if (line.isEmpty) continue;
    if (line.toLowerCase().startsWith("supported")) continue;
    names.add(line);
  }
  return names;
}

/// `system_profiler SPUSBDataType` (macOS) — Product / Vendor / Serial blocks.
List<UsbDeviceRow> parseSystemProfilerUsb(String output) {
  final devices = <UsbDeviceRow>[];
  String? name;
  String? vid;
  String? pid;
  String? serial;
  int indent = 0;

  void flush() {
    if (name == null && vid == null && pid == null) return;
    final v = normalizeHexId(vid);
    final p = normalizeHexId(pid);
    final title = (name ?? "").trim();
    if (title.isEmpty && v == null) return;
    final compatible = isTapeVendor(v) || looksLikeTapeModel(title);
    final id = (serial != null && serial!.isNotEmpty)
        ? "serial:$serial"
        : "usb:${v ?? "0000"}:${p ?? "0000"}:${title.hashCode}";
    devices.add(
      UsbDeviceRow(
        id: id,
        title: title.isEmpty ? "Unknown device" : title,
        subtitle: [
          if (v != null && p != null) "$v:$p",
          if (serial != null && serial!.isNotEmpty) "Printer $serial",
        ].join(" · "),
        tapeCompatible: compatible,
        usbSerial: serial,
        model: looksLikeTapeModel(title) ? title : null,
        vendorId: v,
        productId: p,
      ),
    );
    name = null;
    vid = null;
    pid = null;
    serial = null;
  }

  for (final raw in output.split(RegExp(r"\r?\n"))) {
    final match = RegExp(r"^(\s*)(.*)$").firstMatch(raw);
    if (match == null) continue;
    final spaces = match.group(1)!.length;
    final line = match.group(2)!.trim();
    if (line.isEmpty) continue;

    if (line.endsWith(":") && !line.contains("ID:") && spaces >= 4) {
      final label = line.substring(0, line.length - 1).trim();
      final lower = label.toLowerCase();
      if (lower.contains("bus") ||
          lower.contains("host controller") ||
          lower == "usb") {
        continue;
      }
      if (name != null && (vid != null || pid != null || serial != null)) {
        flush();
      }
      name = label;
      vid = null;
      pid = null;
      serial = null;
      indent = spaces;
      continue;
    }

    if (name != null && spaces > indent) {
      final prod = RegExp(r"^Product ID:\s*(0x)?([0-9a-fA-F]+)")
          .firstMatch(line);
      if (prod != null) {
        pid = prod.group(2);
        continue;
      }
      final vend = RegExp(r"^Vendor ID:\s*(0x)?([0-9a-fA-F]+)")
          .firstMatch(line);
      if (vend != null) {
        vid = vend.group(2);
        continue;
      }
      final ser = RegExp(r"^Serial Number:\s*(.+)$").firstMatch(line);
      if (ser != null) {
        serial = ser.group(1)!.trim();
      }
    }
  }
  flush();
  return devices;
}

List<UsbDeviceRow> mergeUsbInventory({
  required List<UsbDeviceRow> peripherals,
  required List<UsbDeviceRow> printers,
}) {
  final merged = <UsbDeviceRow>[];
  final usedPrinters = <int>{};

  UsbDeviceRow? matchPrinter(UsbDeviceRow usb) {
    for (var i = 0; i < printers.length; i++) {
      if (usedPrinters.contains(i)) continue;
      final p = printers[i];
      final sameBus =
          usb.bus != null &&
          p.bus != null &&
          usb.bus == p.bus &&
          usb.deviceAddress == p.deviceAddress;
      final sameSerial =
          usb.usbSerial != null &&
          p.usbSerial != null &&
          usb.usbSerial!.isNotEmpty &&
          usb.usbSerial == p.usbSerial;
      final sameModel =
          p.model != null &&
          usb.title.toLowerCase().contains(p.model!.toLowerCase());
      if (sameBus || sameSerial || (isTapeVendor(usb.vendorId) && sameModel)) {
        usedPrinters.add(i);
        return p;
      }
    }
    return null;
  }

  for (final usb in peripherals) {
    final printer = matchPrinter(usb);
    if (printer == null) {
      merged.add(usb);
      continue;
    }
    merged.add(
      usb.copyWith(
        id: printer.id,
        title: printer.title,
        subtitle: printer.subtitle,
        tapeCompatible: printer.tapeCompatible || usb.tapeCompatible,
        usbSerial: printer.usbSerial ?? usb.usbSerial,
        model: printer.model ?? usb.model,
      ),
    );
  }

  for (var i = 0; i < printers.length; i++) {
    if (usedPrinters.contains(i)) continue;
    merged.add(printers[i]);
  }

  merged.sort((a, b) {
    if (a.tapeCompatible != b.tapeCompatible) {
      return a.tapeCompatible ? -1 : 1;
    }
    return a.title.toLowerCase().compareTo(b.title.toLowerCase());
  });
  return merged;
}

bool looksLikePermissionError(String blob) {
  final t = blob.toLowerCase();
  return t.contains("permission denied") ||
      t.contains("access denied") ||
      t.contains("libusb_error_access") ||
      t.contains("interface claim error") ||
      t.contains("operation not permitted");
}

bool looksLikeMissingTool(String blob) {
  final t = blob.toLowerCase();
  return t.contains("not found") ||
      t.contains("no such file") ||
      t.contains("cannot find");
}

/// Env consumed by `print-asset-labels.sh`.
///
/// `PTOUCH_SERIAL` becomes `ptouch-print --serial`. `PTOUCH_PRINT` is the
/// absolute binary Settings already used for `--list-connected`, so Print
/// does not search PATH again and pick a different copy.
Map<String, String> withSelectedPrinter(
  Map<String, String> env,
  PrinterSelection? selection, {
  String? ptouchPrint,
}) {
  final next = Map<String, String>.from(env);
  final serial = selection?.usbSerial?.trim();
  if (serial == null || serial.isEmpty || serial == "-") {
    next.remove("PTOUCH_SERIAL");
  } else {
    next["PTOUCH_SERIAL"] = serial;
  }
  final tool = ptouchPrint?.trim();
  if (tool == null || tool.isEmpty) {
    next.remove("PTOUCH_PRINT");
  } else {
    next["PTOUCH_PRINT"] = tool;
  }
  return next;
}
