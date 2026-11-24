using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// All modifier effects that apply to one city this turn, aggregated from the civ/leader
/// ability, the established governor and its promotions, districts and buildings.
/// Every applied modifier is recorded with its source so tooltips can explain every number.
/// </summary>
public sealed class CityEffects
{
    public YieldSet FlatYields;
    /// <summary>Whole percents per yield.</summary>
    public YieldSet PercentYields;
    public YieldSet AdjacencyPercent;
    public Fx LoyaltyPerTurn;
    public Fx PressurePercent;
    public int Amenities;
    public int Housing;
    public int DistrictCapacity;
    public int PowerOutput;
    public int PowerRangeBonus;
    public int EmissionsPercent;
    public int PurchaseDiscountPercent;
    public int EstablishTurnsDelta;
    public int BuilderCharges;
    public int EspionageDefense;
    public int SpyCapacity;
    public int CitizenFoodUpkeepPercent;
    public int FabricationPercent;
    public int CitizenPowerDemandTenths;
    public readonly int[] ProductionPercent = new int[Enum.GetValues<ProductionCategory>().Length];
    private int _immunities;

    public readonly List<(string Source, ModifierDef Modifier)> Applied = new();

    public bool IsImmune(DisasterKind kind) => (_immunities & (1 << (int)kind)) != 0;

    public int ProductionBonusFor(ProductionCategory category) =>
        ProductionPercent[(int)category] + ProductionPercent[(int)ProductionCategory.Any];

    public static CityEffects Compute(GameState s, CityState city)
    {
        var fx = new CityEffects();
        var db = s.Db;
        var owner = s.Players[city.Owner];

        if (owner.CivIndex >= 0)
        {
            var civ = db.Civilizations[owner.CivIndex];
            fx.ApplyAll(s, city, civ.Ability.Modifiers, $"{civ.Name}: {civ.Ability.Name}");
        }
        if (owner.LeaderIndex >= 0)
        {
            var leader = db.Leaders[owner.LeaderIndex];
            fx.ApplyAll(s, city, leader.Ability.Modifiers, $"{leader.Name}: {leader.Ability.Name}");
        }

        foreach (var (source, modifier) in NationSystem.CityModifiers(s, city))
        {
            fx.Apply(modifier);
            fx.Applied.Add((source, modifier));
        }

        if (owner.Divergence >= 0)
        {
            var div = db.Divergences[owner.Divergence];
            fx.ApplyAll(s, city, div.Modifiers, div.Name);
        }
        if (WorldSystem.CurrentAge(s) is { } age)
            fx.ApplyAll(s, city, age.Modifiers, $"{age.Name} (world)");
        foreach (int t in db.TechsWithModifiers)
            if (owner.HasTech(t)) fx.ApplyAll(s, city, db.Techs[t].Modifiers, db.Techs[t].Name);
        foreach (int c in db.CivicsWithModifiers)
            if (owner.HasCivic(c)) fx.ApplyAll(s, city, db.Civics[c].Modifiers, db.Civics[c].Name);
        foreach (var (mods, source) in SocietySystem.CityModifierSources(s, city)) fx.ApplyAll(s, city, mods, source);
        foreach (var (mods, source) in CityStateSystem.CityModifierSources(s, city)) fx.ApplyAll(s, city, mods, source);
        foreach (var (mods, source) in TradeSystem.CityModifierSources(s, city)) fx.ApplyAll(s, city, mods, source);
        foreach (var (mods, source) in CultureSystem.CityModifierSources(s, city)) fx.ApplyAll(s, city, mods, source);
        foreach (var (mods, source) in CongressSystem.CityModifierSources(s, city)) fx.ApplyAll(s, city, mods, source);
        foreach (var (mods, source) in SpaceSystem.CityModifierSources(s, city)) fx.ApplyAll(s, city, mods, source);

        var gov = city.GovernorDef >= 0 ? owner.GetGovernor(city.GovernorDef) : null;
        if (gov is { Established: true })
        {
            var def = db.Governors[gov.DefIndex];
            fx.ApplyAll(s, city, def.BaseModifiers, $"{def.Name} ({def.Title})");
            foreach (int p in gov.Promotions)
                fx.ApplyAll(s, city, def.Promotions[p].Modifiers, $"{def.Name}: {def.Promotions[p].Name}");
            foreach (int t in gov.Traits)
                fx.ApplyAll(s, city, db.GovernorTraits[t].Modifiers, $"{def.Name}: {db.GovernorTraits[t].Name} (trait)");
        }

        foreach (var district in city.Districts)
        {
            var ddef = db.Districts[district.DefIndex];
            if (!district.Pillaged) fx.ApplyAll(s, city, ddef.Modifiers, ddef.Name);
            foreach (int b in district.Buildings)
                fx.ApplyAll(s, city, db.Buildings[b].Modifiers, db.Buildings[b].Name);
        }
        return fx;
    }

    private void ApplyAll(GameState s, CityState city, List<ModifierDef> modifiers, string source)
    {
        foreach (var m in modifiers)
        {
            if (!RequirementsMet(s, city, m.Requirements)) continue;
            Apply(m);
            Applied.Add((source, m));
        }
    }

    private static bool OnFrontier(GameState s, CityState city, int radius)
    {
        var tiles = new List<int>();
        s.Map.CollectRadius(city.Tile, radius, tiles);
        foreach (int t in tiles)
        {
            int owner = s.Map.OwnerPlayer[t];
            if (owner >= 0 && !DiplomacySystem.SameTeam(s, owner, city.Owner)) return true;
        }
        return false;
    }

    public static bool RequirementsMet(GameState s, CityState city, List<RequirementDef> requirements)
    {
        var owner = s.Players[city.Owner];
        foreach (var r in requirements)
        {
            bool ok = r.Type switch
            {
                RequirementType.CityHasDistrict => city.FindDistrict(r.ResolvedIndex) != null,
                RequirementType.CityHasBuilding => city.HasBuilding(r.ResolvedIndex),
                RequirementType.CityMinPopulation => city.Population >= r.Value,
                RequirementType.CityIsPowered => city.IsPowered,
                RequirementType.CityIsCoastal => s.Map.IsAdjacentToSea(city.Tile),
                RequirementType.CityOnGreatRiver => s.Map.IsAdjacentToChannel(city.Tile),
                RequirementType.CityIsCapital => city.IsCapital,
                RequirementType.PlayerHasTech => owner.HasTech(r.ResolvedIndex),
                RequirementType.PlayerHasCivic => owner.HasCivic(r.ResolvedIndex),
                RequirementType.CityOnFrontier => OnFrontier(s, city, r.Value > 0 ? r.Value : 3),
                RequirementType.OwnerAtWar => s.Players.Any(o => o.IsAlive && !o.IsFreeCities && o.Id != owner.Id && DiplomacySystem.AtWar(s, owner.Id, o.Id)),
                _ => false,
            };
            if (!ok) return false;
        }
        return true;
    }

    private void Apply(ModifierDef m)
    {
        int whole = m.Amount.FloorToInt();
        switch (m.Effect)
        {
            case ModifierEffect.CityYieldFlat: FlatYields.Add(m.Yield!.Value, m.Amount); break;
            case ModifierEffect.CityYieldPercent: PercentYields.Add(m.Yield!.Value, m.Amount); break;
            case ModifierEffect.CityAdjacencyPercent: AdjacencyPercent.Add(m.Yield!.Value, m.Amount); break;
            case ModifierEffect.CityLoyaltyPerTurn: LoyaltyPerTurn += m.Amount; break;
            case ModifierEffect.CityPressurePercent: PressurePercent += m.Amount; break;
            case ModifierEffect.CityAmenities: Amenities += whole; break;
            case ModifierEffect.CityHousing: Housing += whole; break;
            case ModifierEffect.CityProductionPercent: ProductionPercent[(int)(m.Category ?? ProductionCategory.Any)] += whole; break;
            case ModifierEffect.CityDistrictCapacity: DistrictCapacity += whole; break;
            case ModifierEffect.CityPowerOutput: PowerOutput += whole; break;
            case ModifierEffect.PowerRangeBonus: PowerRangeBonus += whole; break;
            case ModifierEffect.CityEmissionsPercent: EmissionsPercent += whole; break;
            case ModifierEffect.CityPurchaseDiscountPercent: PurchaseDiscountPercent += whole; break;
            case ModifierEffect.GovernorEstablishTurns: EstablishTurnsDelta += whole; break;
            case ModifierEffect.BuilderCharges: BuilderCharges += whole; break;
            case ModifierEffect.EspionageDefense: EspionageDefense += whole; break;
            case ModifierEffect.SpyCapacity: SpyCapacity += whole; break;
            case ModifierEffect.CitizenFoodUpkeepPercent: CitizenFoodUpkeepPercent += whole; break;
            case ModifierEffect.CityFabricationPercent: FabricationPercent += whole; break;
            case ModifierEffect.CitizenPowerDemandTenths: CitizenPowerDemandTenths += whole; break;
            case ModifierEffect.CityDisasterImmunity:
                if (m.Disaster is { } kind) _immunities |= 1 << (int)kind;
                break;
            case ModifierEffect.UnitStrength:
                break; // read by SocietySystem.CombatLines
            case ModifierEffect.ClimateCo2Reduction:
            case ModifierEffect.ClimateCooling:
            case ModifierEffect.CompleteAscension:
            case ModifierEffect.LaunchSatellite:
            case ModifierEffect.ExodusStage:
                break; // one-shot project effects, handled by ProductionSystem
        }
    }
}
