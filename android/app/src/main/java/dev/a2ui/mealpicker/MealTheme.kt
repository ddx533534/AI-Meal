package dev.a2ui.mealpicker

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val MealInk = Color(0xFF17211C)
val MealMuted = Color(0xFF7C8580)
val MealAccent = Color(0xFF28654A)
val MealLine = Color(0xFFE8ECE9)
val MealSoft = Color(0xFFF5F7F6)

private val MealColors = lightColorScheme(
    primary = MealAccent, onPrimary = Color.White,
    primaryContainer = Color(0xFFE9F3ED), onPrimaryContainer = MealAccent,
    secondary = MealAccent, onSecondary = Color.White,
    secondaryContainer = Color(0xFFE9F3ED), onSecondaryContainer = MealAccent,
    tertiary = MealAccent, tertiaryContainer = MealSoft, onTertiaryContainer = MealInk,
    background = Color.White, onBackground = MealInk,
    surface = Color.White, onSurface = MealInk,
    surfaceVariant = MealSoft, onSurfaceVariant = MealMuted,
    surfaceContainerLowest = Color.White, surfaceContainerLow = MealSoft,
    surfaceContainer = MealSoft, surfaceContainerHigh = MealSoft,
    surfaceContainerHighest = Color(0xFFEEF1EF),
    outline = Color(0xFFCCD4CE), outlineVariant = MealLine,
    error = Color(0xFFAA443D), errorContainer = Color(0xFFFFF1EE),
    onErrorContainer = Color(0xFF863A34), surfaceTint = Color.Transparent,
)
private val MealTypography = Typography(
    headlineLarge = TextStyle(fontSize = 28.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold),
    headlineMedium = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold),
    headlineSmall = TextStyle(fontSize = 21.sp, lineHeight = 29.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 14.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun MealTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MealColors, typography = MealTypography,
        shapes = Shapes(
            extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(10.dp),
            medium = RoundedCornerShape(14.dp), large = RoundedCornerShape(18.dp),
            extraLarge = RoundedCornerShape(24.dp),
        ), content = content,
    )
}
