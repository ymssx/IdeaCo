# Project Code Organization Rules

## File Structure

- **Group related modules into subdirectories.** When a domain concept (e.g. "skill", "memory") produces 3+ files, they MUST live in their own subfolder with a barrel `index.js`, not be spread flat in the parent directory.
  - ✅ `employee/skill/registry.js`, `employee/skill/custom.js`, `employee/skill/marketplace.js`
  - ❌ `employee/skills.js`, `employee/skill-custom.js`, `employee/skill-marketplace.js`

- Barrel `index.js` files re-export public API so consumers can import from the folder root.

## Naming

- Use short, descriptive file names inside subdirectories (`registry.js`, `custom.js`, `marketplace.js`) — the folder name already provides the domain context, so avoid redundant prefixes like `skill-*.js`.

## Language

- All code, comments, log messages, and string literals MUST be in English. No Chinese or other non-English text anywhere in the source.
- User-facing text MUST go through the i18n system (`src/locales/`). All 7 locale files (en, zh, ja, ko, de, es, fr) must be updated together.

## Imports

- Prefer importing from barrel `index.js` for cross-module references (e.g. `from '@/core/employee/skill/index.js'`).
- Use direct file imports for intra-module references (e.g. inside `skill/`, import `./registry.js` directly).
