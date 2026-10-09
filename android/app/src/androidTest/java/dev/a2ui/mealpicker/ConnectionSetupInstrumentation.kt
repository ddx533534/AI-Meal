package dev.a2ui.mealpicker

import android.app.Instrumentation
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import org.json.JSONObject
import java.io.File

/** Test APK only: credentials arrive through run-as stdin, never process args. */
class ConnectionSetupInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val input = File(targetContext.filesDir, "verification-input.json")
        try {
            val data = JSONObject(input.readText())
            data.optJSONObject("connection")?.let { c ->
                SettingsStore(targetContext).save(ConnectionSettings(c.getString("url"), c.getString("token"), c.optString("sessionId").takeIf { it.isNotEmpty() }))
            }
            if (data.has("clipboard")) runOnMainSync {
                (targetContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("verification", data.getString("clipboard")))
            }
            input.delete()
            finish(0, Bundle().apply { putString("result", "configured") })
        } catch (_: Exception) {
            input.delete()
            finish(1, Bundle().apply { putString("result", "configuration_failed") })
        }
    }
}
