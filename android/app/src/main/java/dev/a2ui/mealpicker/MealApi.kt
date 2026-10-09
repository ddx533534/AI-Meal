package dev.a2ui.mealpicker

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.io.ByteArrayOutputStream
import android.util.Log

class ApiError(val status: Int, val code: String, val payload: JSONObject) : Exception(code)
class MealApi(private val settings: ConnectionSettings) {
    init {
        val uri = URI(settings.url)
        require(uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/"))
        require(uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http" && uri.host in listOf("localhost", "127.0.0.1", "10.0.2.2")))
        require(settings.token.isNotBlank() && !settings.token.contains('\n') && !settings.token.contains('\r'))
    }
    suspend fun request(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL(settings.url.trimEnd('/') + "/api/meal-picker/" + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = 15000
            connection.readTimeout = 55000
            connection.setRequestProperty("Authorization", "Bearer ${settings.token}")
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= 512000) { "RESPONSE_TOO_LARGE" }
                    output.write(buffer, 0, count)
                }
                output.toString("UTF-8")
            } ?: "{}"
            val result = try { JSONObject(raw) } catch (e: Exception) {
                if (status in 200..299) throw e
                JSONObject().put("error", "HTTP_ERROR")
            }
            if (status !in 200..299) {
                val code = result.optString("error", "HTTP_ERROR").takeIf { it.matches(Regex("[A-Z0-9_]{1,64}")) } ?: "HTTP_ERROR"
                val reason = result.optString("reason").takeIf { it.matches(Regex("[A-Z0-9_]{1,64}")) } ?: "UNKNOWN"
                Log.w("MealApi", "request=${path.substringBefore('?')} status=$status code=$code reason=$reason")
                throw ApiError(status, code, result)
            }
            result
        } finally { connection.disconnect() }
    }
}
