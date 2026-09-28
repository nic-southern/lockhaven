import "package:flutter/material.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/screens/add_asset_screen.dart";
import "package:lockhaven_field/screens/asset_detail_screen.dart";
import "package:lockhaven_field/state/app_state.dart";

class SiteAssetsScreen extends StatefulWidget {
  const SiteAssetsScreen({
    super.key,
    required this.state,
    required this.site,
  });

  final AppState state;
  final SiteSummary site;

  @override
  State<SiteAssetsScreen> createState() => _SiteAssetsScreenState();
}

class _SiteAssetsScreenState extends State<SiteAssetsScreen> {
  List<AssetSummary> assets = const [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final rows =
          await widget.state.client.listAssetsForSite(widget.site.id);
      if (!mounted) return;
      setState(() {
        assets = rows;
        loading = false;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        loading = false;
        error = err.toString();
      });
    }
  }

  Future<void> _openAdd({required bool asContainer}) async {
    final outcome = await Navigator.of(context).push<AddAssetOutcome>(
      MaterialPageRoute(
        builder: (_) => AddAssetScreen(
          state: widget.state,
          site: widget.site,
          asContainer: asContainer,
        ),
      ),
    );
    if (!mounted) return;
    await _load();
    if (!mounted) return;
    if (outcome != null && outcome.asset.isContainer) {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => AssetDetailScreen(
            state: widget.state,
            assetId: outcome.asset.id,
            site: widget.site,
          ),
        ),
      );
      if (mounted) await _load();
    }
  }

  void _showAddSheet() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.memory_outlined),
                title: const Text("Add asset"),
                subtitle: const Text("Scan serial, save, print label"),
                onTap: () {
                  Navigator.pop(context);
                  _openAdd(asContainer: false);
                },
              ),
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: const Text("Add folder"),
                subtitle: const Text("Cabinet, TRT, kiosk — then fill it"),
                onTap: () {
                  Navigator.pop(context);
                  _openAdd(asContainer: true);
                },
              ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final folders = assets.where((a) => a.isContainer).toList();
    final items = assets.where((a) => !a.isContainer).toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.site.name),
        actions: [
          IconButton(
            tooltip: "Refresh",
            onPressed: loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showAddSheet,
        icon: const Icon(Icons.add),
        label: const Text("Add"),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Text(error!))
              : assets.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text(
                          "Nothing at this site yet.\nAdd a folder for a cabinet or TRT, or add an asset directly.",
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                color: Theme.of(context)
                                    .colorScheme
                                    .onSurfaceVariant,
                              ),
                        ),
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                      children: [
                        if (folders.isNotEmpty) ...[
                          Text(
                            "Folders",
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 4),
                          ...folders.map(_tile),
                          const SizedBox(height: 16),
                        ],
                        if (items.isNotEmpty) ...[
                          Text(
                            folders.isEmpty ? "Assets" : "Assets (not in a folder)",
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 4),
                          ...items.map(_tile),
                        ],
                      ],
                    ),
    );
  }

  Widget _tile(AssetSummary asset) {
    return ListTile(
      leading: Icon(
        asset.isContainer
            ? Icons.inventory_2_outlined
            : Icons.memory_outlined,
      ),
      title: Text(asset.title),
      subtitle: Text("${asset.tag} · ${asset.subtitle}"),
      onTap: () async {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => AssetDetailScreen(
              state: widget.state,
              assetId: asset.id,
              site: widget.site,
            ),
          ),
        );
        await _load();
      },
    );
  }
}
