"""Convert the community-parsed Satisfactory 1.0 data (greeny/SatisfactoryTools data1.0.json,
generated from the game's Docs.json) into the compact format the planner uses.

Production recipes did not change between 1.0 and 1.2.x (checked against every patch note
on satisfactory.wiki.gg), so the 1.0 data is valid for the current game.

Usage: python3 -I scripts/build_data.py <path/to/data1.0.json> [icon_dir]
Writes src/data/gamedata.json (and src/data/icons.json when icon_dir is given).
"""
import base64
import json
import os
import sys
from collections import defaultdict

SRC = sys.argv[1]
ICON_DIR = sys.argv[2] if len(sys.argv) > 2 else None
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "data")

d = json.load(open(SRC))
ITEMS, RECIPES, SCHEMATICS, BUILDINGS = d["items"], d["recipes"], d["schematics"], d["buildings"]

# --- Raw resources -------------------------------------------------------------
# Maximum extraction per minute for the whole map (satisfactory.wiki.gg "Resource Node").
WORLD_MAX = {
    "Desc_OreIron_C": 92100,
    "Desc_OreCopper_C": 36900,
    "Desc_Stone_C": 69300,
    "Desc_Coal_C": 42300,
    "Desc_OreGold_C": 15000,
    "Desc_RawQuartz_C": 13500,
    "Desc_Sulfur_C": 10800,
    "Desc_OreBauxite_C": 12300,
    "Desc_OreUranium_C": 2100,
    "Desc_SAM_C": 10200,
    "Desc_LiquidOil_C": 12600,
    "Desc_NitrogenGas_C": 12000,
    "Desc_Water_C": None,  # unlimited
}
SOLID_RES = [k for k in WORLD_MAX if k not in ("Desc_LiquidOil_C", "Desc_NitrogenGas_C", "Desc_Water_C")]

# Somersloop slots (satisfactory.wiki.gg "Production amplifier")
SLOOP_SLOTS = {
    "Desc_SmelterMk1_C": 1, "Desc_ConstructorMk1_C": 1,
    "Desc_AssemblerMk1_C": 2, "Desc_FoundryMk1_C": 2, "Desc_OilRefinery_C": 2, "Desc_Converter_C": 2,
    "Desc_ManufacturerMk1_C": 4, "Desc_Blender_C": 4, "Desc_HadronCollider_C": 4, "Desc_QuantumEncoder_C": 4,
}

PRODUCTION_BUILDINGS = [
    "Desc_SmelterMk1_C", "Desc_ConstructorMk1_C", "Desc_AssemblerMk1_C", "Desc_FoundryMk1_C",
    "Desc_ManufacturerMk1_C", "Desc_OilRefinery_C", "Desc_Packager_C", "Desc_Blender_C",
    "Desc_HadronCollider_C", "Desc_Converter_C", "Desc_QuantumEncoder_C",
]
EXTRACTORS = [
    "Desc_MinerMk1_C", "Desc_MinerMk2_C", "Desc_MinerMk3_C", "Desc_WaterPump_C", "Desc_OilPump_C",
    "Desc_FrackingSmasher_C", "Desc_FrackingExtractor_C",
]
GENERATORS = ["Desc_GeneratorBiomass_Automated_C", "Desc_GeneratorCoal_C", "Desc_GeneratorFuel_C", "Desc_GeneratorNuclear_C"]
LOGISTICS = [
    "Desc_ConveyorBeltMk1_C", "Desc_ConveyorBeltMk2_C", "Desc_ConveyorBeltMk3_C", "Desc_ConveyorBeltMk4_C",
    "Desc_ConveyorBeltMk5_C", "Desc_ConveyorBeltMk6_C", "Desc_Pipeline_C", "Desc_PipelineMK2_C",
]
ALL_BUILDINGS = PRODUCTION_BUILDINGS + EXTRACTORS + GENERATORS + LOGISTICS


def icon_key(class_name):
    return class_name.lower().replace("_", "-")


# --- Unlocks ---------------------------------------------------------------------
rec2sch = defaultdict(list)
for s in SCHEMATICS.values():
    for r in s["unlock"].get("recipes", []):
        rec2sch[r].append(s)


def unlock_info(recipe_key):
    """Returns (source, tier, label). source: start | milestone | mam | alt | other"""
    r = RECIPES[recipe_key]
    sch = rec2sch.get(recipe_key, [])
    if r["alternate"]:
        return "alt", 0, "Hard drive"
    mil = [s for s in sch if s["type"] in ("EST_Milestone", "EST_Tutorial")]
    if mil:
        s = min(mil, key=lambda s: s["tier"] if s["type"] == "EST_Milestone" else 0)
        tier = s["tier"] if s["type"] == "EST_Milestone" else 0
        return ("milestone" if tier > 0 else "start"), tier, s["name"]
    mam = [s for s in sch if s["type"] == "EST_MAM"]
    if mam:
        return "mam", 0, mam[0]["name"]
    return None


# Recipes with no schematic in the dataset, unlock assigned by hand from the wiki.
MANUAL_UNLOCK = {
    "Recipe_IronPlate_C": ("start", 0, "Onboarding"),
    "Recipe_IronRod_C": ("start", 0, "Onboarding"),
    "Recipe_IngotIron_C": ("start", 0, "Onboarding"),
    "Recipe_ResidualFuel_C": ("milestone", 5, "Oil Processing"),
    "Recipe_ResidualPlastic_C": ("milestone", 5, "Oil Processing"),
    "Recipe_ResidualRubber_C": ("milestone", 5, "Oil Processing"),
    "Recipe_CartridgeChaos_Packaged_C": ("mam", 0, "Turbo Rifle Ammo"),
}


def building_tier(bclass):
    best = None
    for rk, r in RECIPES.items():
        if r["forBuilding"] and any(p["item"] == bclass for p in r["products"]):
            u = unlock_info(rk)
            if u:
                t = u[1]
                best = t if best is None else min(best, t)
    return best if best is not None else 0


def building_cost(bclass):
    for rk, r in RECIPES.items():
        if r["forBuilding"] and any(p["item"] == bclass for p in r["products"]):
            return [[i["item"], i["amount"]] for i in r["ingredients"]]
    return []


used_items = set(WORLD_MAX)


def per_min(amount, time):
    return round(amount * 60.0 / time, 6)


recipes_out = {}
for rk, r in RECIPES.items():
    if not r["inMachine"] or not r["producedIn"]:
        continue
    b = r["producedIn"][0]
    if b not in PRODUCTION_BUILDINGS:
        continue
    u = unlock_info(rk) or MANUAL_UNLOCK.get(rk)
    main = r["products"][0]["item"]
    kind = "normal"
    if r["name"].startswith("Unpackage"):
        kind = "unpackage"
        u = u or ("milestone", 5, "Fluid Packaging")
    elif b == "Desc_Packager_C":
        kind = "package"
    elif b == "Desc_Converter_C" and main in WORLD_MAX:
        kind = "convert"
        u = u or ("milestone", 9, "Matter Conversion")
    if u is None:
        if r["alternate"]:
            u = ("alt", 0, "Hard drive")
        elif b == "Desc_Converter_C":
            u = ("milestone", 9, "Matter Conversion")
        else:
            print("WARN no unlock for", rk, r["name"], file=sys.stderr)
            u = ("other", 0, "Unknown")
    source, tier, label = u
    btier = building_tier(b)
    power = None
    if r["isVariablePower"] and r["maxPower"] > 0:
        power = [r["minPower"], r["maxPower"]]
    ing = [[i["item"], per_min(i["amount"], r["time"])] for i in r["ingredients"]]
    prod = [[p["item"], per_min(p["amount"], r["time"])] for p in r["products"]]
    for it, _ in ing + prod:
        used_items.add(it)
    recipes_out[rk] = {
        "id": rk,
        "name": r["name"].replace("Alternate: ", ""),
        "alt": bool(r["alternate"]),
        "building": b,
        "time": r["time"],
        "in": ing,
        "out": prod,
        "varPower": power,
        "kind": kind,
        "source": source,
        "tier": max(tier, btier),
        "unlockLabel": label,
    }

# --- Generators as pseudo-recipes producing "Power" (MW) -------------------------
GEN_FUELS = {
    "Desc_GeneratorBiomass_Automated_C": ["Desc_Leaves_C", "Desc_Wood_C", "Desc_Mycelia_C", "Desc_GenericBiomass_C", "Desc_Biofuel_C"],
    "Desc_GeneratorCoal_C": ["Desc_Coal_C", "Desc_CompactedCoal_C", "Desc_PetroleumCoke_C"],
    "Desc_GeneratorFuel_C": ["Desc_LiquidFuel_C", "Desc_LiquidTurboFuel_C", "Desc_LiquidBiofuel_C", "Desc_RocketFuel_C", "Desc_IonizedFuel_C"],
    "Desc_GeneratorNuclear_C": ["Desc_NuclearFuelRod_C", "Desc_PlutoniumFuelRod_C", "Desc_FicsoniumFuelRod_C"],
}
# Waste per fuel rod burned
NUCLEAR_WASTE = {"Desc_NuclearFuelRod_C": ("Desc_NuclearWaste_C", 50), "Desc_PlutoniumFuelRod_C": ("Desc_PlutoniumWaste_C", 10)}
gens = {g["className"]: g for g in d["generators"].values()}
for gclass, fuels in GEN_FUELS.items():
    g = gens[gclass]
    mw = g["powerProduction"]
    for f in fuels:
        if f not in ITEMS or ITEMS[f]["energyValue"] <= 0:
            continue
        fuel_per_min = mw * 60.0 / ITEMS[f]["energyValue"]
        ing = [[f, round(fuel_per_min, 6)]]
        water = mw * g["waterToPowerRatio"] * 60.0 / 1000.0
        if water > 0:
            ing.append(["Desc_Water_C", round(water, 6)])
        out = [["Power", mw]]
        if f in NUCLEAR_WASTE:
            w, n = NUCLEAR_WASTE[f]
            out.append([w, round(fuel_per_min * n, 6)])
        for it, _ in ing + out:
            used_items.add(it)
        rid = "Gen__" + gclass + "__" + f
        recipes_out[rid] = {
            "id": rid,
            "name": BUILDINGS[gclass]["name"] + " (" + ITEMS[f]["name"] + ")",
            "alt": False,
            "building": gclass,
            "time": 60,
            "in": ing,
            "out": out,
            "varPower": None,
            "kind": "power",
            "source": "milestone",
            "tier": building_tier(gclass),
            "unlockLabel": "",
        }

# --- Buildings ---------------------------------------------------------------------
buildings_out = {}
for b in ALL_BUILDINGS:
    x = BUILDINGS[b]
    cost = building_cost(b)
    for it, _ in cost:
        used_items.add(it)
    buildings_out[b] = {
        "id": b,
        "name": x["name"],
        "power": x["metadata"].get("powerConsumption", 0),
        "slots": SLOOP_SLOTS.get(b, 0),
        "tier": building_tier(b),
        "cost": cost,
        "icon": icon_key(b),
    }
# Generators produce power; their 'power' field is production MW (consumption 0)
for gclass in GENERATORS:
    buildings_out[gclass]["power"] = 0
    buildings_out[gclass]["produces"] = gens[gclass]["powerProduction"]
# Resource Well Pressurizer
buildings_out["Desc_FrackingSmasher_C"]["power"] = 150

# --- Items -------------------------------------------------------------------------
items_out = {}
for it in sorted(used_items):
    if it == "Power":
        continue
    x = ITEMS.get(it)
    if x is None:
        # building descriptors used as ingredients (e.g. portable miner)
        bx = BUILDINGS.get(it)
        name = bx["name"] if bx else it
        items_out[it] = {"id": it, "name": name, "liquid": False, "sink": 0, "energy": 0, "icon": icon_key(it)}
        continue
    items_out[it] = {
        "id": it,
        "name": x["name"],
        "liquid": bool(x["liquid"]),
        "sink": 0 if x["liquid"] else x["sinkPoints"],
        "energy": x["energyValue"],
        "icon": icon_key(it),
    }
items_out["Power"] = {"id": "Power", "name": "Power", "liquid": False, "sink": 0, "energy": 0, "icon": "", "unit": "MW"}

resources_out = {}
for k, mx in WORLD_MAX.items():
    resources_out[k] = {"id": k, "max": mx, "solid": k in SOLID_RES}

out = {
    "version": "1.0 data (valid for 1.2.x)",
    "items": items_out,
    "recipes": recipes_out,
    "buildings": buildings_out,
    "resources": resources_out,
}
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "gamedata.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))
print("items", len(items_out), "recipes", len(recipes_out), "buildings", len(buildings_out))

needed_icons = sorted({v["icon"] for v in items_out.values() if v["icon"]} | {v["icon"] for v in buildings_out.values()})
with open(os.path.join(OUT_DIR, "..", "..", "scripts", "icon_list.txt"), "w") as f:
    f.write("\n".join(needed_icons) + "\n")

if ICON_DIR:
    icons = {}
    missing = []
    for k in needed_icons:
        p = os.path.join(ICON_DIR, k + "_64.png")
        if os.path.exists(p) and os.path.getsize(p) > 100:
            with open(p, "rb") as f:
                head = f.read(8)
                if head != b"\x89PNG\r\n\x1a\n":
                    missing.append(k)
                    continue
                f.seek(0)
                icons[k] = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        else:
            missing.append(k)
    with open(os.path.join(OUT_DIR, "icons.json"), "w") as f:
        json.dump(icons, f, separators=(",", ":"))
    print("icons", len(icons), "missing", missing)
