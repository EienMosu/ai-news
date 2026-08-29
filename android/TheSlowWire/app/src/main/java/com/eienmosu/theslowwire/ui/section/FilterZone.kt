package com.eienmosu.theslowwire.ui.section

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.eienmosu.theslowwire.model.FilterDef
import com.eienmosu.theslowwire.ui.Apparatus
import com.eienmosu.theslowwire.ui.Stamp
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.apparatus
import com.eienmosu.theslowwire.ui.theme.current

/**
 * The filter zone, the same grammar on all three surfaces: a fixed FILTER
 * stamp with the section's five named chips riding sideways past it, then the
 * bare search bar underneath — hairline box, magnifier, mono placeholder, and
 * no button at all. Typing narrows what is already on screen; on this platform
 * that is simply what state does, no debounce needed (the web needed 250ms
 * only because each keystroke would otherwise re-run against the DOM).
 */
@Composable
fun FilterZone(
    chips: List<FilterDef>,
    counts: Map<String, Int>,
    activeChipId: String?,
    onChipToggle: (String) -> Unit,
    query: TextFieldValue,
    onQueryChange: (TextFieldValue) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Stamp("Filter")
            Spacer(Modifier.width(10.dp))
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 2.dp),
            ) {
                items(chips, key = { it.id }) { chip ->
                    Chip(
                        chip = chip,
                        count = counts[chip.id] ?: 0,
                        isActive = chip.id == activeChipId,
                        onClick = { onChipToggle(chip.id) },
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        SearchBar(query = query, onQueryChange = onQueryChange)
    }
}

/** A hairline capsule; the active one presses in — ink fill, ground text, an
 *  ×. The count names the chip's effect before it is pressed. */
@Composable
private fun Chip(
    chip: FilterDef,
    count: Int,
    isActive: Boolean,
    onClick: () -> Unit,
) {
    val palette = Palette.current
    Row(
        Modifier
            .clip(CircleShape)
            .background(if (isActive) palette.ink else androidx.compose.ui.graphics.Color.Transparent)
            .border(1.dp, if (isActive) palette.ink else palette.hairMid, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Apparatus(
            chip.label,
            size = 11,
            medium = isActive,
            color = if (isActive) palette.ground else palette.ink,
        )
        Apparatus(
            count.toString(),
            size = 10,
            color = if (isActive) palette.ground else palette.muted,
        )
        if (isActive) Apparatus("×", size = 11, medium = true, color = palette.ground)
    }
}

/**
 * The app's search bar, and the web's twin since the owner's 2026-08-28 call:
 * no button beside it, the field is the whole control.
 *
 * BasicTextField rather than Material's OutlinedTextField on purpose — the
 * Material one brings its own label animation, container colours and 56dp
 * minimum, none of which belong to this design. The box, the hairline and the
 * placeholder are drawn here instead.
 */
@Composable
private fun SearchBar(
    query: TextFieldValue,
    onQueryChange: (TextFieldValue) -> Unit,
) {
    val palette = Palette.current
    val keyboard = LocalSoftwareKeyboardController.current
    val selectionColors = TextSelectionColors(
        handleColor = palette.ink,
        backgroundColor = palette.gold.copy(alpha = 0.25f),
    )

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(3.dp))
            .border(1.dp, palette.hairMid, RoundedCornerShape(3.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Magnifier()
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
            if (query.text.isEmpty()) {
                Apparatus("Search these days", size = 11, color = palette.muted)
            }
            CompositionLocalProvider(LocalTextSelectionColors provides selectionColors) {
                BasicTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    singleLine = true,
                    textStyle = apparatus(11).copy(color = palette.ink),
                    cursorBrush = SolidColor(palette.ink),
                    // The keyboard's own key says "search"; there is nothing to
                    // submit, so it only dismisses — same as the web's Enter.
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (query.text.isNotEmpty()) {
            Spacer(Modifier.width(8.dp))
            Apparatus(
                "×",
                size = 13,
                medium = true,
                color = palette.muted,
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable { onQueryChange(TextFieldValue("", TextRange.Zero)) }
                    .padding(4.dp),
            )
        }
    }
}

/** Two rules and a ring: the magnifier drawn in the design's own vocabulary
 *  rather than pulled from an icon set. */
@Composable
private fun Magnifier() {
    val palette = Palette.current
    Box(Modifier.width(12.dp).height(12.dp)) {
        Box(
            Modifier
                .width(9.dp)
                .height(9.dp)
                .border(1.2.dp, palette.muted, CircleShape)
        )
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .width(4.dp)
                .height(1.4.dp)
                .background(palette.muted)
        )
    }
}
