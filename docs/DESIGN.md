---
name: CityLab Diagnostics
colors:
  surface: '#faf9ff'
  surface-dim: '#cfdaf9'
  surface-bright: '#faf9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8ff'
  surface-container-highest: '#d8e2ff'
  on-surface: '#101b32'
  on-surface-variant: '#3d4947'
  inverse-surface: '#253048'
  inverse-on-surface: '#edf0ff'
  outline: '#6d7a77'
  outline-variant: '#bcc9c6'
  surface-tint: '#006a61'
  primary: '#006a61'
  on-primary: '#ffffff'
  primary-container: '#19a89a'
  on-primary-container: '#003530'
  inverse-primary: '#5fdaca'
  secondary: '#3155c5'
  on-secondary: '#ffffff'
  secondary-container: '#6c8cff'
  on-secondary-container: '#002375'
  tertiary: '#3457bc'
  on-tertiary: '#ffffff'
  tertiary-container: '#7191f9'
  on-tertiary-container: '#002778'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#7ef6e6'
  primary-fixed-dim: '#5fdaca'
  on-primary-fixed: '#00201c'
  on-primary-fixed-variant: '#005049'
  secondary-fixed: '#dce1ff'
  secondary-fixed-dim: '#b6c4ff'
  on-secondary-fixed: '#001550'
  on-secondary-fixed-variant: '#0b3bad'
  tertiary-fixed: '#dce1ff'
  tertiary-fixed-dim: '#b5c4ff'
  on-tertiary-fixed: '#00164d'
  on-tertiary-fixed-variant: '#133ea3'
  background: '#faf9ff'
  on-background: '#101b32'
  surface-variant: '#d8e2ff'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Work Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Work Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Work Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Work Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Work Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Work Sans
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.03em
  data-metric:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
---

## Brand & Style

This design system establishes an empathetic, reassuring, and mathematically precise visual framework tailored for complex diagnostic interpretation. Medical laboratory results frequently trigger patient stress and cognitive overload; therefore, the aesthetic strategy balances institutional credibility with approachable human-centric ergonomics. 

The design fuses modern clinical clarity with restorative soft minimalism:
- **Tone:** Empathetic, lucid, definitive, calm, and rigorous.
- **Audience:** Patients reviewing critical biomarkers alongside clinicians needing rapid contextual reference markers.
- **Stylistic Approach:** Soft diagnostic minimalism. We leverage generous negative space, gentle pillular geometries, and subdued organic surfaces to neutralize clinical anxiety while utilizing sharp typographic hierarchy and structured diagnostic palettes to preserve diagnostic authority.

## Colors

The palette is engineered around biological balance and clear semiotic meaning. The bio-teal `#19A89A` acts as the vital grounding seed, instilling calm across high-level progress indicators and reassuring focal points. Deep and secondary blues reinforce institutional trust and anchor analytical actions, while pristine canvas neutrals prevent visual fatigue.

### Core Palettes
- **Seed & Accent Teal (`#19A89A`):** Patient-centric affirmative touchpoints, health wellness tracking, and key explanatory callouts.
- **Primary Clinical Blue (`#3458C8`):** Authoritative brand actions, interactive state headers, and focused navigational selection.
- **Deep Blue (`#2546A8`):** Hover states, high-contrast badges, and primary iconography.
- **Secondary Blue (`#5576DC`):** Supplemental links, active breadcrumbs, and subtle active strokes.
- **Light Blue Wash (`#EDF2FF`):** Informational callout containers, tint overlays, and interactive item highlights.
- **Soft Lavender (`#F2F1FC`):** Specialized guidance blocks and contextual demographic messaging backgrounds.

### Neutrals & Structural Tone
- **App Canvas (`#F6F8FC`):** Soft, non-glare atmospheric background providing comfortable contrast against pure white cards.
- **Card Surface (`#FFFFFF`):** High-elevation reading layers and biomarker containment surfaces.
- **Main Text (`#202B43`):** Deep slate-navy offering WCAG AAA contrast for sustained readability.
- **Secondary Text (`#7A8499`):** Subordinate metadata, lab reference ranges, and unit measurements.
- **Dividers & Borders (`#E7EAF2`):** Low-contrast boundary strokes designed to fade into peripheral vision.

### Medical Status Tiers
Status colors communicate biomarker variance without alarming the viewer unnecessarily:
- **Normal (`#209B72`):** Biomarker within expected homeostatic range.
- **Low (`#4C83D9`):** Values below standard reference intervals; non-critical.
- **High (`#E99A36`):** Values exceeding upper limits; warrants monitored attention.
- **Urgent (`#DC4545`):** Critical threshold breaches requiring immediate clinical intervention.
- **Cannot Be Classified (`#8993A5`):** Inconclusive findings or technical lab errors.
- **Needs Demographics (`#8866CB`):** Missing clinical factors (e.g., gestational age, biological sex) preventing calculation.

## Typography

The typographic system pairs the welcoming, sculpted geometry of **Plus Jakarta Sans** with the structural legibility and horizontal balance of **Work Sans**.

- **Display & Headings (Plus Jakarta Sans):** Employs balanced proportions and soft terminal curves that eliminate mechanical coldness. Headings convey optimism and clear structure, orienting the patient immediately.
- **Narrative & Data Body (Work Sans):** Chosen for its wide aperture, solid vertical stems, and distinct numeral forms (`0` through `9`), ensuring dense clinical values, reference ranges, and analytical paragraphs remain instantly readable at small scales.
- **Metric Presentation:** Quantitative values utilize `data-metric` with tabular figures enabled (`font-variant-numeric: tabular-nums`) to ensure strict vertical alignment across comparative lab panels.

## Layout & Spacing

The layout is built around a Desktop-first (1440px target) grid architecture engineered to handle deep multi-column medical data.

### Structural Framework
- **Desktop (≥ 1280px):** Persistent left navigational dock (fixed width: `260px`), fluid main operational workspace (max-width `1440px`), top breadcrumb bar (fixed height: `64px`). Main workspace operates on a 12-column grid with `1.5rem` gutters and `2rem` outer padding.
- **Tablet (768px – 1279px):** Navigation transitions to a consolidated icon-rail or collapsible drawer. Workspace switches to an 8-column layout with `1.5rem` gutters and `1.5rem` margins.
- **Mobile (< 768px):** Navigation docks to a bottom bar or slide-out menu. Content flows into a single-column stack with `1rem` margins and `1rem` gutters.

### Spacing Philosophy
Negative space functions as a cognitive decompression buffer. Medical test listings must never feel dense or constricted. Generous vertical gaps (`space-lg` and `space-xl`) separate unrelated biological systems (e.g., Lipid Panel vs. Complete Blood Count), while tightly related biomarker components bind together with `space-xs` and `space-sm`.

## Elevation & Depth

Visual hierarchy relies on soft ambient light rather than harsh structural drop shadows. This creates a weightless, calming layered experience.

- **Canvas Foundation:** `#F6F8FC` acts as the lowermost floor, grounding all views.
- **Level 1 (Card & Module Layer):** Pure `#FFFFFF` surfaces hover over the canvas using an ultra-diffused, dual-layer ambient shadow:
  - `box-shadow: 0 1px 3px rgba(32, 43, 67, 0.04), 0 6px 16px -4px rgba(32, 43, 67, 0.06);`
  - Paired with a delicate boundary ring: `border: 1px solid #E7EAF2`.
- **Level 2 (Active & Hover Cards):** Subtle lift for interactive panels:
  - `box-shadow: 0 4px 6px rgba(32, 43, 67, 0.03), 0 12px 24px -6px rgba(32, 43, 67, 0.08);`
- **Level 3 (Modals, Overlays & Sticky Status Bars):** High-focus floating viewports:
  - `box-shadow: 0 12px 32px -4px rgba(32, 43, 67, 0.12);`
  - Backdropped with `backdrop-filter: blur(8px); background-color: rgba(246, 248, 252, 0.85);`.

## Shapes

The design system adopts a pill-shaped and organic radius model (`level 3`). Gentle curvature removes visual severity, softening clinical diagnosis into an intuitive, humanized format.

- **Pill Geometry (`rounded-full` / `9999px`):** Applied to status badges, backend status pills, navigation pills, range sliders, and action buttons.
- **Large Panels & Diagnostic Cards (`2rem` / `rounded-2xl`):** Houses lab category groups, summary cards, and biomarker tables.
- **Nested Containers & Inputs (`1rem` / `rounded-xl`):** Applied to form fields, nested metric cards, and sub-panels.

## Components

### Buttons
- **Primary:** Background `#3458C8`, text `#FFFFFF`, border-radius `9999px`, padding `0.75rem 1.5rem`. Hover triggers `#2546A8`. Focused rings utilize a soft `#EDF2FF` halo with `#3458C8` inner stroke.
- **Secondary / Ghost:** Transparent background, `1.5px` stroke of `#E7EAF2`, text `#202B43`. Hover transitions to background `#EDF2FF` with text `#3458C8`.
- **Teal Affirmative:** Background `#19A89A`, text `#FFFFFF`. Used for patient-empowerment actions (e.g., "Schedule Consultation", "Understand Next Steps").

### Status Badges & Backend Status Pills
- **Geometry:** Fully pill-shaped (`rounded-full`), padding `0.25rem 0.75rem`, typography `label-sm`.
- **Backend Status Pill (Top Header):** Encased in `#FFFFFF` with border `#E7EAF2`. Features a pulsating 8px status orb: green `#209B72` (Engine Synced), orange `#E99A36` (Processing Lab), or purple `#8866CB` (Awaiting Data).
- **Medical Status Tiers:**
  - *Normal:* Background `rgba(32, 155, 114, 0.10)`, text `#209B72`.
  - *Low:* Background `rgba(76, 131, 217, 0.10)`, text `#4C83D9`.
  - *High:* Background `rgba(233, 154, 54, 0.12)`, text `#E99A36`.
  - *Urgent:* Background `rgba(220, 69, 69, 0.12)`, text `#DC4545`.
  - *Unclassified:* Background `rgba(137, 147, 165, 0.12)`, text `#8993A5`.
  - *Needs Demographics:* Background `rgba(136, 102, 203, 0.12)`, text `#8866CB`.

### Diagnostic Metric Cards & Lab Result Rows
- Structured white surface (`#FFFFFF`) framed by `1px solid #E7EAF2` with `2rem` outer radius.
- Includes biomarker title, recorded numeric value, baseline reference unit, and an integrated **Horizontal Visual Range Spectrum**.
- **Visual Range Spectrum:** An 8px high continuous track displaying low, normal, and elevated gradient partitions with an indicator pin marking the patient's exact reading.

### Input Fields & Search Bars
- Background `#FFFFFF`, border `1.5px solid #E7EAF2`, border-radius `1rem`, padding `0.75rem 1rem`.
- Active focus state: border `#3458C8`, outline glow with `4px solid #EDF2FF`.
- Placeholder text in `#7A8499`.

### Breadcrumb Navigation Bar
- Top persistent bar (`64px` height), sticky beneath viewport limits.
- Background: Glassmorphic `#FFFFFF` with `90%` opacity and `blur(12px)`.
- Displays test hierarchy: `Diagnostics / Hematology / Comprehensive Metabolic Panel` with chevron dividers tinted `#7A8499` and terminal view highlighted in `#3458C8`.
- Anchors the live backend processing pill at the right margin.

### Left Persistent Navigation Sidebar
- Fixed width `260px`, height `100vh`, background `#FFFFFF`, right boundary `1px solid #E7EAF2`.
- Nav links feature `1rem` rounded target surfaces, smooth teal accent highlights on hover, and an active state composed of `#EDF2FF` fill with `#3458C8` bold text and icon.