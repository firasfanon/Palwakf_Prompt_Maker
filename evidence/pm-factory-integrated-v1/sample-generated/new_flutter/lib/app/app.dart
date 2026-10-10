import 'package:flutter/material.dart';

class ClinicBookingApp extends StatelessWidget {
  const ClinicBookingApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Clinic Booking',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.blue),
      home: const _HomePlaceholder(),
    );
  }
}

class _HomePlaceholder extends StatelessWidget {
  const _HomePlaceholder();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Clinic Booking')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'نقطة البداية — ابدأ ببناء أول ميزة داخل lib/features/\n'
            'راجع docs/ai/TASKS.md لمعرفة المهمة التالية.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
