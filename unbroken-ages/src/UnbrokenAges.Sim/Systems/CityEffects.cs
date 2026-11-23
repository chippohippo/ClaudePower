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

        var gov = city.GovernorDef >= 0 ? owner.GetGovernor(city.GovernorDef) : null;
        if (gov is { Established: true })
        {
            var def = db.Governors[gov.DefIndex];
            fx.ApplyAll(s, city, def.BaseModifiers, $"{def.Name} ({def.Title})");
            foreach (int p in gov.Promotions)
                fx.ApplyAll(s, city, def.Promotions[p].Modifiers, $"{def.Name}: {def.Promotions[p].Name}");
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
            case ModifierEffect.CityDisasterImmunity:
                if (m.Disaster is { } kind) _immunities |= 1 << (int)kind;
                break;
            case ModifierEffect.ClimateCo2Reduction:
                break; // one-shot project effect, handled by ProductionSystem
        }
    }
}
