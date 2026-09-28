import "package:flutter/material.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";
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
  bool saving = false;
  String? error;
  int attempt = 0;

  @override
  void initState() {
    super.initState();
    if (widget.initialSerial != null) {
      serialController.text = widget.initialSerial!;
    }
    serialController.addListener(_onSerialChanged);
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

  Future<void> _suggestTag() async {
    try {
      final tag = await widget.state.client.suggestTag(
        organizationId: widget.site.organizationId,
        siteId: widget.site.id,
        serial: serialController.text.trim().isEmpty
            ? null
            : serialController.text.trim(),
        attempt: attempt,
      );
      if (!mounted || tagTouched) return;
      setState(() => tagController.text = tag);
    } catch (_) {
      // Operator can still type a tag.
    }
  }

  void _onSerialChanged() {
    if (!tagTouched) {
      _suggestTag();
    }
  }

  Future<void> _save() async {
    final tag = tagController.text.trim();
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
          _suggestTag();
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
            decoration: const InputDecoration(labelText: "Tracking tag"),
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
