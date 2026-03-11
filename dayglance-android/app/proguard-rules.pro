# dayGLANCE ProGuard rules

# Keep AppWidgetProvider subclasses (referenced by name in AndroidManifest.xml)
-keep public class com.dayglance.app.widget.** { *; }

# Keep WorkManager worker classes (referenced by class name internally)
-keep class com.dayglance.app.widget.WidgetUpdateWorker { *; }

# Keep BroadcastReceiver subclasses
-keep public class com.dayglance.app.notifications.** { *; }

# Keep Health Connect classes (alpha SDK; some classes may be obfuscated otherwise)
-keep class androidx.health.connect.** { *; }

# Keep Room entities and DAOs if added in the future
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao class * { *; }
-keep @androidx.room.Database class * { *; }

# Standard Android rules
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
