package dev.a2ui.mealpicker

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.a2ui.A2uiSurface
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { MealTheme { MealScreen() } }
    }
}
@Composable
private fun MealScreen(vm: MealViewModel = viewModel()) {
    val surfaces by vm.surfaces.collectAsStateWithLifecycle()
    var showConnection by remember { mutableStateOf(vm.settings.token.isBlank()) }
    var text by rememberSaveable { mutableStateOf("") }
    var showFoods by rememberSaveable { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val scroll = rememberScrollState()
    LaunchedEffect(vm.stage) { focus.clearFocus(); scroll.scrollTo(0); if (vm.stage == "start") text = "" }
    if (showFoods) { FoodScreen(vm) { showFoods = false }; return }
    Column(
        Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().imePadding()
            .verticalScroll(scroll).padding(horizontal = 20.dp).padding(top = 10.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(color = MealInk, shape = RoundedCornerShape(10.dp), modifier = Modifier.size(32.dp)) {
                    Box(contentAlignment = Alignment.Center) { Text("M", color = Color.White, fontWeight = FontWeight.Bold) }
                }
                Text("AI Meal", style = MaterialTheme.typography.titleMedium)
                Surface(color = MealSoft, shape = RoundedCornerShape(6.dp)) {
                    Text("我的菜单", Modifier.padding(horizontal = 7.dp, vertical = 3.dp), color = MealMuted, style = MaterialTheme.typography.labelSmall)
                }
            }
            TextButton(onClick = { showConnection = true }, enabled = !vm.busy, contentPadding = PaddingValues(horizontal = 4.dp)) {
                Text("连接设置", style = MaterialTheme.typography.bodySmall, color = MealMuted)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(when (vm.stage) {
                "need_meal" -> "再确认一件事"
                "no_match" -> "换个办法选"
                "candidates" -> "看看这几份"
                "selected" -> "这餐，就这么定了"
                "editing" -> "按你的想法来"
                else -> "今天吃什么？"
            }, style = MaterialTheme.typography.headlineLarge)
            Text(when (vm.stage) {
                "need_meal" -> "你的偏好已记住，补上餐别就能继续。"
                "no_match" -> "每个调整选项都查过你的食物库。"
                "candidates" -> "只从你录入的食物中挑选。"
                "selected" -> "已确认你的选择。"
                "editing" -> "说一句新想法，或者改下面的条件。"
                else -> "说说你想吃什么，我来一步步帮你选。"
            }, style = MaterialTheme.typography.bodyMedium, color = MealMuted)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("我的食物", style = MaterialTheme.typography.titleMedium)
                Text(if (vm.foodsLoaded) "${vm.foods.size} 份可选餐食" else "正在加载食物库", style = MaterialTheme.typography.bodySmall, color = MealMuted)
            }
            OutlinedButton(onClick = { showFoods = true; vm.refreshFoods() }, enabled = !vm.busy && vm.settings.token.isNotBlank()) { Text("录入 / 管理") }
        }
        if (vm.foodsLoaded && vm.foods.isEmpty()) {
            Surface(color = MealSoft, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("先录入一份食物", style = MaterialTheme.typography.titleLarge)
                    Text("你的菜单还是空的。添加常吃的餐食后，就可以按预算和口味选餐。", color = MealMuted)
                    Button(onClick = { showFoods = true }, enabled = !vm.busy) { Text("录入食物") }
                }
            }
        }
        if (vm.foods.isNotEmpty() && vm.stage in listOf("start", "editing")) Surface(shape = RoundedCornerShape(18.dp), color = MealSoft, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                TextField(
                    value = text, onValueChange = { if (it.length <= 2000) text = it },
                    label = { Text("说说你想吃什么", style = MaterialTheme.typography.bodySmall) },
                    placeholder = { Text("例如：想吃清淡的，20 元以内", style = MaterialTheme.typography.bodyMedium) },
                    modifier = Modifier.fillMaxWidth(), enabled = !vm.busy, maxLines = 3,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                        disabledContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent,
                    ),
                )
                Row(Modifier.fillMaxWidth().padding(start = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("一句话，缩小今天的选择", style = MaterialTheme.typography.labelSmall, color = MealMuted)
                    Button(
                        onClick = { focus.clearFocus(); vm.submitText(text) },
                        enabled = !vm.busy && text.isNotBlank() && vm.settings.token.isNotBlank(),
                        shape = RoundedCornerShape(10.dp), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    ) { Text("帮我选餐") }
                }
            }
        }
        if (vm.busy) {
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("正在处理…", style = MaterialTheme.typography.bodyMedium, color = MealMuted)
            }
        }
        vm.error?.let { message ->
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
                    TextButton(onClick = { vm.retry() }, enabled = !vm.busy) { Text("重试") }
                }
            }
        }
        if (vm.foods.isNotEmpty()) CompositionLocalProvider(LocalMealBusy provides vm.busy) { surfaces.forEach { surface -> key(surface.id) {
            A2uiSurface(surfaceModel = surface, modifier = Modifier.fillMaxWidth(),
                errorContent = { Text("界面数据无法显示，请重新连接", color = MaterialTheme.colorScheme.error) }, transitionSpec = null)
        } } }
    }
    if (showConnection) ConnectionDialog(vm) { showConnection = false }
}
@Composable
private fun ConnectionDialog(vm: MealViewModel, close: () -> Unit) {
    val activity = LocalContext.current as ComponentActivity
    DisposableEffect(activity) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    var url by remember { mutableStateOf(vm.settings.url) }
    var token by remember { mutableStateOf(vm.settings.token) }
    AlertDialog(onDismissRequest = close, title = { Text("连接设置") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("服务地址默认指向已接入的 Netlify 后端。访问令牌由你的服务配置提供。")
            OutlinedTextField(url, { url = it }, label = { Text("服务地址") }, singleLine = true)
            OutlinedTextField(token, { token = it }, label = { Text("访问令牌") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        }
    }, confirmButton = { TextButton(onClick = { vm.connect(url, token); close() }, enabled = !vm.busy) { Text("保存并检查连接") } }, dismissButton = { TextButton(onClick = close) { Text("取消") } })
}
