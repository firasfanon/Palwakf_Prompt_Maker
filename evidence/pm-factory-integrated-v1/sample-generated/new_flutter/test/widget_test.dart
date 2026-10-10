import 'package:flutter_test/flutter_test.dart';
import 'package:clinic_booking/app/app.dart';

void main() {
  testWidgets('يبني التطبيق دون أخطاء', (tester) async {
    await tester.pumpWidget(const ClinicBookingApp());
    expect(find.byType(ClinicBookingApp), findsOneWidget);
  });
}
