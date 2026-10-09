package dev.a2ui.mealpicker

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class Food(val id: String, val name: String, val price: Double, val meals: List<String>, val spice: String, val staple: String, val light: Boolean) {
    companion object {
        fun fromJson(j: JSONObject): Food {
            val meals = j.getJSONArray("meals")
            return Food(j.getString("id"), j.getString("name"), j.getDouble("price"), (0 until meals.length()).map { meals.getString(it) }, j.getString("spice"), j.getString("staple"), j.getBoolean("light"))
        }
    }
    fun priceLabel() = java.math.BigDecimal.valueOf(price).stripTrailingZeros().toPlainString()
    fun tags() = meals.joinToString(" / ") { if (it == "lunch") "午饭" else "晚饭" } + " · " +
        when (spice) { "none" -> "不辣"; "mild" -> "微辣"; else -> "辣" } + " · " +
        when (staple) { "rice" -> "米饭"; "noodles" -> "面食"; else -> "其他主食" } + if (light) " · 清淡" else ""
}

@Composable
fun FoodScreen(vm: MealViewModel, back: () -> Unit) {
    var adding by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Food?>(null) }
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { if (adding) adding = false else back() }, enabled = !vm.busy) { Text("返回") }
            Text(if (adding) "录入食物" else "我的食物", style = MaterialTheme.typography.titleLarge)
            if (!adding) TextButton(onClick = { adding = true }, enabled = !vm.busy) { Text("新增") }
            else Spacer(Modifier.width(56.dp))
        }
        vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (vm.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (adding) FoodForm(vm) { adding = false }
        else {
            Text("录入的名称、价格和偏好将用于选餐。", color = MealMuted, style = MaterialTheme.typography.bodyMedium)
            if (vm.foods.isEmpty()) {
                Surface(color = MealSoft, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("还没有食物", style = MaterialTheme.typography.titleMedium)
                        Text("从你常吃的一份餐食开始。", color = MealMuted)
                        Button(onClick = { adding = true }, enabled = !vm.busy) { Text("录入食物") }
                    }
                }
            }
            vm.foods.forEach { food ->
                Surface(color = MealSoft, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(food.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                            Text("¥${food.priceLabel()}", color = MealAccent, style = MaterialTheme.typography.titleMedium)
                        }
                        Text(food.tags(), style = MaterialTheme.typography.bodySmall, color = MealMuted)
                        TextButton(onClick = { deleting = food }, enabled = !vm.busy, modifier = Modifier.align(Alignment.End)) { Text("删除", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
    deleting?.let { food ->
        AlertDialog(onDismissRequest = { deleting = null }, title = { Text("删除这份食物？") }, text = { Text("${food.name}将从你的菜单中移除。") }, confirmButton = {
            TextButton(onClick = { deleting = null; vm.removeFood(food.id) }, enabled = !vm.busy) { Text("删除") }
        }, dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } })
    }
}

@Composable
private fun FoodForm(vm: MealViewModel, done: () -> Unit) {
    val id = rememberSaveable { UUID.randomUUID().toString() }
    var name by rememberSaveable { mutableStateOf("") }
    var price by rememberSaveable { mutableStateOf("") }
    var lunch by rememberSaveable { mutableStateOf(true) }
    var dinner by rememberSaveable { mutableStateOf(true) }
    var spice by rememberSaveable { mutableStateOf("none") }
    var staple by rememberSaveable { mutableStateOf("rice") }
    var light by rememberSaveable { mutableStateOf(false) }
    val validPrice = price.matches(Regex("\\d{1,5}(\\.\\d{1,2})?")) && (price.toDoubleOrNull() ?: -1.0) in 0.0..10000.0
    Text("填写你确认的信息，价格不会自动估算。", color = MealMuted, style = MaterialTheme.typography.bodyMedium)
    OutlinedTextField(name, { if (it.length <= 80) name = it }, label = { Text("食物名称") }, singleLine = true, enabled = !vm.busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
    OutlinedTextField(price, { if (it.length <= 8) price = it }, label = { Text("价格（元）") }, supportingText = { Text("0–10000 元，最多两位小数") }, isError = price.isNotBlank() && !validPrice, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, enabled = !vm.busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
    Text("适用餐别", style = MaterialTheme.typography.labelLarge)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        FilterChip(selected = lunch, onClick = { lunch = !lunch }, label = { Text("午饭") }, enabled = !vm.busy)
        FilterChip(selected = dinner, onClick = { dinner = !dinner }, label = { Text("晚饭") }, enabled = !vm.busy)
    }
    if (!lunch && !dinner) Text("至少选择一种餐别", color = MaterialTheme.colorScheme.error)
    FoodOptions("辣度", listOf("none" to "不辣", "mild" to "微辣", "hot" to "辣"), spice, !vm.busy) { spice = it }
    FoodOptions("主食", listOf("rice" to "米饭", "noodles" to "面食", "other" to "其他"), staple, !vm.busy) { staple = it }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text("清淡口味", style = MaterialTheme.typography.labelLarge)
        Switch(checked = light, onCheckedChange = { light = it }, enabled = !vm.busy)
    }
    Button(onClick = {
        val meals = JSONArray(); if (lunch) meals.put("lunch"); if (dinner) meals.put("dinner")
        vm.addFood(JSONObject().put("id", id).put("name", name.trim()).put("price", price.toDouble()).put("meals", meals).put("spice", spice).put("staple", staple).put("light", light), done)
    }, enabled = !vm.busy && name.isNotBlank() && validPrice && (lunch || dinner), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(12.dp)) { Text(if (vm.busy) "保存中…" else "保存食物") }
}

@Composable
private fun FoodOptions(label: String, options: List<Pair<String, String>>, value: String, enabled: Boolean, change: (String) -> Unit) {
    Text(label, style = MaterialTheme.typography.labelLarge)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        options.forEach { (id, name) -> FilterChip(selected = value == id, onClick = { change(id) }, label = { Text(name) }, enabled = enabled) }
    }
}
