import "package:flutter/material.dart";
import "package:lockhaven_field/hub/hub_client.dart";
import "package:lockhaven_field/hub/models.dart";
import "package:lockhaven_field/screens/add_asset_screen.dart";
import "package:lockhaven_field/screens/asset_detail_screen.dart";
import "package:lockhaven_field/screens/pick_site_screen.dart";
import "package:lockhaven_field/state/app_state.dart";

class FindScanScreen extends StatefulWidget {
  const FindScanScreen({super.key, required this.state});

  final AppState state;

  @override
  State<FindScanScreen> createState() => _FindScanScreenState();
}

class _FindScanScreenState extends State<FindScanScreen> {
  final controller = TextEditingController();
  final focusNode = FocusNode();
  List<AssetSummary> matches = const [];
  bool searching = false;
  String? message;
  String? lastQuery;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    controller.dispose();
    focusNode.dispose();
    super.dispose();
  }

  Future<void> _search([String? raw]) async {
    final query = (raw ?? controller.text).trim();
    if (query.isEmpty) return;
    setState(() {
      searching = true;
      message = null;
      lastQuery = query;
    });

    try {
      final candidates = scanQueryCandidates(query);
      final found = <String, AssetSummary>{};
      for (final candidate in candidates) {
        final rows = await widget.state.client.searchAssets(candidate);
        for (final row in rows) {
          found[row.id] = row;
        }
      }

      // Prefer exact tag/serial matches first.
      final exact = found.values.where((row) {
        final needle = query.toLowerCase();
        return row.tag.toLowerCase() == needle ||
            (row.serial?.toLowerCase() == needle);
      }).toList();

      final ranked = exact.isNotEmpty ? exact : found.values.toList();

      if (!mounted) return;

      if (ranked.length == 1) {
        setState(() {
          matches = ranked;
          searching = false;
        });
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => AssetDetailScreen(
              state: widget.state,
              assetId: ranked.first.id,
            ),
          ),
        );
        controller.clear();
        focusNode.requestFocus();
        return;
      }

      setState(() {
        matches = ranked;
        searching = false;
        message = ranked.isEmpty ? "No match for that scan." : null;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        searching = false;
        message = err is HubException ? err.message : "Search failed.";
      });
    }
  }

  Future<void> _offerAdd(String serialHint) async {
    if (widget.state.sites.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Choose a site after signing in.")),
      );
      return;
    }

    final site = await Navigator.of(context).push<SiteSummary>(
      MaterialPageRoute(
        builder: (_) => PickSiteScreen(
          state: widget.state,
          title: "Add asset to site",
        ),
      ),
    );
    if (site == null || !mounted) return;

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AddAssetScreen(
          state: widget.state,
          site: site,
          initialSerial: serialHint,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Find by scan")),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              "Point a keyboard scanner here, or paste a tracking tag or serial.",
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              focusNode: focusNode,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: "Scan",
                hintText: "Waiting for scan…",
                prefixIcon: Icon(Icons.qr_code_scanner),
              ),
              textInputAction: TextInputAction.search,
              onSubmitted: _search,
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: searching ? null : () => _search(),
              child: searching
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text("Search"),
            ),
            if (message != null) ...[
              const SizedBox(height: 16),
              Text(message!),
              if (lastQuery != null) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () => _offerAdd(lastQuery!),
                  child: const Text("Add asset with this serial"),
                ),
              ],
            ],
            const SizedBox(height: 16),
            Expanded(
              child: ListView.separated(
                itemCount: matches.length,
                separatorBuilder: (_, _) => const SizedBox(height: 4),
                itemBuilder: (context, index) {
                  final asset = matches[index];
                  return ListTile(
                    leading: Icon(
                      asset.isContainer
                          ? Icons.inventory_2_outlined
                          : Icons.memory_outlined,
                    ),
                    title: Text(asset.title),
                    subtitle: Text(
                      [
                        asset.tag,
                        if (asset.siteName != null) asset.siteName!,
                        asset.subtitle,
                      ].join(" · "),
                    ),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => AssetDetailScreen(
                            state: widget.state,
                            assetId: asset.id,
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
