import "package:flutter/material.dart";
import "package:google_fonts/google_fonts.dart";
import "package:lockhaven_field/screens/home_shell.dart";
import "package:lockhaven_field/screens/sign_in_screen.dart";
import "package:lockhaven_field/state/app_state.dart";
import "package:lockhaven_field/theme.dart";

class FieldApp extends StatelessWidget {
  const FieldApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        return MaterialApp(
          title: "Lockhaven Field",
          debugShowCheckedModeBanner: false,
          theme: buildFieldTheme(Brightness.light),
          darkTheme: buildFieldTheme(Brightness.dark),
          themeMode: ThemeMode.system,
          home: state.isSignedIn
              ? HomeShell(state: state)
              : SignInScreen(state: state),
        );
      },
    );
  }
}

ThemeData buildFieldTheme(Brightness brightness) {
  final base = fieldColorScheme(brightness);
  final textTheme = GoogleFonts.sourceSans3TextTheme().apply(
    bodyColor: base.onSurface,
    displayColor: base.onSurface,
  );
  final display = GoogleFonts.ibmPlexSans(
    fontWeight: FontWeight.w600,
    letterSpacing: -0.4,
    color: base.onSurface,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: base,
    scaffoldBackgroundColor: base.surface,
    textTheme: textTheme.copyWith(
      headlineLarge: display.copyWith(fontSize: 32),
      headlineMedium: display.copyWith(fontSize: 26),
      headlineSmall: display.copyWith(fontSize: 22),
      titleLarge: display.copyWith(fontSize: 20),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: base.surface,
      foregroundColor: base.onSurface,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      titleTextStyle: display.copyWith(fontSize: 18),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: base.surfaceContainerHighest.withValues(alpha: 0.45),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: base.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: base.primary, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(120, 44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    listTileTheme: ListTileThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
  );
}
