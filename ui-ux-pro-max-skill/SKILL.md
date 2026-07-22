---
name: ui-ux-pro-max
description: UI/UX design intelligence with searchable guidance for styles, palettes, typography, charts, accessibility, responsive layouts, and framework-specific implementation. Use when planning, building, reviewing, fixing, or refining websites, dashboards, applications, components, and other frontend interfaces.
---

# UI/UX Pro Max

Use the bundled search engine before making substantial UI decisions. Resolve `<skill-root>` to the directory containing this `SKILL.md`; do not assume the user's current working directory.

## Workflow

1. Identify the product type, audience, industry, desired visual character, target platform, and implementation stack.
2. Generate a design system before implementation:

```bash
python "<skill-root>/scripts/search.py" "<product> <industry> <keywords>" --design-system -p "<project-name>"
```

3. Run focused searches when the design system needs more detail:

```bash
python "<skill-root>/scripts/search.py" "<query>" --domain <domain>
python "<skill-root>/scripts/search.py" "<query>" --stack <stack>
```

4. Apply the results in sympathy with the existing product and design system. Treat search output as guidance rather than a reason to overwrite established conventions.
5. Verify responsiveness, accessibility, interaction states, content fit, and visual hierarchy before delivery.

On systems where the Python executable is named `python3`, use `python3` in the same commands.

## Search Options

Use these domains as needed:

- `product`: product-type conventions and priorities
- `style`: visual language, effects, and implementation details
- `color`: accessible palette recommendations
- `typography`: font pairings and type guidance
- `landing`: landing-page structure and conversion patterns
- `chart`: visualization choices
- `ux`: usability, accessibility, motion, and interaction guidance
- `react`: React and Next.js performance guidance
- `web`: semantic HTML, forms, focus, and browser interface guidance
- `icons`: icon-library and usage guidance

Supported stack searches include `html-tailwind`, `react`, `nextjs`, `astro`, `vue`, `nuxtjs`, `nuxt-ui`, `svelte`, `swiftui`, `react-native`, `flutter`, `shadcn`, and `jetpack-compose`. Default to `html-tailwind` only when the project does not establish another stack.

## Persistent Design Systems

Persist a reusable design system only when the user wants project files created:

```bash
python "<skill-root>/scripts/search.py" "<query>" --design-system --persist -p "<project-name>"
python "<skill-root>/scripts/search.py" "<query>" --design-system --persist -p "<project-name>" --page "<page-name>"
```

Read the generated `design-system/<project-slug>/MASTER.md` first. When a matching page override exists under `design-system/<project-slug>/pages/`, apply that file over the master rules.

## Delivery Checks

- Keep text contrast at or above WCAG AA requirements.
- Provide visible focus styles and complete keyboard access.
- Use labels and semantic elements for controls.
- Keep touch targets at least 44 by 44 pixels where practical.
- Reserve space for asynchronous content to avoid layout shifts.
- Respect `prefers-reduced-motion`.
- Test at 375, 768, 1024, and 1440 pixel widths.
- Prevent horizontal scrolling and fixed-header content occlusion.
- Use a consistent icon library instead of emoji UI icons.
- Keep hover and pressed states stable without layout movement.
