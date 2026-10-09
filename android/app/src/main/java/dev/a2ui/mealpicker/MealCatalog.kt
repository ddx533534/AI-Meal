package dev.a2ui.mealpicker

import androidx.a2ui.compose.runtime.A2uiComponentScope
import androidx.a2ui.compose.runtime.A2uiComponentState
import androidx.a2ui.compose.ui.A2uiComponent
import androidx.a2ui.compose.ui.catalog.A2uiBasicCatalogV1
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/** Restyle the official catalog; bindings and action dispatch stay in A2UI. */
val LocalMealBusy = compositionLocalOf { false }

object MealText : A2uiBasicCatalogV1.Text {
    @Composable
    override fun A2uiComponentScope.TypedContent(text: String, variant: A2uiBasicCatalogV1.Text.Variant, accessibility: A2uiBasicCatalogV1.AccessibilityAttributes?, modifier: Modifier) {
        val style = when (variant) {
            A2uiBasicCatalogV1.Text.Variant.H1 -> MaterialTheme.typography.headlineLarge
            A2uiBasicCatalogV1.Text.Variant.H2 -> MaterialTheme.typography.headlineMedium
            A2uiBasicCatalogV1.Text.Variant.H3 -> MaterialTheme.typography.headlineSmall
            A2uiBasicCatalogV1.Text.Variant.H4 -> MaterialTheme.typography.titleLarge
            A2uiBasicCatalogV1.Text.Variant.H5 -> MaterialTheme.typography.titleMedium
            A2uiBasicCatalogV1.Text.Variant.Caption -> MaterialTheme.typography.bodySmall
            else -> MaterialTheme.typography.bodyLarge
        }
        val heading = variant != A2uiBasicCatalogV1.Text.Variant.Body && variant != A2uiBasicCatalogV1.Text.Variant.Caption
        Text(text, modifier = if (heading) modifier.semantics { heading() } else modifier, style = style,
            color = when (variant) { A2uiBasicCatalogV1.Text.Variant.Caption -> MealMuted; A2uiBasicCatalogV1.Text.Variant.H4 -> MealAccent; A2uiBasicCatalogV1.Text.Variant.Body -> LocalContentColor.current; else -> MealInk })
    }
}

object MealChoicePicker : A2uiBasicCatalogV1.ChoicePicker {
    @Composable
    override fun A2uiComponentScope.TypedContent(
        label: String?, options: List<A2uiBasicCatalogV1.ChoicePicker.Option>, value: List<String>,
        variant: A2uiBasicCatalogV1.ChoicePicker.Variant, displayStyle: A2uiBasicCatalogV1.ChoicePicker.DisplayStyle,
        filterable: Boolean, onValueChange: (List<String>) -> Unit, enabled: Boolean,
        accessibility: A2uiBasicCatalogV1.AccessibilityAttributes?, checks: List<A2uiBasicCatalogV1.CheckRule>, modifier: Modifier,
    ) {
        val failed = checks.firstOrNull { !it.condition }
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            if (!label.isNullOrBlank()) Text(label, style = MaterialTheme.typography.labelMedium, color = MealMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                options.forEach { option ->
                    val chosen = option.value in value
                    Surface(
                        color = if (chosen) MaterialTheme.colorScheme.primaryContainer else MealSoft,
                        contentColor = if (chosen) MealAccent else MealInk,
                        shape = RoundedCornerShape(10.dp),
                        border = if (chosen) BorderStroke(1.dp, MealAccent.copy(alpha = 0.18f)) else null,
                        modifier = Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).selectable(
                            selected = chosen, enabled = enabled && !LocalMealBusy.current && failed == null, role = Role.RadioButton,
                            onClick = {
                                onValueChange(if (variant == A2uiBasicCatalogV1.ChoicePicker.Variant.MutuallyExclusive) listOf(option.value)
                                    else if (chosen) value - option.value else value + option.value)
                            },
                        ),
                    ) {
                        Box(Modifier.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                            Text(option.label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
            failed?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

object MealBudgetField : A2uiBasicCatalogV1.TextField {
    @Composable
    override fun A2uiComponentScope.TypedContent(
        label: String, value: String?, variant: A2uiBasicCatalogV1.TextField.Variant, validationRegexp: String?,
        onValueChange: (String) -> Unit, enabled: Boolean, accessibility: A2uiBasicCatalogV1.AccessibilityAttributes?,
        checks: List<A2uiBasicCatalogV1.CheckRule>, modifier: Modifier,
    ) {
        val budget = observeA2uiComponentState("budget") as? A2uiComponentState.Success
        val choices = budget?.component?.properties?.bind(A2uiBasicCatalogV1.ChoicePicker.ValueProperty)
        if (choices?.contains("custom") != true) return
        val failed = checks.firstOrNull { !it.condition }
        OutlinedTextField(
            value = value.orEmpty(), onValueChange = onValueChange, label = { Text(label) },
            modifier = modifier.fillMaxWidth(), enabled = enabled && !LocalMealBusy.current, singleLine = true,
            shape = RoundedCornerShape(12.dp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            isError = failed != null, supportingText = failed?.let { { Text(it.message) } },
        )
    }
}

object MealCard : A2uiBasicCatalogV1.Card {
    @Composable
    override fun A2uiComponentScope.TypedContent(childId: String, accessibility: A2uiBasicCatalogV1.AccessibilityAttributes?, modifier: Modifier) {
        val state = observeA2uiComponentState(childId)
        Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = MealSoft, border = BorderStroke(1.dp, MealLine)) {
            Box(Modifier.padding(16.dp)) { ComponentContent(state) }
        }
    }
}

object MealButton : A2uiBasicCatalogV1.Button {
    @Composable
    override fun A2uiComponentScope.TypedContent(
        childId: String, variant: A2uiBasicCatalogV1.Button.Variant, action: Map<String, Any?>,
        accessibility: A2uiBasicCatalogV1.AccessibilityAttributes?, checks: List<A2uiBasicCatalogV1.CheckRule>, modifier: Modifier,
    ) {
        val state = observeA2uiComponentState(childId)
        val failed = checks.firstOrNull { !it.condition }
        val enabled = state is A2uiComponentState.Success && failed == null && !LocalMealBusy.current
        val focus = LocalFocusManager.current
        val click = { focus.clearFocus(); dispatchAction(action) }
        val content: @Composable RowScope.() -> Unit = {
            MaterialTheme(typography = MaterialTheme.typography.copy(bodyLarge = MaterialTheme.typography.labelLarge)) {
                ComponentContent(state)
            }
        }
        Column(modifier) {
            when (variant) {
                A2uiBasicCatalogV1.Button.Variant.Primary -> Button(
                    onClick = click, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    shape = RoundedCornerShape(12.dp), content = content,
                )
                A2uiBasicCatalogV1.Button.Variant.Borderless -> TextButton(onClick = click, enabled = enabled, content = content)
                else -> OutlinedButton(onClick = click, enabled = enabled, shape = RoundedCornerShape(10.dp), border = BorderStroke(1.dp, MealLine), content = content)
            }
            failed?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@Composable
private fun ComponentContent(state: A2uiComponentState) {
    when (state) {
        is A2uiComponentState.Success -> A2uiComponent(component = state.component)
        is A2uiComponentState.Loading -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        is A2uiComponentState.Error -> Text("界面数据无法显示，请重新连接", style = MaterialTheme.typography.bodySmall)
    }
}
