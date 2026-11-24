using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Turns simulation events into the notification lines one player should see (null = not worth a notification for them).
/// Your own news is written in the second person; the world's news names the civilization. Kept in the sim so it is tested.
/// </summary>
public static class EventText
{
    public static string? Describe(GameState s, GameEvent e, int viewer)
    {
        bool mine = e.Player == viewer;
        bool aboutMe = mine || e.Value == viewer;
        string who = Civ(s, e.Player);
        string city = s.GetCity(e.City)?.Name ?? e.Detail ?? "a city";
        return e.Type switch
        {
            GameEventType.TurnAdvanced => $"— Turn {e.Value} —",
            GameEventType.CityFounded => mine ? $"You founded {e.Detail}." : $"{who} founded {e.Detail}.",
            GameEventType.ProductionCompleted when mine => $"{city} finished {e.Detail}.",
            GameEventType.QueueItemInvalidated when mine => $"{city} dropped an item from its queue: {e.Detail}",
            GameEventType.ProductionStalled when mine => $"{city} is waiting: {e.Detail}",
            GameEventType.CityGrew when mine => $"{city} grew to {e.Value}.",
            GameEventType.CityStarved when mine => $"{city} is starving and shrank to {e.Value}.",
            GameEventType.TechResearched when mine => $"Researched {e.Detail}. Choose the next technology (T).",
            GameEventType.CivicCompleted when mine => $"Completed {e.Detail}. Choose the next civic (T).",
            GameEventType.EraEntered when mine => $"You enter the {e.Detail}.",
            GameEventType.GovernorEstablished when mine => $"{e.Detail} is established in {city}.",
            GameEventType.GovernorTraitEarned when mine => $"{e.Detail}.",
            GameEventType.LoyaltyWarning when mine => $"{city} may flip in {e.Value} turns: loyalty is falling.",
            GameEventType.WarDeclared when aboutMe => mine ? $"You declared war on {e.Detail}." : $"{who} declared war on you!",
            GameEventType.WarDeclared => $"{who} declared war on {e.Detail}.",
            GameEventType.PeaceProposed when e.Value == viewer => $"{who} offers peace (diplomacy, P).",
            GameEventType.PeaceSigned when aboutMe => $"Peace with {(mine ? e.Detail : who)}.",
            GameEventType.Denounced when e.Value == viewer => $"{who} denounced you.",
            GameEventType.BattleFought when aboutMe || BattleAt(s, e, viewer) => e.Detail,
            GameEventType.UnitDestroyed when mine => $"Your {e.Detail} was destroyed.",
            GameEventType.CivilianCaptured when mine => $"You captured a {e.Detail}.",
            GameEventType.CityCaptured when aboutMe => mine ? $"You captured {e.Detail}!" : $"{who} captured {e.Detail}!",
            GameEventType.CityCaptured => $"{who} captured {e.Detail}.",
            GameEventType.CityFlipped when aboutMe => mine ? $"{e.Detail} chose to join you." : $"{e.Detail} left you for {who}.",
            GameEventType.CityDeclaredIndependence when e.Value == viewer => $"{e.Detail} declared independence.",
            GameEventType.Disaster when mine => $"{e.Detail} struck your lands.",
            GameEventType.ClimatePhaseChanged => $"The climate enters phase {e.Value}.",
            GameEventType.WorldAgeBegan => $"The world enters {e.Detail}",
            GameEventType.DivergenceChosen => e.Detail,
            GameEventType.AscensionCompleted => e.Detail,
            GameEventType.OutpostFounded when mine => $"Outpost planted: {e.Detail}.",
            GameEventType.OutpostRazed when mine => $"Raiders burned your outpost, {e.Detail}.",
            GameEventType.UnitUpgraded when mine => $"Upgraded to {e.Detail}.",
            GameEventType.UnitLostToAttrition when mine => "A unit cut off from supply was lost.",
            GameEventType.CityPurchased when aboutMe => mine ? $"You bought {e.Detail}. Its people now answer to Venice's ledger." : $"{who} bought {e.Detail} from under you!",
            GameEventType.CityPurchased => $"{who} bought {e.Detail}.",
            GameEventType.Plundered when mine => e.City >= 0 ? $"Plunder: {e.Detail}." : $"Victory pays: {e.Detail}.",
            GameEventType.Inundation when mine => $"The river floods! The Royal Granary pours out: {e.Detail}.",
            GameEventType.DynastyBegan when mine => $"The Mandate of Heaven is yours: a Golden Dynasty begins ({e.Value} turns).",
            GameEventType.DynastyBegan => $"{who} enters a Golden Dynasty.",
            GameEventType.DynastyEnded when mine => "The Golden Dynasty draws to a close. The Mandate must be earned again.",
            GameEventType.DynastyFell when mine => $"The loss of {e.Detail} shatters the dynasty: every city loses {e.Value} loyalty.",
            GameEventType.DynastyFell => $"{who}'s dynasty has fallen.",
            GameEventType.UnitDisbanded when mine => $"The treasury is empty: unpaid, your {e.Detail} deserted.",
            GameEventType.GovernmentAdopted when mine => $"You adopt {e.Detail}. Slot your policy cards (G).",
            GameEventType.PantheonFounded when mine => $"Your people now worship: {e.Detail}.",
            GameEventType.PantheonFounded => $"{who} founded a pantheon: {e.Detail}.",
            GameEventType.ReligionFounded when mine => $"You founded {e.Detail}! {city} is its holy city.",
            GameEventType.ReligionFounded => $"{who} founded {e.Detail}.",
            GameEventType.CityConverted when mine => $"{city} now follows {e.Detail}.",
            GameEventType.GreatPersonRecruited when mine => $"A great person joins you: {e.Detail}.",
            GameEventType.GreatPersonRecruited => $"{who} recruited {e.Detail}.",
            GameEventType.HistoricMoment when mine => $"Historic moment: {e.Detail} (+{e.Value} era score).",
            GameEventType.AgeBegan when mine => $"Your people enter a {e.Detail}.",
            GameEventType.AgeBegan when e.Value is (int)AgeState.Golden or (int)AgeState.Heroic => $"{who} enters a {(AgeState)e.Value} Age.",
            GameEventType.NaturalWonderDiscovered when mine => $"You discovered {e.Detail}, a natural wonder!",
            GameEventType.UnitPromoted when mine => $"Promoted: {e.Detail}.",
            GameEventType.CampSpawned when Seen(s, e.Tile, viewer) => "Barbarians have made camp in the wilds.",
            GameEventType.CampCleared when mine => $"You scattered a barbarian camp: +{e.Value} gold.",
            GameEventType.TilePillaged when mine => "Raiders pillaged an improvement in your lands.",
            GameEventType.TradeRouteEstablished when mine => $"Trade route opened: {e.Detail}.",
            GameEventType.TradeRouteEstablished when e.Value == viewer => $"{who} opened a trade route to you: {e.Detail} (+1 Gold for you).",
            GameEventType.TradeRouteEnded when mine => $"A trade route ended ({e.Detail}); the trader is home.",
            GameEventType.TradeRoutePlundered when mine => $"Your trade route {e.Detail} was plundered!",
            GameEventType.TradeRoutePlundered when e.Value == viewer => $"You plundered a trade route: +{TradeSystem.PlunderGold} gold.",
            GameEventType.EnvoyEarned when mine => $"A new envoy is ready ({e.Value} to send): diplomacy (P).",
            GameEventType.CityStateMet when mine => $"You meet the city-state of {e.Detail}.",
            GameEventType.EnvoySent when mine => $"Your envoy arrives in {e.Detail}.",
            GameEventType.SuzerainChanged when mine => $"You are now suzerain of {e.Detail}.",
            GameEventType.SuzerainChanged when e.Value >= 0 && e.Value < s.Players.Count && CityStateSystem.EnvoysFrom(s.Players[e.Value], viewer) > 0 =>
                e.Player >= 0 ? $"{who} is now suzerain of {e.Detail}." : $"{e.Detail} has no suzerain now.",
            GameEventType.VictoryAchieved => e.Detail,
            GameEventType.PlayerEliminated => mine ? "Your civilization has fallen." : $"{who} has fallen.",
            _ => null,
        };
    }

    private static bool Seen(GameState s, int tile, int viewer) =>
        tile >= 0 && viewer >= 0 && viewer < s.Players.Count && tile < s.Players[viewer].Revealed.Length && s.Players[viewer].Revealed[tile];

    private static bool BattleAt(GameState s, GameEvent e, int viewer) =>
        e.Tile >= 0 && (s.Units.Any(u => u.Tile == e.Tile && u.Owner == viewer) || s.Cities.Any(c => c.Tile == e.Tile && c.Owner == viewer));

    public static string Civ(GameState s, int player)
    {
        if (player < 0 || player >= s.Players.Count) return "Someone";
        var p = s.Players[player];
        return p.CivIndex >= 0 ? s.Db.Civilizations[p.CivIndex].Name : p.Name;
    }
}
