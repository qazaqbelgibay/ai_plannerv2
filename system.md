# DayOS Design System

A personal life operating system PWA with a token-driven, pre-dawn-to-dawn amber design language.

## Vision

**DayOS** helps users build, execute, and learn from their daily schedules through a minimal, OS-precise interface. The design reflects the user's journey: waking in pre-dawn darkness, executing blocks throughout the day, and winding down as evening approaches.

---

## Color System

All colors are derived from a pre-dawn-to-dawn narrative.

### Backgrounds: The Void
```css
--void:       #07090f;    /* Deep pre-dawn black */
--surface-0:  #0b0f1a;    /* First layer of surface */
--surface-1:  #111622;    /* Cards, containers */
--surface-2:  #181f30;    /* Elevated surfaces */
--surface-3:  #1e2740;    /* Highest elevation */
```

### Text: Ink Hierarchy
```css
--ink:        #e2e4ea;    /* Primary body text */
--ink-muted:  #8b92a8;    /* Secondary text, labels */
--ink-faint:  #555d75;    /* Tertiary, dates, times */
--ink-ghost:  #3a4260;    /* Disabled, borders */
```

### Accent: Dawn Amber
The primary brand color signifying the dawn of a new day and the present moment.

```css
--dawn:       #e8a44a;    /* Primary action, active states */
--dawn-dim:   #c4883a;    /* Hover state */
--dawn-glow:  rgba(232, 164, 74, 0.12);    /* Subtle backgrounds */
--dawn-ring:  rgba(232, 164, 74, 0.35);    /* Glows, pulses */
```

### Semantic: Activity Types
```css
--focus:      #4d8af0;    /* Work blocks, focus */
--focus-dim:  #3a6fcc;
--focus-glow: rgba(77, 138, 240, 0.10);

--rest:       #e8914a;    /* Enrichment, leisure */
--rest-glow:  rgba(232, 145, 74, 0.10);

--done:       #4eb87a;    /* Completed, success */
--done-dim:   #3d9963;
--done-glow:  rgba(78, 184, 122, 0.12);

--danger:     #d94848;    /* Destructive actions */
--danger-dim: #b03636;
```

### Structure: Borders
```css
--border:     #1c2438;    /* Standard border */
--border-lit: #283550;    /* Elevated border */
```

---

## Typography

### Font Stack
```css
--font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
--font-mono: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace;
```

### Scale
- **h1**: 1.75rem, 700 weight (brand, page titles)
- **h2**: 1.35rem, 600 weight (section headers)
- **h3**: 1.1rem, 600 weight (subsections)
- **body**: 1rem, 400 weight
- **small**: 0.85rem (labels, hints)
- **micro**: 0.72rem (timestamps, metadata)

### Monospace Usage
Monospace is used **exclusively for data**:
- Timer displays (HH:MM:SS)
- Time ranges (09:00 – 10:30)
- Dates (Mon 22/2)
- Statistics and numbers
- Duration formatting (2h 30m)

---

## Spacing

4px base unit system.

```css
--sp-1:  4px;
--sp-2:  8px;
--sp-3:  12px;
--sp-4:  16px;   /* Default padding */
--sp-5:  20px;   /* Default margins */
--sp-6:  24px;   /* Section spacing */
--sp-8:  32px;   /* Large gaps */
--sp-10: 40px;   /* Extra large */
--sp-12: 48px;   /* Focus card padding */
```

### Application
- **Padding**: `var(--sp-4)` default for form elements and cards
- **Margins**: `var(--sp-5)` between sections
- **Gaps**: `var(--sp-3)` in flex/grid layouts
- **Screen**: `var(--sp-6)` horizontal, `100px` bottom (nav clearance)

---

## Radius

OS-precise, not soft.

```css
--r-sm:  6px;    /* Tags, small elements */
--r-md:  10px;   /* Buttons, rows, inputs */
--r-lg:  14px;   /* Cards, containers */
--r-xl:  18px;   /* Focus card, modals */
```

### Pattern
- Smaller elements = smaller radius
- Interactive elements (buttons) use `--r-md`
- Containers use `--r-lg`
- Signature elements use `--r-xl`

---

## Components

### Focus Card (Signature Element)

The active block card is **the only animated element** in DayOS—a slow breathing amber border pulse.

```css
.focus-card {
  border: 2px solid var(--dawn);
  border-radius: var(--r-xl);
  animation: breathe 4s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 0 var(--dawn-ring); }
  50%      { box-shadow: 0 0 24px 4px var(--dawn-ring); }
}
```

**Enrichment variant:**
```css
.focus-card.enrichment {
  border-color: var(--rest);
  animation-name: breathe-rest;
}
```

### Buttons

**Primary (Call-to-action):**
```css
.btn-primary {
  background: var(--dawn);      /* Amber */
  color: var(--void);           /* Dark text on light */
  width: 100%;
  padding: var(--sp-5);
  border-radius: var(--r-xl);
}
```

**Secondary (Neutral):**
```css
.btn-secondary {
  background: var(--surface-2);
  color: var(--ink-muted);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}
```

**Done (Success):**
```css
.btn-done {
  background: var(--done);      /* Green */
  color: #fff;
  width: 100%;
  padding: var(--sp-5);
  border-radius: var(--r-xl);
}
```

**Danger (Destructive):**
```css
.btn-danger {
  background: var(--surface-2);
  color: var(--danger);
  border: 1px solid rgba(217, 72, 72, 0.2);
}
```

### Form Elements

```css
input[type="time"],
input[type="text"],
input[type="number"],
select,
textarea {
  padding: var(--sp-4);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  color: var(--ink);
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--dawn);    /* Amber focus ring */
}
```

**Time inputs use monospace:**
```css
input[type="time"] {
  font-family: var(--font-mono);
  font-size: 1.2rem;
  text-align: center;
}
```

### Cards

```css
.card {
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
  margin-bottom: var(--sp-4);
}
```

### Schedule Item

```css
.schedule-item {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-4);
  border-radius: var(--r-md);
  background: var(--surface-1);
  border: 1px solid var(--border);
}

.schedule-item.completed {
  opacity: 0.35;
}

.schedule-item.current {
  border-color: var(--dawn);
  background: var(--dawn-glow);
}

.schedule-item.enrichment-item {
  border-color: rgba(232, 145, 74, 0.2);
  background: var(--rest-glow);
}
```

### Statistics Cards

```css
.stat-card {
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  text-align: center;
}

.stat-number {
  font-family: var(--font-mono);
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--dawn);
}
```

### Week Grid

```css
.week-day-dot {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.week-day-dot.done {
  background: var(--done-glow);
  color: var(--done);
  border: 1px solid rgba(78, 184, 122, 0.2);
}

.week-day-dot.today {
  background: var(--dawn-glow);
  color: var(--dawn);
  border: 2px solid var(--dawn);
}
```

---

## Depth Strategy

**Borders-only depth** — no box-shadows anywhere.

### Layers
1. **Surface-0** (`#0b0f1a`) + `border: 1px var(--border)` — default cards
2. **Surface-1** (`#111622`) + `border: 1px var(--border)` — form elements
3. **Surface-2** (`#181f30`) + `border: 1px var(--border)` — elevated UI
4. **Accent border** — `var(--dawn)` for active/focus states

### No Shadows
This creates a sharp, OS-precise look reminiscent of modern operating systems (macOS Big Sur design language).

---

## Motion

**Minimal animation.** Only the focus card breathes.

```css
.focus-card {
  animation: breathe 4s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 0 var(--dawn-ring); }
  50%      { box-shadow: 0 0 24px 4px var(--dawn-ring); }
}
```

Other transitions are subtle:
- Button active state: `transform: scale(0.97)` with `0.1s`
- Focus states: `border-color` transition `0.2s`
- Opacity changes: `0.15s`

---

## Responsive

Mobile-first, responsive at 600px+.

```css
@media (min-width: 600px) {
  .screen { padding: var(--sp-8) var(--sp-6) 100px; }
  .focus-card { padding: var(--sp-12) var(--sp-8); }
}
```

---

## Navigation

Bottom tab bar, fixed position. 5 tabs:
1. **☀️ Start** — Set wake times, build day
2. **▶️ Focus** — Active block card
3. **📋 Day** — Full day view
4. **📊 Stats** — Behavior patterns
5. **⚙️ Settings** — Profile customization

```css
.nav-tabs {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--void);
  border-top: 1px solid var(--border);
  display: flex;
  z-index: 200;
}

.nav-tab {
  flex: 1;
  padding: 10px 0;
  color: var(--ink-ghost);
  transition: color 0.15s;
}

.nav-tab.active {
  color: var(--dawn);
}
```

---

## Accessibility

- **Focus states** → amber border on all interactive elements
- **Contrast** → WCAG AA compliant (text: 4.5:1 minimum)
- **Text sizes** → minimum 12px for body, 10px for metadata
- **Touch targets** → minimum 44px height for buttons
- **Color alone** → never used; semantic colors paired with iconography

---

## Usage

Import and use throughout:

```css
body {
  background: var(--void);
  color: var(--ink);
}

.btn-primary {
  background: var(--dawn);
  color: var(--void);
}

.active-indicator {
  border-color: var(--dawn);
  box-shadow: 0 0 24px 4px var(--dawn-ring);
}
```

---

## Changelog

**v1 (2026-02-22):** Initial design system. Replaced generic purple (#6c63ff) with dawn amber (#e8a44a). Implemented token-driven CSS, borders-only depth, monospace for data, breathing focus card animation. Service worker bumped to v4.
