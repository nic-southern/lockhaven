import "dart:convert";
import "dart:io";

import "package:path_provider/path_provider.dart";
import "package:lockhaven_field/labels/usb_printers.dart";

class PrinterStore {
  PrinterStore({this.fileOverride});

  final File? fileOverride;

  Future<File> _file() async {
    final override = fileOverride;
    if (override != null) return override;
    final dir = await getApplicationSupportDirectory();
    return File("${dir.path}/label_printer.json");
  }

  Future<PrinterSelection?> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) return null;
      final raw = jsonDecode(await file.readAsString());
      if (raw is! Map) return null;
      return PrinterSelection.fromJson(Map<String, dynamic>.from(raw));
    } catch (_) {
      return null;
    }
  }

  Future<void> write(PrinterSelection selection) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode(selection.toJson()));
  }

  Future<void> clear() async {
    try {
      final file = await _file();
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Non-fatal.
    }
  }
}
