import WidgetKit
import SwiftUI

@main
struct DayGlanceWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpNextWidget()
        GoalWidget()
        ProjectWidget()
    }
}
