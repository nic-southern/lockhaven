import "package:flutter/material.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/hub/tracking_tag.dart";
import "package:lockhaven_field/labels/label_print_service.dart";
import "package:lockhaven_field/state/app_state.dart";

/// What happened after a successful add — caller can stay in a scan loop.
class AddAssetOutcome {
  const AddAssetOutcome({
    required this.asset,
    required this.printed,
    this.printMessage,
  });

  final AssetSummary asset;
  final bool printed;
  final String? printMessage;
}

class AddAssetScreen extends StatefulWidget {
  const AddAssetScreen({
    super.key,
    required this.state,
    required this.site,
    this.initialSerial,
    this.parentAsset,
    this.asContainer = false,
  });

  final AppState state;
  final SiteSummary site;
  final String? initialSerial;

  /// When set, new items are created inside this folder.
  final AssetSummary? parentAsset;

  /// True to create a folder (cabinet / TRT / …) instead of an item.
  final bool asContainer;

  @override
  State<AddAssetScreen> createState() => _AddAssetScreenState();
}

class _AddAssetScreenState extends State<AddAssetScreen> {
  final serialController = TextEditingController();
  final tagController = TextEditingController();
  final nameController = TextEditingController();
  final hostnameController = TextEditingController();
  final notesController = TextEditingController();
  final serialFocus = FocusNode();
  final nameFocus = FocusNode();

  bool tagTouched = false;
  bool suggesting = false;
  bool saving = false;
  String? error;
  String? statusMessage;
  int attempt = 0;
  String prefix = defaultTrackingTagPrefix;
  int savedCount = 0;

  bool get isContainer => widget.asContainer;
  bool get underFolder => widget.parentAsset != null && !isContainer;

  @override
  void initState() {
    super.initState();
    if (widget.initialSerial != null) {
      serialController.text = widget.initialSerial!;
    }
    serialController.addListener(_onSerialChanged);
    final org = widget.state.orgFor(widget.site.organizationId);
    if (org != null) {
      prefix = normalizeTrackingTagPrefix(org.trackingTagPrefix);
    }
    _suggestTag();
  }

  @override
  void dispose() {
    serialController.dispose();
    tagController.dispose();
    nameController.dispose();
    hostnameController.dispose();
    notesController.dispose();
    serialFocus.dispose();
    nameFocus.dispose();
    super.dispose();
  }

  String _localSuggestion() {
    return suggestAssetTrackingTag(
      deviceId: widget.site.id,
      serialNumber: serialController.text.trim().isEmpty
          ? null
          : serialController.text.trim(),
      hostname: isContainer
          ? (nameController.text.trim().isEmpty
              ? null
              : nameController.text.trim())
          : (hostnameController.text.trim().isEmpty
              ? null
              : hostnameController.text.trim()),
      attempt: attempt,
      prefix: prefix,
    );
  }

  Future<void> _suggestTag({bool force = false}) async {
    if (tagTouched && !force) return;
    setState(() => suggesting = true);
    try {
      final remote = await widget.state.client.suggestTag(
        organizationId: widget.site.organizationId,
        siteId: widget.site.id,
        serial: serialController.text.trim().isEmpty
            ? null
            : serialController.text.trim(),
        attempt: attempt,
      );
      if (!mounted) return;
      if (remote.isNotEmpty) {
        setState(() {
          tagController.text = remote;
          tagTouched = false;
          suggesting = false;
        });
        return;
      }
    } catch (_) {
      // Fall back to local suggestion matching Hub rules.
    }
    if (!mounted) return;
    setState(() {
      tagController.text = _localSuggestion();
      tagTouched = false;
      suggesting = false;
    });
  }

  void _onSerialChanged() {
    if (!tagTouched) {
      _suggestTag();
    }
  }

  Future<void> _regenerateTag() async {
    setState(() {
      attempt += 1;
      tagTouched = false;
    });
    await _suggestTag(force: true);
  }

  void _resetForNext() {
    serialController.clear();
    hostnameController.clear();
    notesController.clear();
    if (isContainer) {
      nameController.clear();
    }
    tagTouched = false;
    attempt += 1;
    error = null;
    _suggestTag(force: true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (isContainer) {
        nameFocus.requestFocus();
      } else {
        serialFocus.requestFocus();
      }
    });
  }

  Future<void> _save({required bool printLabel}) async {
    var tag = tagController.text.trim();
    if (tag.isEmpty) {
      tag = _localSuggestion();
      tagController.text = tag;
    }
    if (tag.isEmpty) {
      setState(() => error = "Tracking tag is required.");
      return;
    }
    if (isContainer && nameController.text.trim().isEmpty) {
      setState(() => error = "Give the folder a name (cabinet, TRT, …).");
      return;
    }

    setState(() {
      saving = true;
      error = null;
      statusMessage = null;
    });

    try {
      final AssetSummary created;
      if (isContainer) {
        created = await widget.state.client.createFolder(
          organizationId: widget.site.organizationId,
          siteId: widget.site.id,
          tag: tag,
          hostname: nameController.text.trim(),
          notes: notesController.text.trim().isEmpty
              ? null
              : notesController.text.trim(),
        );
      } else {
        created = await widget.state.client.createAsset(
          organizationId: widget.site.organizationId,
          siteId: widget.site.id,
          tag: tag,
          serial: serialController.text.trim().isEmpty
              ? null
              : serialController.text.trim(),
          hostname: hostnameController.text.trim().isEmpty
              ? null
              : hostnameController.text.trim(),
          notes: notesController.text.trim().isEmpty
              ? null
              : notesController.text.trim(),
          parentAssetId: widget.parentAsset?.id,
        );
      }

      String? printMessage;
      var printed = false;
      if (printLabel) {
        final org = widget.state.orgFor(widget.site.organizationId);
        final printService = LabelPrintService(config: widget.state.config);
        final result = await printService.printAssetLabel(
          asset: created,
          companyName: org?.name,
          siteName: widget.site.name,
        );
        printed = result.path != LabelPrintPath.csvOnly;
        printMessage = result.message;
      }

      if (!mounted) return;

      savedCount += 1;
      final outcome = AddAssetOutcome(
        asset: created,
        printed: printed,
        printMessage: printMessage,
      );

      // Folders: open the folder so the tech can scan items in immediately.
      if (isContainer) {
        Navigator.of(context).pop(outcome);
        return;
      }

      // Items: stay on this screen for the next serial (audit loop).
      setState(() {
        saving = false;
        statusMessage = printLabel
            ? "Saved ${created.tag}${printMessage != null ? " · $printMessage" : ""}. Scan the next serial."
            : "Saved ${created.tag}. Scan the next serial.";
      });
      _resetForNext();

      // Keep outcome available if the user pops later.
      // Caller refreshes from pop(null) or when navigating back with last asset.
      // Store last outcome via a soft return when Done is pressed.
      _lastOutcome = outcome;
    } catch (err) {
      if (!mounted) return;
      setState(() {
        saving = false;
        error = err is HubException
            ? err.message
            : (isContainer
                ? "Could not add the folder."
                : "Could not add the asset.");
        if (error!.toLowerCase().contains("already exists")) {
          attempt += 1;
          tagTouched = false;
          _suggestTag(force: true);
        }
      });
    }
  }

  AddAssetOutcome? _lastOutcome;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final title = isContainer
        ? "Add folder"
        : underFolder
            ? "Add to ${widget.parentAsset!.title}"
            : "Add asset";
    final hint = isContainer
        ? "Name the cabinet, TRT, or other enclosure, then print its tag."
        : underFolder
            ? "Scan serial → save (and print) → stick the label → next."
            : "Serial first — scan or type, then save or save & print.";

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        Navigator.of(context).pop(_lastOutcome);
      },
      child: Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          if (savedCount > 0)
            TextButton(
              onPressed: () => Navigator.of(context).pop(_lastOutcome),
              child: Text("Done ($savedCount)"),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 120),
        children: [
          Text(
            hint,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
          ),
          if (underFolder) ...[
            const SizedBox(height: 12),
            Material(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
              child: ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: Text(widget.parentAsset!.title),
                subtitle: Text(widget.parentAsset!.tag),
              ),
            ),
          ],
          const SizedBox(height: 20),
          if (isContainer) ...[
            TextField(
              controller: nameController,
              focusNode: nameFocus,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: "Name",
                hintText: "Front cabinet, TRT-3, …",
              ),
              textInputAction: TextInputAction.next,
              onChanged: (_) {
                if (!tagTouched) _suggestTag();
              },
            ),
            const SizedBox(height: 12),
          ] else ...[
            TextField(
              controller: serialController,
              focusNode: serialFocus,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: "Serial",
                hintText: "Scan or type serial",
              ),
              textInputAction: TextInputAction.next,
              onSubmitted: (_) {
                if (!saving) _save(printLabel: true);
              },
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: tagController,
            decoration: InputDecoration(
              labelText: "Tracking tag",
              suffixIcon: IconButton(
                tooltip: "Generate another tag",
                onPressed: suggesting || saving ? null : _regenerateTag,
                icon: suggesting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
              ),
            ),
            onChanged: (_) => tagTouched = true,
          ),
          if (!isContainer) ...[
            const SizedBox(height: 12),
            TextField(
              controller: hostnameController,
              decoration: const InputDecoration(labelText: "Hostname"),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: notesController,
            decoration: const InputDecoration(labelText: "Notes"),
            maxLines: 2,
          ),
          if (statusMessage != null) ...[
            const SizedBox(height: 16),
            Text(
              statusMessage!,
              style: TextStyle(color: scheme.primary),
            ),
          ],
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(
              error!,
              style: TextStyle(color: scheme.error),
            ),
          ],
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: saving ? null : () => _save(printLabel: false),
                  child: Text(isContainer ? "Save folder" : "Save"),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  onPressed: saving ? null : () => _save(printLabel: true),
                  icon: saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.print_outlined),
                  label: Text(
                    isContainer ? "Save & print" : "Save & print",
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
    );
  }
}
