package com.dayglance.app.widget

import android.content.Intent
import android.widget.RemoteViewsService

/**
 * RemoteViewsService that supplies the scrollable agenda list inside the widget.
 *
 * Android requires a RemoteViewsService to back a widget's ListView. The system
 * binds to this service automatically when the widget needs list items; we hand
 * it a [DayGlanceWidgetListFactory] which reads the stored snapshot and builds
 * one RemoteViews per agenda item.
 */
class DayGlanceWidgetListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        DayGlanceWidgetListFactory(applicationContext)
}
