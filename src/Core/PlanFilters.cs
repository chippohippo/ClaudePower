using System;
using System.Collections.Generic;
using System.Linq;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// The shipping game filters of a card's declared plan, as GameFilterCore instances loaded from the plan's own
    /// settings (every exported key is a public double field on GameFilterCore). Lets the measurement harness and the
    /// labs score a card THROUGH its plan instead of the bare curve (2026-09-16 audit gap: the strict cards' rest
    /// deadzones were never seen by any measurement). Cadence Lock and the Coherence Stabilizer are not game filters
    /// and are not built here.
    /// </summary>
    public static class PlanFilters
    {
        static readonly Dictionary<string, (GameFilterCore.Game g, GameFilterCore.Member m)> Kinds = new()
        {
            ["AimForge.Filters.CodMaster"] = (GameFilterCore.Game.Cod, GameFilterCore.Member.Master),
            ["AimForge.Filters.CodLab"] = (GameFilterCore.Game.Cod, GameFilterCore.Member.Lab),
            ["AimForge.Filters.ValMaster"] = (GameFilterCore.Game.Val, GameFilterCore.Member.Master),
            ["AimForge.Filters.ValLab"] = (GameFilterCore.Game.Val, GameFilterCore.Member.Lab),
            ["AimForge.Filters.ApexMaster"] = (GameFilterCore.Game.Apex, GameFilterCore.Member.Master),
            ["AimForge.Filters.Ow2Master"] = (GameFilterCore.Game.Ow2, GameFilterCore.Member.Master),
            ["AimForge.Filters.Ow2Lab"] = (GameFilterCore.Game.Ow2, GameFilterCore.Member.Lab),
            ["AimForge.Filters.RivalsMaster"] = (GameFilterCore.Game.Rivals, GameFilterCore.Member.Master),
            ["AimForge.Filters.FinalsMaster"] = (GameFilterCore.Game.Finals, GameFilterCore.Member.Master),
            ["AimForge.Filters.HoldfastMaster"] = (GameFilterCore.Game.Holdfast, GameFilterCore.Member.Master),
        };

        public static bool IsGameFilter(string id) => Kinds.ContainsKey(id);

        public static GameFilterCore Build(FilterSpec fs)
        {
            var (g, m) = Kinds[fs.id];
            var core = new GameFilterCore { Which = g, Kind = m };
            foreach (var kv in fs.settings)
            {
                var fld = typeof(GameFilterCore).GetField(kv.Key);
                if (fld != null && fld.FieldType == typeof(double)) fld.SetValue(core, kv.Value);
            }
            return core;
        }

        /// The ENABLED game filters of the plan, in plan order; empty when the card runs none.
        public static List<FilterSpec> Enabled(Preset p) => (p.filters ?? new List<FilterSpec>()).Where(f => f.on && IsGameFilter(f.id)).ToList();

        /// A factory of fresh filter chains (every probe needs its own state), or null for a plan with no game filter.
        public static Func<GameFilterCore[]>? Factory(Preset p)
        {
            var specs = Enabled(p);
            return specs.Count == 0 ? null : () => specs.Select(Build).ToArray();
        }
    }
}
