# Theme Studio

CoDes includes a live theme editor that lets you customize the application appearance with semantic tokens, presets, and import/export.

## Opening Theme Studio

Navigate to the **Themes** view from the sidebar.

## Built-in Themes

CoDes ships with two built-in themes:

| Theme | Mode | Description |
|---|---|---|
| **CoDes Dark** | Dark | Default dark theme with warm accents |
| **CoDes Light** | Light | Light variant of the same token set |

Both themes are read-only duplicates of each other in light/dark mode. To customize, duplicate a built-in theme first.

## Theme Tokens

Themes are built from semantic tokens — named design values that map to UI elements:

### Colors

| Token | Purpose |
|---|---|
| `background` | Main window background |
| `sidebar` | Sidebar panel background |
| `surface` | Card and panel surface |
| `surfaceRaised` | Elevated surfaces (modals, popovers) |
| `text` | Primary text color |
| `muted` | Secondary/muted text |
| `border` | Border and divider color |
| `accent` | Primary accent (buttons, links, active states) |
| `success` | Success indicators |
| `warning` | Warning indicators |
| `danger` | Error/danger indicators |

### Typography

| Token | Purpose |
|---|---|
| `font` | UI font family (e.g., `'Instrument Sans', 'Segoe UI', sans-serif`) |
| `mono` | Monospace font for terminals and code |
| `fontScale` | Global font size multiplier |

### Layout

| Token | Purpose |
|---|---|
| `radius` | Corner radius for UI elements (in pixels) |
| `density` | Spacing density: `compact` or `comfortable` |

## Creating & Editing Themes

### Duplicating a Theme

1. Select a theme from the theme list
2. Click **Duplicate**
3. Enter a name for your custom theme

### Live Editing

1. Open a custom (non-built-in) theme for editing
2. Click any token to change its value
3. Changes apply immediately — you see the result as you edit
4. Supported color formats: OKLCH, HEX, RGB, HSL

### Token Value Formats

- **OKLCH** — `oklch(72% 0.14 65)` (preferred — perceptually uniform)
- **HEX** — `#e39b4a`
- **RGB** — `rgb(227, 155, 74)`
- **HSL** — `hsl(35, 72%, 59%)`

### Font Scaling

Adjust the `fontScale` token (e.g., `1.1` for 10% larger, `0.9` for 10% smaller). This scales the entire UI proportionally.

### Density

Switch between `compact` (tighter spacing, more information density) and `comfortable` (more whitespace, easier scanning).

## Import & Export

### Exporting a Theme

1. Select your theme
2. Click **Export**
3. Choose JSON format
4. Save the `.json` file

Exported themes contain all token values and metadata (name, version, mode).

### Importing a Theme

1. Click **Import**
2. Select a JSON theme file
3. The theme appears in your theme list ready to use

### Sharing Themes

You can share exported JSON theme files with other CoDes users. Import them on the target machine.

## Presets

CoDes includes a growing library of preset themes. Presets are:
- Community-contributed color schemes
- Accessible from the theme library
- Importable as a starting point for customization

## Reset

To revert a custom theme to its saved state, use **Reset** in the theme editor. This discards unsaved changes.

## See Also

- [Settings](settings.md) — choose the active theme
- [Product Design Principles](../PRODUCT.md) — visual design philosophy
