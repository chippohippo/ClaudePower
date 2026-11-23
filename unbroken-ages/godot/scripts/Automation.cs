using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client;

/// <summary>
/// Scripted play for testing the real client (CI smoke tests, screenshots, bug repros). Pass user arguments after "--":
///   --autostart[=seed]     start a single-player game at once (Small map, you + 2 AI)
///   --do=a,b,c             actions, one every few frames: found, research, produce, end, next, move-east, attack,
///                          panel:T|P|C|V, save, load, zoom-out, select-city, wait
///   --shots=dir            screenshot after every action (dir/NN-action.png)
///   --shot=file.png        screenshot at the end
///   --quit                 exit when done (exit code 1 if an action failed)
/// Example: godot --path godot -- --autostart --do=found,research,produce,end,end --shots=/tmp/ua --quit
/// </summary>
public partial class GameRoot
{
    private readonly Queue<string> _script = new();
    private string? _shotsDir, _finalShot;
    private bool _quitWhenDone, _scripted, _failed;
    private int _waitFrames, _step;

    private void StartAutomation()
    {
        var args = OS.GetCmdlineUserArgs();
        foreach (var a in args)
        {
            if (a.StartsWith("--autostart"))
            {
                ulong seed = a.Contains('=') ? ulong.Parse(a[(a.IndexOf('=') + 1)..]) : 7;
                var size = Db.MapSizes["MAPSIZE_SMALL"];
                var leaders = Db.Leaders.Select(l => l.Id).ToList();
                StartSinglePlayer(new GameSetup
                {
                    Seed = seed,
                    Map = new MapGenSettings { Width = size.Width, Height = size.Height, GreatRivers = size.GreatRivers, Seed = seed },
                    Players = Enumerable.Range(0, 3).Select(i => new PlayerSetup { Name = i == 0 ? "You" : $"AI {i + 1}", IsHuman = i == 0, Leader = leaders[i % leaders.Count] }).ToList(),
                });
                _scripted = true;
            }
            else if (a.StartsWith("--do=")) foreach (var step in a[5..].Split(',', StringSplitOptions.RemoveEmptyEntries)) _script.Enqueue(step);
            else if (a.StartsWith("--shots=")) _shotsDir = a[8..];
            else if (a.StartsWith("--shot=")) _finalShot = a[7..];
            else if (a == "--quit") _quitWhenDone = true;
        }
        if (_script.Count > 0 || _finalShot != null || _quitWhenDone) { _scripted = true; _waitFrames = 20; }
        if (_shotsDir != null) System.IO.Directory.CreateDirectory(_shotsDir);
    }

    public override void _PhysicsProcess(double delta)
    {
        if (!_scripted || --_waitFrames > 0) return;
        if (_pendingShot != null) { Shoot(_pendingShot); _pendingShot = null; _waitFrames = 2; return; }
        if (_script.Count > 0)
        {
            string step = _script.Dequeue();
            string? error = RunStep(step);
            GD.Print(error == null ? $"[auto] {step}: ok" : $"[auto] {step}: FAILED: {error}");
            if (error != null) _failed = true;
            _pendingShot = _shotsDir != null ? System.IO.Path.Combine(_shotsDir, $"{++_step:00}-{step.Replace(':', '_')}.png") : null;
            _waitFrames = 12;
            return;
        }
        if (_finalShot != null) { Shoot(_finalShot); _finalShot = null; _waitFrames = 2; return; }
        if (_quitWhenDone) GetTree().Quit(_failed ? 1 : 0);
        _scripted = _quitWhenDone;
    }

    private string? _pendingShot;

    private void Shoot(string path)
    {
        var image = GetViewport().GetTexture().GetImage();
        image.SavePng(path);
        GD.Print($"[auto] screenshot {path}");
    }

    private string? RunStep(string step)
    {
        var s = State;
        if (s == null) return "no game";
        var me = s.Players[LocalPlayer];
        CommandResult Do(GameCommand c) => Submit(c);
        switch (step)
        {
            case "wait": return null;
            case "next": SelectNextUnit(); return SelectedUnit >= 0 ? null : "no unit ready";
            case "found":
            {
                var settler = s.Units.FirstOrDefault(u => u.Owner == LocalPlayer && s.Db.Units[u.DefIndex].FoundsCity);
                if (settler == null) return "no settler";
                SelectUnit(settler.Id);
                return Do(new FoundCityCommand { UnitId = settler.Id }).Error;
            }
            case "research":
            {
                ToggleResearch();
                var tech = s.Db.Techs.Where(t => ResearchSystem.CanResearch(me, t) && !t.Doctrine).OrderBy(t => t.Cost).FirstOrDefault();
                var civic = s.Db.Civics.Where(c => ResearchSystem.CanStudy(me, c)).OrderBy(c => c.Cost).FirstOrDefault();
                if (tech != null) Do(new SetResearchCommand { Tech = tech.Index });
                if (civic != null) Do(new SetCivicCommand { Civic = civic.Index });
                return me.CurrentTech >= 0 ? null : "research not set";
            }
            case "produce":
            {
                var city = s.CitiesOf(LocalPlayer).FirstOrDefault();
                if (city == null) return "no city";
                ClickTile(city.Tile);
                var unit = s.Db.Units.First(u => u.Id == "UNIT_WARRIOR");
                return Do(new EnqueueCommand { CityId = city.Id, Kind = ProductionKind.Unit, DefIndex = unit.Index, Repeat = false }).Error;
            }
            case "select-city":
            {
                var city = s.CitiesOf(LocalPlayer).FirstOrDefault();
                if (city == null) return "no city";
                OpenCity(city);
                return null;
            }
            case "end": return Do(new EndTurnCommand()).Error;
            case var many when many.StartsWith("turns:"):
            {
                int n = int.Parse(many[6..]);
                for (int i = 0; i < n; i++)
                {
                    // Play like a casual human: keep research, civics and every city's queue busy using the AI's choices.
                    var ai = new UnbrokenAges.Sim.AI.SimpleAi();
                    foreach (var c in ai.TakeTurn(s, LocalPlayer).Where(c => c is SetResearchCommand or SetCivicCommand or EnqueueCommand or FoundCityCommand or MoveUnitCommand or BuildImprovementCommand))
                        Submit(c);
                    var r = Do(new EndTurnCommand());
                    if (!r.Ok) return r.Error;
                }
                return null;
            }
            case "move-east":
            {
                if (s.GetUnit(SelectedUnit) is not { } u) { SelectNextUnit(); u = s.GetUnit(SelectedUnit)!; if (u == null) return "nothing selected"; }
                int target = u.Tile;
                for (int i = 0; i < 3; i++) { int n = s.Map.Neighbor(target, HexCoord.E); if (n >= 0 && s.Map.IsLand(n)) target = n; }
                OrderSelectedTo(target);
                return null;
            }
            case "save": QuickSave(); return null;
            case "menu": ToggleMenu(); return null;
            case "load": QuickLoad(); return null;
            case "zoom-out": Camera.Zoom(2.2f); return null;
            default:
                if (step.StartsWith("panel:")) { TogglePanel(step[6..]); return null; }
                return $"unknown step '{step}'";
        }
    }
}
