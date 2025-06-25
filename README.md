# AutoUpgrader
Automatically upgrades halidoms/relics for the server Arborea.

## ⚠️ IMPORTANT
**Items must be in your inventory, NOT in pocket tabs!** The mod currently ignores the items in pocket tabs.

## Installation
1. Place the mod folder inside Tera/toolbox/mods
2. Ensure that inside `Tera/toolbox/mods/auto-upgrader` the following files are present:
   - `index.js`
   - `items.json` 
   - `S_RESULT_EVOLUTION.999.def` 
3. Restart toolbox or reload mods

## Usage
### Basic Commands
```
upgrade on <item_type> <tier|all> [count]
upgrade off
upgrade status
```
### Parameters
- **item_type**: `halidom`, `relic`, `ex_halidom`, `ex_relic`
- **tier**: `t1`, `t2`, `t3`, `t4`, `t5`, or `all`
- **count**: (optional) Even number ≥ 2 - number of items to use for upgrades -> 10 items means 5 upgrades will be done

### Examples
```bash
# Upgrade 10 tier 1 halidom items (5 upgrade attempts)
upgrade on halidom t1 10

# Upgrade all available tier 3 relics
upgrade on relic t3

# Upgrade all tiers of ex_halidom (purple halidoms) items
upgrade on ex_halidom all

# Check current status // mainly for debugging in case something went wrong
upgrade status

# Stop upgrading
upgrade off
```