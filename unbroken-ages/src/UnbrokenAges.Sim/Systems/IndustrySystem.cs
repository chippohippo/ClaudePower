using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public sealed record IndustryRun(int CityId, int Building, bool Ran, string? Reason);

/// <summary>
/// Production chains (Millennia / Shadow Empire depth, Civ ease): industry buildings convert the
/// empire stockpile each turn — Iron + Coal → Steel, Oil → Plastics, Steel + Plastics → Electronics —
/// automatically, in city id order, with no routing. Advanced units cost goods. The Industry panel
/// shows every chain with its surplus or bottleneck in plain words ("Electronics Plant idle: needs
/// Plastics — build a Refinery or trade for Oil").
/// </summary>
public static class IndustrySystem
{
    public const int DefaultGoodCap = 100;

    public static List<IndustryRun> ProcessTurn(GameState s, bool commit = true)
    {
        var runs = new List<IndustryRun>();
        var db = s.Db;
        foreach (var p in s.Players)
        {
            if (!p.IsAlive) continue;
            var stock = commit ? p.Stockpile : (int[])p.Stockpile.Clone();
            foreach (var city in s.CitiesOf(p.Id))
            foreach (var district in city.Districts)
            {
                if (district.Pillaged) continue;
                foreach (int b in district.Buildings)
                {
                    if (db.Buildings[b].Recipe is not { } recipe) continue;
                    string? reason = null;
                    if (recipe.RequiresPower && !city.IsPowered) reason = "unpowered";
                    else
                    {
                        foreach (var (res, amount) in recipe.ResolvedInputs)
                            if (stock[res] < amount) { reason = $"needs {db.Resources[res].Name}"; break; }
                    }
                    if (reason == null)
                    {
                        foreach (var (res, amount) in recipe.ResolvedInputs) stock[res] -= amount;
                        foreach (var (res, amount) in recipe.ResolvedOutputs)
                        {
                            int cap = db.Resources[res].StockpileCap > 0 ? db.Resources[res].StockpileCap : DefaultGoodCap;
                            stock[res] = Math.Min(cap, stock[res] + amount);
                        }
                    }
                    runs.Add(new IndustryRun(city.Id, b, reason == null, reason));
                }
            }
        }
        return runs;
    }
}
