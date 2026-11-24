using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// The air war. Aircraft (the Air domain) are based: they stand in your own cities or on your own carriers, rebase from one
/// base to another within their moves in a single flight, and strike targets within their range from where they stand.
/// A carrier holds <see cref="CarrierCapacity"/> aircraft and carries them as it sails. An aircraft left without a base (its
/// carrier sunk, its city lost) loses <see cref="FuelLoss"/> health a turn until it lands or falls.
/// <para>
/// Interception: when an aircraft strikes, the best enemy interceptor (a unit with the "Interceptor" tag) based within its own
/// range of the target that has not yet fought this turn meets it first. The striker takes damage as if attacked by the
/// interceptor; if it survives, the strike goes ahead. The interceptor spends its attack for the turn.
/// </para>
/// </summary>
public static class AirSystem
{
    public const int CarrierCapacity = 3;
    public const int FuelLoss = 25;

    public static bool IsAircraft(GameDatabase db, UnitState u) => db.Units[u.DefIndex].Domain == UnitDomain.Air;
    public static bool IsCarrier(GameDatabase db, UnitState u) => db.Units[u.DefIndex].HasTag("Carrier");

    /// <summary>Where an aircraft may stand: its owner's city, or its owner's carrier with room on deck.</summary>
    public static bool IsBase(GameState s, int owner, int tile, UnitState? arriving = null)
    {
        if (s.Cities.Any(c => c.Tile == tile && c.Owner == owner)) return true;
        if (!s.Units.Any(u => u.Tile == tile && u.Owner == owner && IsCarrier(s.Db, u))) return false;
        int aboard = s.Units.Count(u => u.Tile == tile && u.Owner == owner && IsAircraft(s.Db, u) && u != arriving);
        return aboard < CarrierCapacity * s.Units.Count(u => u.Tile == tile && u.Owner == owner && IsCarrier(s.Db, u));
    }

    /// <summary>Why an aircraft may not fly there (null if it may): bases only, and within one flight.</summary>
    public static string? ValidateRebase(GameState s, UnitState u, int destination)
    {
        if (!IsBase(s, u.Owner, destination, u)) return "Aircraft land only in your cities or on your carriers (with room on deck).";
        if (s.Map.Distance(u.Tile, destination) > UnitStats.Moves(s, u)) return $"Too far for one flight (up to {UnitStats.Moves(s, u)} tiles).";
        if (u.MovesLeft <= Fx.Zero) return "No moves left this turn.";
        return null;
    }

    /// <summary>A carrier's aircraft sail with it.</summary>
    public static void CarryAircraft(GameState s, UnitState carrier, int from, int to)
    {
        if (!IsCarrier(s.Db, carrier)) return;
        foreach (var a in s.Units.Where(u => u.Tile == from && u.Owner == carrier.Owner && IsAircraft(s.Db, u)).Take(CarrierCapacity).ToList())
            a.Tile = to;
    }

    /// <summary>The interceptor that meets a strike on <paramref name="targetTile"/>, if any.</summary>
    public static UnitState? Interceptor(GameState s, UnitState striker, int targetTile)
    {
        if (!IsAircraft(s.Db, striker)) return null;
        return s.Units.Where(u => u.Owner != striker.Owner && !u.AttackedThisTurn && s.Db.Units[u.DefIndex].HasTag("Interceptor") &&
                                  DiplomacySystem.AtWar(s, u.Owner, striker.Owner) &&
                                  s.Map.Distance(u.Tile, targetTile) <= UnitStats.Range(s, u))
                      .OrderByDescending(u => UnitStats.RangedStrength(s, u)).ThenBy(u => u.Id).FirstOrDefault();
    }

    /// <summary>Start of turn: aircraft without a base burn fuel and fall when it runs out.</summary>
    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        foreach (var u in s.Units.Where(u => IsAircraft(s.Db, u)).ToList())
        {
            if (IsBase(s, u.Owner, u.Tile, u) || s.Units.Any(c => c.Tile == u.Tile && c.Owner == u.Owner && IsCarrier(s.Db, c))) continue;
            u.Hp -= FuelLoss;
            if (u.Hp > 0) continue;
            s.RemoveUnit(u);
            events.Add(new GameEvent(GameEventType.UnitDestroyed, u.Owner, Tile: u.Tile, Def: u.DefIndex, Detail: $"{s.Db.Units[u.DefIndex].Name} (out of fuel)"));
        }
    }
}
