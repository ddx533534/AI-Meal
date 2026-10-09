package dev.a2ui.mealpicker

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.a2ui.compose.ui.A2uiMessageProcessor
import androidx.a2ui.engine.model.A2uiCoreSurfaceModel
import androidx.a2ui.model.catalog.functions.A2uiLocaleProvider
import androidx.a2ui.model.processor.processInput
import androidx.a2ui.model.protocol.A2uiClientErrorMessage
import androidx.a2ui.model.protocol.A2uiClientEventMessage
import androidx.a2ui.model.protocol.A2uiDataPath
import androidx.compose.material3.Text
import androidx.compose.material3.a2ui.catalog.MaterialA2uiBasicCatalogV1Defaults
import androidx.compose.material3.a2ui.catalog.materialA2uiBasicCatalogV1
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MealViewModel(application: Application) : AndroidViewModel(application) {
    private val store = SettingsStore(application)
    var settings by mutableStateOf(runCatching { store.load() }.getOrDefault(ConnectionSettings())); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var status by mutableStateOf("请配置访问令牌并检查连接"); private set
    var foods by mutableStateOf<List<Food>>(emptyList()); private set
    var stage by mutableStateOf("start"); private set
    var foodsLoaded by mutableStateOf(false); private set
    private var session: JSONObject? = null
    private var retry: (suspend () -> Unit)? = null
    private var components: JSONObject? = null
    private var expanded = false
    private val parser = A2uiMessageParser()
    private val catalog = materialA2uiBasicCatalogV1(
        text = MealText, choicePicker = MealChoicePicker, textField = MealBudgetField, card = MealCard, button = MealButton,
        image = MaterialA2uiBasicCatalogV1Defaults.image { _, _, _, modifier, _ -> Text("当前菜单不包含图片", modifier) },
        video = MaterialA2uiBasicCatalogV1Defaults.video { _, modifier, _ -> Text("当前菜单不包含视频", modifier) },
        audioPlayer = MaterialA2uiBasicCatalogV1Defaults.audioPlayer { _, _, modifier, _ -> Text("当前菜单不包含音频", modifier) },
        urlOpener = { throw IllegalArgumentException("URL_OPEN_NOT_SUPPORTED") },
        messageFormatter = { pattern, _, _ -> pattern },
        localeProvider = A2uiLocaleProvider.Default,
    )
    private val processor = A2uiMessageProcessor(catalogs = listOf(catalog))
    val surfaces = processor.activeSurfaces
    init {
        viewModelScope.launch { processor.collectMessages() }
        viewModelScope.launch(start = CoroutineStart.UNDISPATCHED) {
            processor.outboundEvents.collect { event ->
                when (event) {
                    is A2uiClientEventMessage -> if (event.type == "toggle_more") toggleMore() else dispatch(event)
                    is A2uiClientErrorMessage -> { error = "界面数据无法显示，请重新连接" }
                }
            }
        }
        if (settings.token.isNotBlank()) connect(settings.url, settings.token)
    }
    private fun currentForm(): JSONObject? {
        val model = surfaces.value.firstOrNull() as? A2uiCoreSurfaceModel ?: return null
        val value = model.dataModel[A2uiDataPath("/form")] as? Map<*, *> ?: return null
        return JSONObject(value)
    }
    private fun perform(operation: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null; retry = operation
        viewModelScope.launch {
            try { operation(); retry = null }
            catch (e: CancellationException) { throw e }
            catch (e: ApiError) {
                error = when (e.status) {
                    401 -> "访问令牌无效，请检查连接配置"
                    400 -> "填写内容无效，请检查名称、价格、餐别和预算"
                    404 -> "会话已失效，请重新连接"
                    409 -> { if (e.payload.has("messages")) applyResponse(e.payload); if (e.code == "FOOD_CONFLICT") "这次录入已存在，请返回食物列表检查" else "会话已更新，已载入最新结果，请再操作一次" }
                    502 -> when (e.payload.optString("reason")) {
                        "TIMEOUT" -> "选餐服务响应超时，请重试"
                        "UPSTREAM_HTTP_429", "MODEL_429" -> "选餐服务请求过于频繁，请稍后重试"
                        "UPSTREAM_HTTP_503", "MODEL_503" -> "选餐模型暂时繁忙，请稍后重试"
                        "REQUIRED_TOOL_CALL_MISSING" -> "选餐模型未完成菜单查询，请重试"
                        else -> "选餐服务暂时无法完成请求，请重试"
                    }
                    504 -> "选餐服务响应超时，请重试"
                    503 -> "服务配置尚未就绪，请检查后端"
                    else -> "服务请求失败，请重试"
                }
                if (e.status == 404) { stage = "start"; session = null; settings = settings.copy(sessionId = null); store.save(settings) }
            }
            catch (_: IllegalArgumentException) { error = "请填写有效的 HTTPS 服务地址、访问令牌和条件" }
            catch (_: Exception) { error = "无法连接服务，请检查网络并重试" }
            finally { busy = false }
        }
    }
    fun retry() { retry?.let { perform(it) } }
    fun connect(url: String, token: String) {
        val connection = ConnectionSettings(url.trim().trimEnd('/'), token.trim(), if (url.trim().trimEnd('/') == settings.url && token.trim() == settings.token) settings.sessionId else null)
        perform {
            val api = MealApi(connection)
            loadFoods(api)
            val response = if (connection.sessionId != null) {
                try { api.request("session?id=${connection.sessionId}") } catch (e: ApiError) { if (e.status == 404) api.request("bootstrap") else throw e }
            } else api.request("bootstrap")
            settings = connection.copy(sessionId = null)
            applyResponse(response)
            store.save(settings)
            status = "连接成功"
        }
    }
    private suspend fun loadFoods(api: MealApi) {
        val list = api.request("foods").getJSONArray("foods")
        foods = (0 until list.length()).map { Food.fromJson(list.getJSONObject(it)) }
        foodsLoaded = true
    }
    fun refreshFoods() = perform { loadFoods(MealApi(settings)) }
    fun addFood(input: JSONObject, done: () -> Unit) = perform {
        val api = MealApi(settings)
        api.request("foods", input)
        loadFoods(api)
        applyResponse(api.request("bootstrap"))
        done()
    }
    fun removeFood(id: String) = perform {
        val api = MealApi(settings)
        api.request("foods?id=$id", method = "DELETE")
        loadFoods(api)
        applyResponse(api.request("bootstrap"))
    }
    fun submitText(text: String) {
        if (text.isBlank()) return
        val form = currentForm()
        perform {
            val api = MealApi(settings)
            val previous = session
            val response = if (previous != null && form != null) api.request("action", JSONObject()
                .put("sessionId", previous.getString("id")).put("revision", previous.getInt("revision"))
                .put("text", text).put("action", JSONObject().put("name", "update").put("surfaceId", "meal-picker").put("context", JSONObject().put("form", form))))
            else api.request("session", JSONObject().put("text", text).put("filters", form?.let(::filtersFromForm) ?: JSONObject()))
            applyResponse(response)
        }
    }
    private fun filtersFromForm(form: JSONObject): JSONObject {
        val budget = form.getJSONArray("budget").getString(0)
        return JSONObject().put("meal", form.getJSONArray("meal").optString(0).takeIf { it.isNotBlank() } ?: JSONObject.NULL)
            .put("budget", if (budget == "any") JSONObject.NULL else (if (budget == "custom") form.getString("customBudget") else budget).toDouble())
            .put("spice", form.getJSONArray("spice").getString(0)).put("staple", form.getJSONArray("staple").getString(0)).put("taste", form.getJSONArray("taste").getString(0))
    }
    private fun dispatch(event: A2uiClientEventMessage) {
        if (busy) return
        val action = JSONObject().put("name", event.type).put("surfaceId", event.surfaceId).put("context", JSONObject(event.context))
        val previous = session
        perform {
            val api = MealApi(settings)
            val response = if (previous == null) {
                val context = action.getJSONObject("context")
                val filters = currentForm()?.let(::filtersFromForm) ?: JSONObject()
                when (event.type) {
                    "choose_meal" -> api.request("session", JSONObject().put("filters", filters.put("meal", context.getString("meal"))))
                    "edit_filters" -> api.request("session", JSONObject().put("filters", filters).put("editing", true))
                    "update" -> api.request("session", JSONObject().put("filters", filtersFromForm(context.getJSONObject("form"))))
                    "restart" -> api.request("bootstrap")
                    else -> throw IllegalArgumentException("INVALID_INITIAL_ACTION")
                }
            } else api.request("action", JSONObject().put("sessionId", previous.getString("id")).put("revision", previous.getInt("revision")).put("action", action))
            applyResponse(response)
        }
    }
    private fun applyResponse(response: JSONObject) {
        session = response.optJSONObject("session")
        stage = session?.optString("step", "start") ?: "start"
        settings = settings.copy(sessionId = session?.getString("id"))
        store.save(settings)
        // Each response contains a full surface; explicitly delete the old one first.
        if (surfaces.value.isNotEmpty()) processor.processInput(parser, "{\"version\":\"v0.9.1\",\"deleteSurface\":{\"surfaceId\":\"meal-picker\"}}")
        val messages = response.getJSONArray("messages")
        for (i in 0 until messages.length()) {
            val message = messages.getJSONObject(i)
            if (message.has("updateComponents")) components = JSONObject(message.toString())
            processor.processInput(parser, message.toString())
        }
        if (expanded) updateExpansion()
    }
    private fun toggleMore() { if (!busy) { expanded = !expanded; updateExpansion() } }
    private fun updateExpansion() {
        val message = components ?: return
        val list = message.getJSONObject("updateComponents").getJSONArray("components")
        for (i in 0 until list.length()) {
            val component = list.getJSONObject(i)
            if (component.getString("id") == "more-label") component.put("text", if (expanded) "收起更多偏好" else "更多偏好")
            if (component.getString("id") == "root") {
                val children = component.getJSONArray("children")
                val next = JSONArray()
                for (j in 0 until children.length()) {
                    val child = children.getString(j)
                    if (child == "filter-actions" && expanded) next.put("more-options")
                    if (child != "more-options") next.put(child)
                    if (child == "more" && expanded) next.put("more-options")
                }
                component.put("children", next)
            }
        }
        processor.processInput(parser, message.toString())
    }
}
