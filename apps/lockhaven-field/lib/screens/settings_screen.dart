import "package:flutter/material.dart";
import "package:lockhaven_field/config.dart";
import "package:lockhaven_field/labels/printer_store.dart";
import "package:lockhaven_field/labels/usb_printer_catalog.dart";
import "package:lockhaven_field/labels/usb_printers.dart";

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.config,
    this.store,
    this.catalog,
  });

  final FieldConfig config;
  final PrinterStore? store;
  final UsbPrinterCatalog? catalog;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final PrinterStore store;
  late final UsbPrinterCatalog catalog;
  PrinterScanResult? scan;
  PrinterSelection? selected;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    store = widget.store ?? PrinterStore();
    catalog = widget.catalog ?? UsbPrinterCatalog(config: widget.config);
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    final saved = await store.read();
    final result = await catalog.scan();
    if (!mounted) return;
    setState(() {
      selected = saved;
      scan = result;
      loading = false;
    });
  }

  Future<void> _select(UsbDeviceRow row) async {
    if (!row.tapeCompatible) return;
    final next = PrinterSelection.fromDevice(row);
    await store.write(next);
    if (!mounted) return;
    setState(() => selected = next);
  }

  bool _isSelected(UsbDeviceRow row) {
    final current = selected;
    if (current == null) return false;
    if (current.id == row.id) return true;
    if (current.usbSerial != null &&
        row.usbSerial != null &&
        current.usbSerial == row.usbSerial) {
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final result = scan;

    return Scaffold(
      appBar: AppBar(
        title: const Text("Settings"),
        actions: [
          IconButton(
            tooltip: "Refresh",
            onPressed: loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: loading && result == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                Text(
                  "Label printer",
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 6),
                Text(
                  "Choose which printer Field uses for labels.",
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 16),
                if (result?.tapeStatus != null) ...[
                  Text(
                    "Tape: ${result!.tapeStatus}",
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 12),
                ],
                if (result?.message != null)
                  _StatusCard(
                    text: result!.message!,
                    error:
                        result.helperMissing ||
                        result.permissionDenied ||
                        !result.usbPrintSupported,
                  ),
                if (result != null &&
                    result.usbPrintSupported &&
                    result.devices.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ...result.devices.map((row) {
                    final chosen = _isSelected(row);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Material(
                        color: chosen
                            ? scheme.primaryContainer.withValues(alpha: 0.55)
                            : scheme.surfaceContainerHighest.withValues(
                                alpha: 0.35,
                              ),
                        borderRadius: BorderRadius.circular(12),
                        child: ListTile(
                          leading: Icon(
                            row.tapeCompatible
                                ? Icons.print_outlined
                                : Icons.devices_other_outlined,
                            color: row.tapeCompatible
                                ? scheme.primary
                                : scheme.onSurfaceVariant,
                          ),
                          title: Text(row.title),
                          subtitle: Text(
                            [
                              row.subtitle,
                              if (row.tapeCompatible) "Compatible",
                              if (chosen) "Selected",
                            ].where((s) => s.isNotEmpty).join(" · "),
                          ),
                          enabled: row.tapeCompatible,
                          selected: chosen,
                          onTap: row.tapeCompatible ? () => _select(row) : null,
                          trailing: row.tapeCompatible
                              ? Icon(
                                  chosen
                                      ? Icons.check_circle
                                      : Icons.circle_outlined,
                                  color: chosen
                                      ? scheme.primary
                                      : scheme.outline,
                                )
                              : null,
                        ),
                      ),
                    );
                  }),
                ],
              ],
            ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.text, required this.error});

  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: (error ? scheme.errorContainer : scheme.surfaceContainerHighest)
            .withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: error ? scheme.onErrorContainer : scheme.onSurface,
        ),
      ),
    );
  }
}
