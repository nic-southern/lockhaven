import "package:material_ui/material_ui.dart";
import "package:lockhaven_field/app.dart";
import "package:lockhaven_field/state/app_state.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState();
  await state.bootstrap();
  runApp(FieldApp(state: state));
}
