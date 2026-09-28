import "package:flutter/material.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/screens/asset_search_screen.dart";
import "package:lockhaven_field/screens/set_site_screen.dart";
import "package:lockhaven_field/state/app_state.dart";

/// Full-page asset / container detail (never a sidebar sheet).
class AssetDetailScreen extends StatefulWidget {
  const AssetDetailScreen({
    super.key,
    required this.state,
    required this.assetId,
    this.site,
  });

  final AppState state;
  final String assetId;
  final SiteSummary? site;

  @override
  State<AssetDetailScreen> createState() => _AssetDetailScreenState();
}

class _AssetDetailScreenState extends State<AssetDetailScreen> {
  AssetSummary? asset;
  List<AssetSummary> children = const [];
  bool loading = true;
  bool saving = false;
  String? error;

  late final TextEditingController nameController;
  late final TextEditingController serialController;
  late final TextEditingController hostnameController;
  late final TextEditingController vendorController;
  late final TextEditingController modelController;
  late final TextEditingController notesController;
  String status = "in_service";

  @override
  void initState() {
    super.initState();
    nameController = TextEditingController();
    serialController = TextEditingController();
    hostnameController = TextEditingController();
    vendorController = TextEditingController();
    modelController = TextEditingController();
    notesController = TextEditingController();
    _load();
  }

  @override
  void dispose() {
    nameController.dispose();
    serialController.dispose();
    hostnameController.dispose();
    vendorController.dispose();
    modelController.dispose();
    notesController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final row = await widget.state.client.assetById(widget.assetId);
      if (row == null) {
        throw HubException("Asset was not found.");
      }
      List<AssetSummary> kids = const [];
      if (row.isContainer) {
        kids = await widget.state.client.folderChildren(row.id);
      }
      if (!mounted) return;
      setState(() {
        asset = row;
        children = kids;
        nameController.text = row.name ?? "";
        serialController.text = row.serial ?? "";
        hostnameController.text = row.hostname ?? "";
        vendorController.text = row.vendor ?? "";
        modelController.text = row.model ?? "";
        notesController.text = row.notes ?? "";
        status = row.status ?? "in_service";
        loading = false;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        loading = false;
        error = err is HubException
            ? err.message
            : "This asset could not be loaded.";
      });
    }
  }

  Future<void> _save() async {
    final current = asset;
    if (current == null) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final fields = <String, dynamic>{
        "serial": serialController.text.trim().isEmpty
            ? null
            : serialController.text.trim(),
        "hostname": hostnameController.text.trim().isEmpty
            ? null
            : hostnameController.text.trim(),
        "vendor": vendorController.text.trim().isEmpty
            ? null
            : vendorController.text.trim(),
        "model": modelController.text.trim().isEmpty
            ? null
            : modelController.text.trim(),
        "notes": notesController.text.trim().isEmpty
            ? null
            : notesController.text.trim(),
        "status": status,
      };
      final name = nameController.text.trim();
      if (name.isNotEmpty || current.name != null) {
        fields["name"] = name.isEmpty ? null : name;
      }
      final updated = await widget.state.client.updateAsset(current.id, fields);
      if (!mounted) return;
      setState(() {
        asset = updated;
        saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Saved")),
      );
    } catch (err) {
      if (!mounted) return;
      setState(() {
        saving = false;
        error = err is HubException ? err.message : "Could not save.";
      });
    }
  }

  Future<void> _openSetSite() async {
    final current = asset;
    if (current == null) return;
    final site = await Navigator.of(context).push<SiteSummary>(
      MaterialPageRoute(
        builder: (_) => SetSiteScreen(
          state: widget.state,
          organizationId: current.organizationId,
          currentSiteId: current.siteId,
          isContainer: current.isContainer,
        ),
      ),
    );
    if (site == null) return;
    setState(() => saving = true);
    try {
      final updated = await widget.state.client.updateAsset(current.id, {
        "siteId": site.id,
      });
      if (!mounted) return;
      setState(() {
        asset = updated;
        saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            current.isContainer
                ? "Site set. Contained items follow this container."
                : "Site updated.",
          ),
        ),
      );
      await _load();
    } catch (err) {
      if (!mounted) return;
      setState(() {
        saving = false;
        error = err is HubException ? err.message : "Could not set site.";
      });
    }
  }

  Future<void> _openReassignContainer() async {
    final current = asset;
    if (current == null || current.isContainer) return;

    final choice = await Navigator.of(context).push<AssetSearchResult>(
      MaterialPageRoute(
        builder: (_) => AssetSearchScreen(
          state: widget.state,
          title: "Move into container",
          subtitle: "Search by tag, serial, or name. Or stand alone.",
          containersOnly: true,
          allowStandAlone: true,
          excludeAssetId: current.id,
        ),
      ),
    );
    if (choice == null) return;

    setState(() => saving = true);
    try {
      final updated = await widget.state.client.setParent(
        childAssetId: current.id,
        parentAssetId: choice.standAlone ? null : choice.asset?.id,
      );
      if (!mounted) return;
      setState(() {
        asset = updated;
        saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Container updated")),
      );
      await _load();
    } catch (err) {
      if (!mounted) return;
      setState(() {
        saving = false;
        error =
            err is HubException ? err.message : "Could not update container.";
      });
    }
  }

  Future<void> _openAddToContainer() async {
    final current = asset;
    if (current == null || !current.isContainer) return;

    final choice = await Navigator.of(context).push<AssetSearchResult>(
      MaterialPageRoute(
        builder: (_) => AssetSearchScreen(
          state: widget.state,
          title: "Add to container",
          subtitle: "Search by tag, serial, or name.",
          itemsOnly: true,
          excludeAssetId: current.id,
        ),
      ),
    );
    if (choice?.asset == null) return;

    setState(() => saving = true);
    try {
      await widget.state.client.setParent(
        childAssetId: choice!.asset!.id,
        parentAssetId: current.id,
      );
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Added to container")),
      );
      await _load();
    } catch (err) {
      if (!mounted) return;
      setState(() {
        saving = false;
        error = err is HubException ? err.message : "Could not add item.";
      });
    }
  }

  Future<void> _removeChild(AssetSummary child) async {
    setState(() => saving = true);
    try {
      await widget.state.client.setParent(
        childAssetId: child.id,
        parentAssetId: null,
      );
      if (!mounted) return;
      setState(() => saving = false);
      await _load();
    } catch (err) {
      if (!mounted) return;
      setState(() {
        saving = false;
        error = err is HubException ? err.message : "Could not remove item.";
      });
    }
  }

  void _openAsset(String assetId) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AssetDetailScreen(
          state: widget.state,
          assetId: assetId,
          site: widget.site,
        ),
      ),
    ).then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final current = asset;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          current == null
              ? "Asset"
              : current.isContainer
                  ? "Container"
                  : "Asset",
        ),
        actions: [
          if (current != null && !current.isContainer)
            TextButton(
              onPressed: saving ? null : _openReassignContainer,
              child: const Text("Container"),
            ),
          TextButton(
            onPressed: saving ? null : _save,
            child: saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text("Save"),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : current == null
              ? Center(child: Text(error ?? "Not found"))
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (current.isContainer)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          "Container",
                          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                                color: scheme.primary,
                              ),
                        ),
                      ),
                    Text(
                      current.title,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      current.tag,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                    ),
                    if (current.siteName != null) ...[
                      const SizedBox(height: 4),
                      Text("Site: ${current.siteName}"),
                    ],
                    if (current.parentTag != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        "In: ${current.parentName ?? current.parentTag}",
                      ),
                    ],
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: saving ? null : _openSetSite,
                      icon: const Icon(Icons.place_outlined),
                      label: Text(
                        current.isContainer
                            ? "Set site (moves contents)"
                            : "Set site",
                      ),
                    ),
                    const SizedBox(height: 20),
                    TextField(
                      controller: nameController,
                      decoration: const InputDecoration(
                        labelText: "Name",
                        hintText: "How this asset is known on the floor",
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: serialController,
                      decoration: const InputDecoration(labelText: "Serial"),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: hostnameController,
                      decoration: const InputDecoration(labelText: "Hostname"),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: vendorController,
                      decoration: const InputDecoration(labelText: "Vendor"),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: modelController,
                      decoration: const InputDecoration(labelText: "Model"),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      // ignore: deprecated_member_use
                      value: status,
                      decoration: const InputDecoration(labelText: "Status"),
                      items: const [
                        DropdownMenuItem(
                          value: "stock",
                          child: Text("Stock"),
                        ),
                        DropdownMenuItem(
                          value: "in_service",
                          child: Text("In service"),
                        ),
                        DropdownMenuItem(
                          value: "repair",
                          child: Text("Repair"),
                        ),
                        DropdownMenuItem(
                          value: "retired",
                          child: Text("Retired"),
                        ),
                        DropdownMenuItem(
                          value: "lost",
                          child: Text("Lost"),
                        ),
                        DropdownMenuItem(
                          value: "disposed",
                          child: Text("Disposed"),
                        ),
                      ],
                      onChanged: (value) {
                        if (value != null) setState(() => status = value);
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: notesController,
                      decoration: const InputDecoration(labelText: "Notes"),
                      maxLines: 3,
                    ),
                    if (current.isContainer) ...[
                      const SizedBox(height: 28),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              "Contents",
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ),
                          FilledButton.tonalIcon(
                            onPressed: saving ? null : _openAddToContainer,
                            icon: const Icon(Icons.search),
                            label: const Text("Add"),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "Label print and CSV export stay on the laptop helper for now.",
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                      ),
                      const SizedBox(height: 12),
                      if (children.isEmpty)
                        const Text("No items in this container")
                      else
                        ...children.map(
                          (child) => ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: Icon(
                              child.isContainer
                                  ? Icons.inventory_2_outlined
                                  : Icons.memory_outlined,
                            ),
                            title: Text(child.title),
                            subtitle: Text(child.tag),
                            trailing: IconButton(
                              tooltip: "Remove",
                              onPressed:
                                  saving ? null : () => _removeChild(child),
                              icon: const Icon(Icons.link_off),
                            ),
                            onTap: () => _openAsset(child.id),
                          ),
                        ),
                    ],
                    if (error != null) ...[
                      const SizedBox(height: 16),
                      Text(
                        error!,
                        style: TextStyle(color: scheme.error),
                      ),
                    ],
                  ],
                ),
    );
  }
}
