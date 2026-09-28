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

  @override
  Widget build(BuildContext context) {
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
        onPressed: () async {
          final created = await Navigator.of(context).push<AssetSummary>(
            MaterialPageRoute(
              builder: (_) => AddAssetScreen(
                state: widget.state,
                site: widget.site,
              ),
            ),
          );
          if (created != null) {
            await _load();
          }
        },
        icon: const Icon(Icons.add),
        label: const Text("Add asset"),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Text(error!))
              : assets.isEmpty
                  ? const Center(child: Text("No assets at this site"))
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                      itemCount: assets.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 4),
                      itemBuilder: (context, index) {
                        final asset = assets[index];
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
                      },
                    ),
    );
  }
}
