import 'package:flutter/material.dart';
import 'scan_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const EmptyBottleApp());
}

class EmptyBottleApp extends StatelessWidget {
  const EmptyBottleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '공병 입고 확인 V26',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF1F4B5F),
        scaffoldBackgroundColor: const Color(0xFFF6F5F1),
      ),
      home: const ScanScreen(),
    );
  }
}
