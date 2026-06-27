import WidgetKit
import SwiftUI

@main
struct DayGlanceWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpNextWidget()
        GoalWidget()
        ProjectWidget()
        // Control Center controls — iOS 18+ only (the Controls API doesn't exist
        // before then). Mirror the Home Screen Quick Actions.
        if #available(iOS 18.0, *) {
            AddScheduledTaskControl()
            AddInboxTaskControl()
            VoiceInputControl()
        }
    }
}
