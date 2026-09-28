import "package:flutter/material.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/hub/tracking_tag.dart";
import "package:lockhaven_field/state/app_state.dart";

class AddAssetScreen extends StatefulWidget {
  const AddAssetScreen({
    super.key,
    required this.state,
    required this.site,
    this.initialSerial,
  });

  final AppState state;
  final SiteSummary site;
  final String? initialSerial;

  @override
  State<AddAssetScreen> createState() => _AddAssetScreenState();
}

class _AddAssetScreenState extends State<AddAssetScreen> {
  final serialController = TextEditingController();
  final tagController = TextEditingController();
  final hostnameController = TextEditingController();
  final notesController = TextEditingController();
  bool tagTouched = false;
  bool suggesting = false;
  bool saving = false;
  String? error;
  int attempt = 0;
  String prefix = defaultTrackingTagPrefix;

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
    hostnameController.dispose();
    notesController.dispose();
    super.dispose();
  }

  String _localSuggestion() {
    return suggestAssetTrackingTag(
      deviceId: widget.site.id,
      serialNumber: serialController.text.trim().isEmpty
          ? null
          : serialController.text.trim(),
      hostname: hostnameController.text.trim().isEmpty
          ? null
          : hostnameController.text.trim(),
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

  Future<void> _save() async {
    var tag = tagController.text.trim();
    if (tag.isEmpty) {
      tag = _localSuggestion();
      tagController.text = tag;
    }
    if (tag.isEmpty) {
      setState(() => error = "Tracking tag is required.");
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final created = await widget.state.client.createAsset(
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
      );
      if (!mounted) return;
      Navigator.of(context).pop(created);
    } catch (err) {
      if (!mounted) return;
      setState(() {
        saving = false;
        error = err is HubException ? err.message : "Could not add the asset.";
        if (error!.toLowerCase().contains("already exists")) {
          attempt += 1;
          tagTouched = false;
          _suggestTag(force: true);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Add asset")),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            "Serial first — scan or type, then confirm the tracking tag.",
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: serialController,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: "Serial",
              hintText: "Scan or type serial",
            ),
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: tagController,
            decoration: InputDecoration(
              labelText: "Tracking tag",
              suffixIcon: IconButton(
                tooltip: "Generate another tag",
                onPressed: suggesting ? null : _regenerateTag,
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
          const SizedBox(height: 12),
          TextField(
            controller: hostnameController,
            decoration: const InputDecoration(labelText: "Hostname"),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: notesController,
            decoration: const InputDecoration(labelText: "Notes"),
            maxLines: 3,
          ),
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(
              error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: saving ? null : _save,
            child: saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text("Save"),
          ),
        ],
      ),
    );
  }
}
